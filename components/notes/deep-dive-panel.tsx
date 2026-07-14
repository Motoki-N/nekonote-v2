"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { Check, CircleStop, FilePlus2, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";

import {
  getOrCreateDeepDiveThread,
  resetThread,
  type ChatMessageRecord,
} from "@/lib/actions/chat";
import type { NoteContext } from "@/lib/ai/prompts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function toUIMessage(record: ChatMessageRecord): UIMessage {
  return { id: record.id, role: record.role, parts: [{ type: "text", text: record.content }] };
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** /api/chat の errorResponse（JSON）からユーザー向けメッセージを取り出す */
function toDisplayError(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // JSON でなければ汎用文言にフォールバック
  }
  return "AIの呼び出しに失敗しました。時間をおいて再試行してください";
}

/** AI掘り下げパネル。lg以上は右サイドパネル、lg未満はボトムシート */
export function DeepDivePanel({
  noteId,
  getNoteContext,
  onInsert,
  onClose,
}: {
  noteId: string;
  getNoteContext: () => NoteContext;
  onInsert: (markdown: string) => void;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<{
    threadId: string;
    initialMessages: UIMessage[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof getOrCreateDeepDiveThread>>) => {
      if (result.ok && result.data) {
        setThread({
          threadId: result.data.threadId,
          initialMessages: result.data.messages.map(toUIMessage),
        });
      } else if (!result.ok) {
        setLoadError(result.error.message);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void getOrCreateDeepDiveThread(noteId).then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, applyResult]);

  async function reload() {
    setThread(null);
    setLoadError(null);
    applyResult(await getOrCreateDeepDiveThread(noteId));
  }

  async function handleReset() {
    if (!thread) return;
    const result = await resetThread(thread.threadId);
    if (!result.ok) {
      setLoadError(result.error.message);
      return;
    }
    await reload();
  }

  return (
    <aside
      aria-label="AI掘り下げパネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">掘り下げ</span>
        <span className="text-xs text-muted-foreground">アシスタント</span>
        <div className="ml-auto flex items-center gap-0.5">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="会話をリセット"
                  className="text-muted-foreground"
                  disabled={!thread}
                >
                  <RotateCcw />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>会話をリセットしますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  このノートの掘り下げ履歴がすべて削除されます。この操作は元に戻せません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={handleReset}>リセットする</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="パネルを閉じる"
            className="text-muted-foreground"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-destructive">
          <p>{loadError}</p>
          <Button size="xs" variant="outline" onClick={() => void reload()}>
            再試行
          </Button>
        </div>
      ) : thread ? (
        <DeepDiveChat
          key={thread.threadId}
          threadId={thread.threadId}
          initialMessages={thread.initialMessages}
          getNoteContext={getNoteContext}
          onInsert={onInsert}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      )}
    </aside>
  );
}

function DeepDiveChat({
  threadId,
  initialMessages,
  getNoteContext,
  onInsert,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  getNoteContext: () => NoteContext;
  onInsert: (markdown: string) => void;
}) {
  const [input, setInput] = useState("");
  const [insertedIds, setInsertedIds] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // transport は既定（POST /api/chat）。threadId とノートの現在値は送信時に body へ同梱する
  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initialMessages,
  });

  const busy = status === "submitted" || status === "streaming";

  // 新着メッセージで最下部へ追従
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    // 送信時点のエディタ現在値（title / content / tags）をリクエストボディに同梱する
    void sendMessage(
      { text },
      { body: { threadId, context: { kind: "note", note: getNoteContext() } } },
    );
  }

  function handleInsert(message: UIMessage) {
    onInsert(textOf(message));
    setInsertedIds((prev) => new Set(prev).add(message.id));
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">
            このノートのネタについて、アシスタントと一緒に掘り下げられます。気になっていること・迷っていることを話しかけてみてください。
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {messages.map((message) => (
            <li key={message.id} className="flex flex-col gap-1">
              <div
                className={
                  message.role === "user"
                    ? "ml-8 self-end rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                    : "mr-4 self-start rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground"
                }
              >
                {textOf(message)}
              </div>
              {message.role === "assistant" && textOf(message) && (
                <div className="self-start">
                  {insertedIds.has(message.id) ? (
                    <span className="flex items-center gap-1 px-2 text-xs text-muted-foreground">
                      <Check className="size-3" />
                      挿入済み
                    </span>
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={busy}
                      onClick={() => handleInsert(message)}
                    >
                      <FilePlus2 data-icon="inline-start" />
                      ノートに挿入
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {status === "submitted" && (
          <Loader2
            className="mt-3 size-4 animate-spin text-muted-foreground"
            aria-label="応答を待っています"
          />
        )}
        {error && <p className="mt-3 text-sm text-destructive">{toDisplayError(error)}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ネタについて話しかける…"
          aria-label="メッセージ"
        />
        {busy ? (
          <Button type="button" variant="outline" size="icon" aria-label="停止" onClick={() => void stop()}>
            <CircleStop />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="送信" disabled={input.trim().length === 0}>
            <Send />
          </Button>
        )}
      </form>
    </>
  );
}
