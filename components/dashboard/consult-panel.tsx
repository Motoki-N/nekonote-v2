"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  Check,
  CircleStop,
  ExternalLink,
  FilePlus2,
  Loader2,
  MessagesSquare,
  RotateCcw,
  Send,
  X,
} from "lucide-react";

import {
  getOrCreateDashboardThread,
  resetThread,
  saveChatMessageAsNote,
  type ChatMessageRecord,
} from "@/lib/actions/chat";
import { ASSISTANT_PERSONA_ID, CAFE_MASTER_PERSONA_ID } from "@/lib/ai/personas";
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

export type ConsultProject = {
  id: string;
  title: string;
  deadline: string | null;
};

/** 相談タブ（標準 conversational ペルソナ2人で固定。SPEC-conversational-personas §3.1） */
const TABS = [
  { personaId: ASSISTANT_PERSONA_ID, name: "アシスタント" },
  { personaId: CAFE_MASTER_PERSONA_ID, name: "喫茶店のマスター" },
] as const;

const EMPTY_MESSAGE: Record<string, string> = {
  [ASSISTANT_PERSONA_ID]:
    "執筆スケジュールや進捗の相談、ネタ出しに付き合います。プロジェクトを選ぶと、締切や直近の執筆ペースをふまえて助言します。",
  [CAFE_MASTER_PERSONA_ID]:
    "いらっしゃい。構想の壁打ちにどうぞ。話がまとまってきたら「メモにまとめて」と言ってもらえれば、短いメモにして手渡します。",
};

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

/** 締切が最も近いプロジェクトを既定値にする（締切なしは後回し。SPEC §3.2） */
function defaultProjectId(projects: ConsultProject[]): string {
  const withDeadline = projects
    .filter((p) => p.deadline !== null)
    .sort((a, b) => (a.deadline as string).localeCompare(b.deadline as string));
  return withDeadline[0]?.id ?? projects[0]?.id ?? "";
}

/** ダッシュボードの「相談する」導線＋相談パネル。トリガーのJSXはクライアント側で組み立てる */
export function ConsultLauncher({ projects }: { projects: ConsultProject[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessagesSquare data-icon="inline-start" />
        相談する
      </Button>
      {open && <ConsultPanel projects={projects} onClose={() => setOpen(false)} />}
    </>
  );
}

/** 相談パネル本体。lg以上は右サイドパネル、lg未満はボトムシート */
function ConsultPanel({
  projects,
  onClose,
}: {
  projects: ConsultProject[];
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<string>(TABS[0].personaId);

  return (
    <aside
      aria-label="相談パネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background shadow-lg lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:h-auto lg:w-96 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <MessagesSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">相談</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="パネルを閉じる"
          className="ml-auto text-muted-foreground"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      <div role="tablist" aria-label="相談相手" className="flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.personaId}
            role="tab"
            aria-selected={activeTab === tab.personaId}
            className={`flex-1 border-b-2 px-2 py-2 text-sm ${
              activeTab === tab.personaId
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground"
            }`}
            onClick={() => setActiveTab(tab.personaId)}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {/* タブは両方マウントしたまま表示を切り替える＝切替で会話状態が消えない */}
      {TABS.map((tab) => (
        <div
          key={tab.personaId}
          className={
            activeTab === tab.personaId ? "flex min-h-0 flex-1 flex-col" : "hidden"
          }
        >
          <ConsultThread
            personaId={tab.personaId}
            projects={tab.personaId === ASSISTANT_PERSONA_ID ? projects : null}
          />
        </div>
      ))}
    </aside>
  );
}

/** 1ペルソナ分のスレッド（get-or-create → チャット）。リセットで作り直す */
function ConsultThread({
  personaId,
  projects,
}: {
  personaId: string;
  /** プロジェクトセレクタを出すタブ（アシスタント）のみ非null */
  projects: ConsultProject[] | null;
}) {
  const [thread, setThread] = useState<{
    threadId: string;
    initialMessages: UIMessage[];
    initialDbIds: string[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof getOrCreateDashboardThread>>) => {
      if (result.ok && result.data) {
        setThread({
          threadId: result.data.threadId,
          initialMessages: result.data.messages.map(toUIMessage),
          initialDbIds: result.data.messages.map((m) => m.id),
        });
      } else if (!result.ok) {
        setLoadError(result.error.message);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    applyResult(await getOrCreateDashboardThread(personaId));
  }, [personaId, applyResult]);

  useEffect(() => {
    let cancelled = false;
    void getOrCreateDashboardThread(personaId).then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [personaId, applyResult]);

  async function handleReset() {
    if (!thread) return;
    const result = await resetThread(thread.threadId);
    if (!result.ok) {
      setLoadError(result.error.message);
      return;
    }
    setThread(null);
    setLoadError(null);
    await load();
  }

  return (
    <>
      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-destructive">
          <p>{loadError}</p>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            再試行
          </Button>
        </div>
      ) : thread ? (
        <ConsultChat
          key={thread.threadId}
          personaId={personaId}
          threadId={thread.threadId}
          initialMessages={thread.initialMessages}
          initialDbIds={thread.initialDbIds}
          projects={projects}
          onReset={handleReset}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      )}
    </>
  );
}

function ConsultChat({
  personaId,
  threadId,
  initialMessages,
  initialDbIds,
  projects,
  onReset,
}: {
  personaId: string;
  threadId: string;
  initialMessages: UIMessage[];
  initialDbIds: string[];
  projects: ConsultProject[] | null;
  onReset: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [projectId, setProjectId] = useState<string>(() =>
    projects ? defaultProjectId(projects) : "",
  );
  // DBに保存済みのメッセージid（＝「ノートに保存」を押せるもの）。
  // ストリーミング直後の応答はクライアント採番のidでDBと一致しないため、
  // 応答完了後にDBから履歴を取り直して差し替える
  const [dbIds, setDbIds] = useState<ReadonlySet<string>>(() => new Set(initialDbIds));
  const [savedNotes, setSavedNotes] = useState<Readonly<Record<string, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const syncTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: threadId,
    messages: initialMessages,
    onFinish: () => {
      // /api/chat の onEnd（DB保存）はストリーム終了後に完了するため、
      // 少し遅らせた二段取り直しでレースを吸収する（proofread-panel と同じ流儀）
      scheduleSync(300);
      scheduleSync(1500);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  function scheduleSync(delayMs: number) {
    syncTimers.current.push(
      setTimeout(() => {
        // 次の送信が始まっていたら差し替えない（onFinish 時に改めて同期される）
        if (statusRef.current === "submitted" || statusRef.current === "streaming") return;
        void getOrCreateDashboardThread(personaId).then((result) => {
          if (!result.ok || !result.data) return;
          if (statusRef.current === "submitted" || statusRef.current === "streaming") return;
          if (result.data.threadId !== threadId) return;
          setMessages(result.data.messages.map(toUIMessage));
          setDbIds(new Set(result.data.messages.map((m) => m.id)));
        });
      }, delayMs),
    );
  }

  useEffect(() => {
    const timers = syncTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

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
    // 対象プロジェクトはリクエスト単位のコンテキスト（スレッドとは独立。SPEC §3.2）
    void sendMessage(
      { text },
      {
        body: {
          threadId,
          context: { kind: "dashboard", ...(projectId ? { projectId } : {}) },
        },
      },
    );
  }

  async function handleSave(message: UIMessage) {
    if (savingId !== null) return;
    setSaveError(null);
    setSavingId(message.id);
    try {
      const result = await saveChatMessageAsNote(message.id);
      if (result.ok && result.data) {
        setSavedNotes((prev) => ({ ...prev, [message.id]: result.data!.noteId }));
      } else if (!result.ok) {
        setSaveError(result.error.message);
      }
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      {projects && projects.length > 0 && (
        <div className="border-b border-border px-3 py-2">
          <select
            aria-label="対象プロジェクト"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">指定なし（雑談・ネタ出し）</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">{EMPTY_MESSAGE[personaId]}</p>
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
                <div className="flex items-center gap-1 self-start">
                  {savedNotes[message.id] ? (
                    <>
                      <span className="flex items-center gap-1 px-2 text-xs text-muted-foreground">
                        <Check className="size-3" />
                        保存済み
                      </span>
                      <Link
                        href={`/notes/${savedNotes[message.id]}`}
                        className="flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        ノートをひらく
                      </Link>
                    </>
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={busy || savingId !== null || !dbIds.has(message.id)}
                      onClick={() => void handleSave(message)}
                    >
                      {savingId === message.id ? (
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <FilePlus2 data-icon="inline-start" />
                      )}
                      ノートに保存
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
        {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-3">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="会話をリセット"
                className="text-muted-foreground"
                disabled={busy}
              >
                <RotateCcw />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>会話をリセットしますか？</AlertDialogTitle>
              <AlertDialogDescription>
                この相手との会話履歴がすべて削除されます。この操作は元に戻せません。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction onClick={() => void onReset()}>リセットする</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="話しかける…"
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
