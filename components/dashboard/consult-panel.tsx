"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { isStaticToolUIPart, type ToolUIPart, type UIMessage } from "ai";
import {
  CalendarCheck,
  Check,
  CircleStop,
  ExternalLink,
  FilePlus2,
  History,
  Loader2,
  MessagesSquare,
  Send,
  SquarePen,
  X,
} from "lucide-react";

import {
  createDashboardThread,
  getDashboardThreadById,
  getLatestDashboardThread,
  saveChatMessageAsNote,
  type ChatMessageRecord,
} from "@/lib/actions/chat";
import { ASSISTANT_PERSONA_ID, CAFE_MASTER_PERSONA_ID } from "@/lib/ai/personas";
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

/** ツール execute の戻り値（app/api/chat/route.ts と対応） */
type ToolOutput =
  | { ok: true; noteId?: string; milestoneCount?: number }
  | { ok: false; message?: string };

/**
 * DB同期でメッセージを差し替える際、セッション内のツール結果カードを引き継ぐ
 * （chat_messages はテキストのみ保持のため、そのまま差し替えるとカードが即消える。
 * role＋テキスト一致の順方向マッチで tool part を新メッセージに移す。SPEC §5.2）。
 * 締めのテキストが空の応答は /api/chat の onEnd がDBに保存しない＝ next に
 * 対応行が存在しないため、マッチしなかったカード保持メッセージは捨てずに
 * 元の並び位置へ残す（捨てると保存成功したのにカードごと消えて見える）
 */
function mergeToolParts(current: UIMessage[], next: UIMessage[]): UIMessage[] {
  const candidates = current.filter(
    (message) => message.role === "assistant" && message.parts.some(isStaticToolUIPart),
  );
  let cursor = 0;
  const merged: UIMessage[] = [];
  for (const message of next) {
    if (message.role !== "assistant") {
      merged.push(message);
      continue;
    }
    const index = candidates.findIndex(
      (candidate, i) => i >= cursor && textOf(candidate) === textOf(message),
    );
    if (index === -1) {
      merged.push(message);
      continue;
    }
    // マッチ位置より手前で取り残されたカード保持メッセージ（DB未保存）を元の順で先に残す
    merged.push(...candidates.slice(cursor, index));
    cursor = index + 1;
    // 元メッセージと同じ並び（ツール実行→締めのテキスト）で先頭に置く
    merged.push({
      ...message,
      parts: [...candidates[index].parts.filter(isStaticToolUIPart), ...message.parts],
    });
  }
  // 末尾までマッチしなかったカード保持メッセージも残す（締めテキストなしの典型ケース）
  merged.push(...candidates.slice(cursor));
  return merged;
}

/** ツール呼び出しの結果カード（セッション内表示のみ。リロード後は消える。SPEC §5.2） */
function ToolCard({ part }: { part: ToolUIPart }) {
  const isSchedule = part.type === "tool-saveSchedule";
  const failedText = isSchedule
    ? "スケジュールの保存に失敗しました"
    : "ノートへの保存に失敗しました";

  if (part.state === "output-error") {
    return <p className="mr-4 self-start text-sm text-destructive">{failedText}</p>;
  }
  if (part.state !== "output-available") {
    return (
      <div className="mr-4 flex items-center gap-2 self-start rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {isSchedule ? "スケジュールを保存しています…" : "ノートに保存しています…"}
      </div>
    );
  }

  const output = part.output as ToolOutput | undefined;
  if (!output?.ok) {
    return <p className="mr-4 self-start text-sm text-destructive">{output?.message ?? failedText}</p>;
  }
  return (
    <div className="mr-4 flex flex-wrap items-center gap-2 self-start rounded-lg border border-border bg-card px-3 py-2 text-xs text-card-foreground">
      {isSchedule ? (
        <>
          <CalendarCheck className="size-3.5 text-muted-foreground" />
          スケジュールを保存しました
          {typeof output.milestoneCount === "number" && `（マイルストーン${output.milestoneCount}件）`}
        </>
      ) : (
        <>
          <Check className="size-3.5 text-muted-foreground" />
          ノートに保存しました
          {output.noteId && (
            <Link
              href={`/notes/${output.noteId}`}
              className="flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              <ExternalLink className="size-3" />
              ノートをひらく
            </Link>
          )}
        </>
      )}
    </div>
  );
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

/** 読み込み済みスレッド（threadId null = 未作成の新規会話状態） */
type LoadedThread = {
  threadId: string | null;
  messages: ChatMessageRecord[];
};

/**
 * ダッシュボードの「相談する」導線＋相談パネル。
 * `initialThreadId`（`/?consult=` 由来）があれば自動オープンして該当スレッドを開く
 */
export function ConsultLauncher({
  projects,
  initialThreadId,
}: {
  projects: ConsultProject[];
  initialThreadId?: string;
}) {
  const [open, setOpen] = useState(() => Boolean(initialThreadId));

  // /chats の行クリックで別スレッドの `/?consult=` に遷移した場合も開き直す
  // （render中のprop派生setState＝エフェクト不要のReact推奨パターン）
  const [lastThreadId, setLastThreadId] = useState(initialThreadId);
  if (initialThreadId !== lastThreadId) {
    setLastThreadId(initialThreadId);
    if (initialThreadId) setOpen(true);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MessagesSquare data-icon="inline-start" />
        相談する
      </Button>
      {open && (
        <ConsultPanel
          key={initialThreadId ?? "default"}
          projects={projects}
          initialThreadId={initialThreadId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** 相談パネル本体。lg以上は右サイドパネル、lg未満はボトムシート */
function ConsultPanel({
  projects,
  initialThreadId,
  onClose,
}: {
  projects: ConsultProject[];
  initialThreadId?: string;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<string>(TABS[0].personaId);
  // `?consult=` 指定時の初期スレッド解決: loading → 担当タブへシード or エラー表示
  const [consult, setConsult] = useState<
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "ready"; personaId: string; thread: LoadedThread }
    | { state: "none" }
  >(() => (initialThreadId ? { state: "loading" } : { state: "none" }));

  useEffect(() => {
    if (!initialThreadId) return;
    let cancelled = false;
    void getDashboardThreadById(initialThreadId).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setConsult({
          state: "error",
          message: result.ok ? "スレッドが見つかりません" : result.error.message,
        });
        return;
      }
      const personaId = result.data.personaId;
      if (!personaId || !TABS.some((tab) => tab.personaId === personaId)) {
        setConsult({ state: "error", message: "このスレッドは相談パネルでは開けません" });
        return;
      }
      setActiveTab(personaId);
      setConsult({
        state: "ready",
        personaId,
        thread: { threadId: result.data.threadId, messages: result.data.messages },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [initialThreadId]);

  return (
    <aside
      aria-label="相談パネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background shadow-lg lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:h-auto lg:w-96 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <MessagesSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">相談</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Link
            href="/chats"
            className="flex items-center gap-1 px-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <History className="size-3.5" />
            履歴
          </Link>
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

      {consult.state === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
        </div>
      ) : consult.state === "error" ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-destructive">{consult.message}</p>
        </div>
      ) : (
        <>
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
                preloaded={
                  consult.state === "ready" && consult.personaId === tab.personaId
                    ? consult.thread
                    : null
                }
              />
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

/**
 * 1ペルソナ分のスレッド。初期表示は最後に更新したスレッドの継続
 * （なければ未作成の新規会話状態）。「新しい会話」でローカルに空状態へ切り替える
 * （DB行は作らない＝スレッドは最初の送信時に作成。SPEC-chat-thread-list §3.1）
 */
function ConsultThread({
  personaId,
  projects,
  preloaded,
}: {
  personaId: string;
  /** プロジェクトセレクタを出すタブ（アシスタント）のみ非null */
  projects: ConsultProject[] | null;
  /** `?consult=` で指定されたスレッド（担当タブのみ非null） */
  preloaded: LoadedThread | null;
}) {
  const [thread, setThread] = useState<(LoadedThread & { chatKey: string }) | null>(() =>
    preloaded ? { ...preloaded, chatKey: preloaded.threadId ?? "new" } : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getLatestDashboardThread(personaId);
    if (result.ok && result.data) {
      setThread({
        threadId: result.data.threadId,
        messages: result.data.messages,
        chatKey: result.data.threadId ?? "new",
      });
    } else if (!result.ok) {
      setLoadError(result.error.message);
    }
  }, [personaId]);

  useEffect(() => {
    if (preloaded) return;
    let cancelled = false;
    void getLatestDashboardThread(personaId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        setThread({
          threadId: result.data.threadId,
          messages: result.data.messages,
          chatKey: result.data.threadId ?? "new",
        });
      } else if (!result.ok) {
        setLoadError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [personaId, preloaded]);

  /** 「新しい会話」: 空の新規会話状態へ（何も消えないため確認ダイアログ不要） */
  function handleNewConversation() {
    setThread({
      threadId: null,
      messages: [],
      chatKey: `new-${Date.now()}`,
    });
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
          key={thread.chatKey}
          personaId={personaId}
          initialThreadId={thread.threadId}
          initialMessages={thread.messages.map(toUIMessage)}
          initialDbIds={thread.messages.map((m) => m.id)}
          projects={projects}
          onNewConversation={handleNewConversation}
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
  initialThreadId,
  initialMessages,
  initialDbIds,
  projects,
  onNewConversation,
}: {
  personaId: string;
  /** null = 未作成（最初の送信時に createDashboardThread で作る） */
  initialThreadId: string | null;
  initialMessages: UIMessage[];
  initialDbIds: string[];
  projects: ConsultProject[] | null;
  onNewConversation: () => void;
}) {
  const [input, setInput] = useState("");
  const [projectId, setProjectId] = useState<string>(() =>
    projects ? defaultProjectId(projects) : "",
  );
  // スレッドは初回送信時に作成されるため、送信処理と同期タイマーの双方から
  // 最新のidを参照できるよう state と ref の二重持ちにする
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const threadIdRef = useRef<string | null>(initialThreadId);
  const [sendError, setSendError] = useState<string | null>(null);
  // DBに保存済みのメッセージid（＝「ノートに保存」を押せるもの）。
  // ストリーミング直後の応答はクライアント採番のidでDBと一致しないため、
  // 応答完了後にDBから履歴を取り直して差し替える
  const [dbIds, setDbIds] = useState<ReadonlySet<string>>(() => new Set(initialDbIds));
  const [savedNotes, setSavedNotes] = useState<Readonly<Record<string, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const syncTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const router = useRouter();
  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    messages: initialMessages,
    onFinish: ({ message }) => {
      // /api/chat の onEnd（DB保存）はストリーム終了後に完了するため、
      // 少し遅らせた二段取り直しでレースを吸収する（proofread-panel と同じ流儀）
      scheduleSync(300);
      scheduleSync(1500);
      // スケジュール保存に成功したら概況カード（server component）を更新する
      if (
        message.parts.some(
          (part) =>
            isStaticToolUIPart(part) &&
            part.type === "tool-saveSchedule" &&
            part.state === "output-available",
        )
      ) {
        router.refresh();
      }
    },
  });

  const busy = creating || status === "submitted" || status === "streaming";
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  function scheduleSync(delayMs: number) {
    syncTimers.current.push(
      setTimeout(() => {
        // 次の送信が始まっていたら差し替えない（onFinish 時に改めて同期される）
        if (statusRef.current === "submitted" || statusRef.current === "streaming") return;
        const syncThreadId = threadIdRef.current;
        if (!syncThreadId) return;
        void getDashboardThreadById(syncThreadId).then((result) => {
          if (!result.ok || !result.data) return;
          if (statusRef.current === "submitted" || statusRef.current === "streaming") return;
          if (result.data.threadId !== threadIdRef.current) return;
          // ツール結果カードはDBに残らないため、差し替え時に現在のメッセージから引き継ぐ
          const next = result.data.messages.map(toUIMessage);
          setMessages((current) => mergeToolParts(current, next));
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setSendError(null);

    // 未作成の新規会話状態なら、最初の送信時にスレッドを作る（§3.1）
    let currentThreadId = threadId;
    if (!currentThreadId) {
      setCreating(true);
      try {
        const result = await createDashboardThread(personaId);
        if (!result.ok || !result.data) {
          setSendError(result.ok ? "スレッドの作成に失敗しました" : result.error.message);
          return;
        }
        currentThreadId = result.data.threadId;
        setThreadId(currentThreadId);
        threadIdRef.current = currentThreadId;
      } finally {
        setCreating(false);
      }
    }

    setInput("");
    // 対象プロジェクトはリクエスト単位のコンテキスト（スレッドとは独立。SPEC §3.2）
    void sendMessage(
      { text },
      {
        body: {
          threadId: currentThreadId,
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
              {/* ツール結果カードは本文（締めのテキスト）より前＝実行順に表示する */}
              {message.role === "assistant" &&
                message.parts
                  .filter(isStaticToolUIPart)
                  .map((part) => <ToolCard key={part.toolCallId} part={part} />)}
              {(message.role === "user" || textOf(message)) && (
                <div
                  className={
                    message.role === "user"
                      ? "ml-8 self-end rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                      : "mr-4 self-start rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground"
                  }
                >
                  {textOf(message)}
                </div>
              )}
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
        {sendError && <p className="mt-3 text-sm text-destructive">{sendError}</p>}
        {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="新しい会話"
          className="text-muted-foreground"
          disabled={busy || messages.length === 0}
          onClick={onNewConversation}
        >
          <SquarePen />
        </Button>
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
