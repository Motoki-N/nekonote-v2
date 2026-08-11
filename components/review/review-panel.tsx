"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CircleStop,
  ClipboardCheck,
  Loader2,
  Maximize2,
  Minimize2,
  NotebookPen,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getOrCreateReviewSession,
  getReviewPanelBootstrap,
  getReviewSessionState,
  saveFeedbackAsNote,
  saveFeedbackResponse,
  type FeedbackRecord,
  type ReviewPanelBootstrap,
  type ReviewSessionState,
  type ReviewTargetKind,
} from "@/lib/actions/review";
import type { ReviewVerdict } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// 過去のフィードバックを最新のものと誤認しないよう、各回に実施日時を明示する
const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** /api/review の errorResponse（JSON）からユーザー向けメッセージを取り出す */
async function toDisplayError(res: Response): Promise<string> {
  try {
    const parsed = (await res.json()) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // JSON でなければ汎用文言にフォールバック
  }
  return "レビューの実行に失敗しました。時間をおいて再試行してください";
}

function VerdictBadge({ verdict }: { verdict: FeedbackRecord["verdict"] }) {
  // null = 判定なし（ゲート化前の構成/シーンレビュー履歴等）。差し戻し扱いにせずバッジを出さない
  if (verdict === null || verdict === undefined) return null;
  if (verdict === "approved") {
    return (
      <Badge variant="default">
        <BadgeCheck data-icon="inline-start" />
        承認
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <Undo2 data-icon="inline-start" />
      差し戻し
    </Badge>
  );
}

export type ReviewFooterContext = {
  latestVerdict: ReviewVerdict | null;
  busy: boolean;
  /** 表示中の running セッション（未作成なら null）。「企画を通す」等が対象を特定するのに使う */
  sessionId: string | null;
};

/**
 * レビューパネル（企画書・構成・シーン共通。SPEC-beat-board §3.4）。
 * lg以上は右サイドパネル、lg未満はボトムシート。
 * プロファイルごとにセッションが並存し、セレクタで切り替える（SPEC-dashboard-critique-settings §3.2）。
 * セッション状態はプロファイル別にキャッシュし、担当ペルソナは新規セッション開始時のみ選択できる。
 * 対象（kind + targetId + noteId）を切り替えて使う場合は key で使い分けること
 */
export function ReviewPanel({
  kind,
  targetId,
  noteId,
  title,
  subtitle,
  emptyText,
  showVerdict,
  enableCopyToNote = false,
  flushSave,
  onClose,
  renderFooter,
  headerExtra,
}: {
  kind: ReviewTargetKind;
  targetId: string;
  /** キャラクターレビューをノート1枚に絞る場合のみ指定（Issue #47） */
  noteId?: string;
  title: string;
  /** 対象名の補足表示（シーンレビューのシーン名等） */
  subtitle?: string;
  emptyText: string;
  /** 判定バッジの表示（企画書レビューのみ true。構成・シーンは都度フィードバック型） */
  showVerdict: boolean;
  /** 「ノートに転記」ボタンの表示（企画書=Issue #99・構成=Issue #173 のみ true） */
  enableCopyToNote?: boolean;
  /** レビュー実行前に編集内容をDBへ確定させる（レビューは保存済みDB値で行う） */
  flushSave?: () => Promise<void>;
  onClose: () => void;
  /** フッター拡張（企画書レビューの「企画を通す」等） */
  renderFooter?: (context: ReviewFooterContext) => React.ReactNode;
  /** ヘッダー拡張（キャラクターレビューの対象ノート絞り込みセレクタ等。Issue #47） */
  headerExtra?: React.ReactNode;
}) {
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<ReviewPanelBootstrap | null>(null);
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  // プロファイル別のセッションキャッシュ（undefined=未ロード / null=runningなし）
  const [sessionByProfile, setSessionByProfile] = useState<
    Record<string, ReviewSessionState | null>
  >({});
  // プロファイル別のユーザー選択（未選択時は default_persona にフォールバック）
  const [personaChoice, setPersonaChoice] = useState<Record<string, string>>(
    {},
  );
  // このパネルで新規作成したセッションのペルソナ名（作成後は固定表示）
  const [createdPersonaName, setCreatedPersonaName] = useState<
    Record<string, string>
  >({});
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // コメントを広く読みたいとき用の中央拡大表示（Issue #81）
  const [expanded, setExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const busy = streamingText !== null;

  // 開いたときにプロファイル・ペルソナ一覧と既定選択を読む
  useEffect(() => {
    let cancelled = false;
    void getReviewPanelBootstrap(kind, targetId, noteId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        setBootstrap(result.data);
        setSelectedProfileId(result.data.initialProfileId);
      } else {
        setError(
          result.ok ? "レビュー設定の取得に失敗しました" : result.error.message,
        );
      }
      setBootstrapDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, targetId, noteId]);

  // 選択中プロファイルのセッション状態が未ロードなら読む（キャッシュヒット時は何もしない）
  useEffect(() => {
    if (
      selectedProfileId === null ||
      sessionByProfile[selectedProfileId] !== undefined
    )
      return;
    const profileId = selectedProfileId;
    let cancelled = false;
    void getReviewSessionState(kind, targetId, profileId, noteId).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) setError(result.error.message);
        setSessionByProfile((prev) => ({
          ...prev,
          [profileId]: result.ok ? (result.data ?? null) : null,
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedProfileId, sessionByProfile, kind, targetId, noteId]);

  // 表示用の導出値（プロファイル切り替えで自動的に切り替わる）
  const profile =
    bootstrap?.profiles.find((p) => p.id === selectedProfileId) ?? null;
  const sessionState =
    selectedProfileId !== null ? sessionByProfile[selectedProfileId] : null;
  const loaded =
    bootstrapDone && (selectedProfileId === null || sessionState !== undefined);
  const sessionId = sessionState?.sessionId ?? null;
  const feedbacks = sessionState?.feedbacks ?? [];
  const effectivePersonaId =
    selectedProfileId !== null
      ? (personaChoice[selectedProfileId] ?? profile?.defaultPersonaId ?? null)
      : null;
  const personaFixedName =
    selectedProfileId !== null
      ? (createdPersonaName[selectedProfileId] ??
        profile?.runningPersonaName ??
        null)
      : null;

  // ストリーミング中は追記に合わせて最下部へ追従
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionState, streamingText]);

  const runReview = useCallback(async () => {
    if (busy || selectedProfileId === null || effectivePersonaId === null)
      return;
    const profileId = selectedProfileId;
    setError(null);

    // 編集中の内容を保存してから、保存済みDB値でレビューする
    if (flushSave) await flushSave();

    const session = await getOrCreateReviewSession(
      kind,
      targetId,
      profileId,
      effectivePersonaId,
      noteId,
    );
    if (!session.ok || !session.data) {
      setError(
        session.ok ? "セッションの取得に失敗しました" : session.error.message,
      );
      return;
    }
    const sessionData = session.data;
    setSessionByProfile((prev) => ({ ...prev, [profileId]: sessionData }));
    // セッションが立った時点でペルソナは固定される（途中変更不可）
    const persona = bootstrap?.personas.find(
      (p) => p.id === effectivePersonaId,
    );
    if (persona) {
      setCreatedPersonaName((prev) => ({ ...prev, [profileId]: persona.name }));
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingText("");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionData.sessionId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setError(await toDisplayError(res));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setStreamingText((prev) => (prev ?? "") + chunk);
      }
      // 完了: 保存済みフィードバック（verdict込み）を取り直し、status バッジ等も更新する
      const refreshed = await getReviewSessionState(
        kind,
        targetId,
        profileId,
        noteId,
      );
      if (refreshed.ok) {
        setSessionByProfile((prev) => ({
          ...prev,
          [profileId]: refreshed.data ?? sessionData,
        }));
      }
      router.refresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // stop ボタンによる中断。未完のフィードバックは保存されない
      } else {
        setError(
          "レビューの実行に失敗しました。時間をおいて再試行してください",
        );
      }
    } finally {
      abortRef.current = null;
      setStreamingText(null);
    }
  }, [
    busy,
    flushSave,
    kind,
    targetId,
    noteId,
    selectedProfileId,
    effectivePersonaId,
    bootstrap,
    router,
  ]);

  const latest = feedbacks.at(-1);
  const footerExtra =
    renderFooter?.({
      latestVerdict: latest?.verdict ?? null,
      busy,
      sessionId,
    }) ?? null;

  // 新規セッション（running なし）のときだけペルソナを選べる
  const personaSelectable = loaded && sessionId === null && !busy;
  const personaDisplayName =
    personaFixedName ??
    bootstrap?.personas.find((p) => p.id === effectivePersonaId)?.name ??
    "";

  return (
    <aside
      aria-label={`${title}パネル`}
      className={
        expanded
          ? "fixed inset-0 z-30 m-auto flex h-[90dvh] w-[min(100%,48rem)] flex-col rounded-lg border border-border bg-background shadow-lg"
          : "fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
      }
    >
      <header className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{title}</span>
          {subtitle && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={expanded ? "サイド表示に戻す" : "中央に広く表示"}
              aria-pressed={expanded}
              className="text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </Button>
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
        </div>
        {headerExtra}
        {bootstrap && bootstrap.profiles.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              aria-label="レビュープロファイル"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={selectedProfileId ?? ""}
              disabled={busy}
              onChange={(e) => {
                setError(null);
                setSelectedProfileId(e.target.value);
              }}
            >
              {bootstrap.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {personaSelectable ? (
              <select
                aria-label="担当ペルソナ"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={effectivePersonaId ?? ""}
                onChange={(e) => {
                  const profileId = selectedProfileId;
                  const value = e.target.value;
                  if (profileId === null || value === "") return;
                  setPersonaChoice((prev) => ({ ...prev, [profileId]: value }));
                }}
              >
                {effectivePersonaId === null && (
                  <option value="">担当を選択…</option>
                )}
                {bootstrap.personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {personaDisplayName}
              </span>
            )}
          </div>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <div className="flex h-full items-center justify-center">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="読み込み中"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {feedbacks.length === 0 && streamingText === null && (
              <p className="p-2 text-sm text-muted-foreground">{emptyText}</p>
            )}
            {feedbacks.map((feedback, index) => (
              <FeedbackCard
                key={feedback.id}
                feedback={feedback}
                round={index + 1}
                showVerdict={showVerdict}
                enableCopyToNote={enableCopyToNote}
                disabled={busy}
              />
            ))}
            {streamingText !== null && (
              <article className="rounded-lg border border-border bg-card p-3">
                <header className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  レビュー中…
                </header>
                <div className="text-sm whitespace-pre-wrap text-card-foreground">
                  {streamingText}
                </div>
              </article>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-border p-3">
        {footerExtra}
        {busy ? (
          <Button
            variant="outline"
            onClick={() => abortRef.current?.abort()}
            aria-label="レビューを停止"
          >
            <CircleStop data-icon="inline-start" />
            停止
          </Button>
        ) : (
          // フッター拡張（企画を通す等）があるときはそちらを主役にする
          <Button
            variant={footerExtra ? "outline" : "default"}
            onClick={() => void runReview()}
            disabled={
              !loaded ||
              selectedProfileId === null ||
              effectivePersonaId === null
            }
          >
            {feedbacks.length === 0 ? "レビューを受ける" : "再レビューを受ける"}
          </Button>
        )}
      </footer>
    </aside>
  );
}

function FeedbackCard({
  feedback,
  round,
  showVerdict,
  enableCopyToNote,
  disabled,
}: {
  feedback: FeedbackRecord;
  round: number;
  showVerdict: boolean;
  enableCopyToNote: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [response, setResponse] = useState(feedback.user_response ?? "");
  const [savedResponse, setSavedResponse] = useState(
    feedback.user_response ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  // 指摘対応をメモしながら進められるよう、フィードバック本文をノートへ転記する（Issue #99）
  async function handleCopyToNote() {
    if (copying) return;
    setCopying(true);
    try {
      const result = await saveFeedbackAsNote(feedback.id);
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "ノートへの転記に失敗しました" : result.error.message,
        );
        return;
      }
      const noteId = result.data.noteId;
      toast("レビューをノートに転記しました", {
        action: {
          label: "ノートをひらく",
          onClick: () => router.push(`/notes/${noteId}`),
        },
      });
    } finally {
      setCopying(false);
    }
  }

  async function handleSaveResponse() {
    if (saving || response === savedResponse) return;
    setSaving(true);
    try {
      const result = await saveFeedbackResponse(feedback.id, response);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setSavedResponse(response);
      toast("返答メモを保存しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-lg border border-border bg-card p-3">
      <header className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          第{round}回 {dateTimeFormat.format(new Date(feedback.created_at))}
        </span>
        {showVerdict && <VerdictBadge verdict={feedback.verdict} />}
        {enableCopyToNote && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => void handleCopyToNote()}
            disabled={disabled || copying}
          >
            <NotebookPen data-icon="inline-start" />
            ノートに転記
          </Button>
        )}
      </header>
      <div className="text-sm whitespace-pre-wrap text-card-foreground">
        {feedback.content}
      </div>
      <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-2">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`response-${feedback.id}`}
        >
          返答メモ（改稿の意図・反論を次のレビューに伝える）
        </label>
        <Textarea
          id={`response-${feedback.id}`}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="例: ターゲット層を高校生に絞り、コンセプトを書き直しました"
          className="min-h-16 text-sm"
          disabled={disabled}
        />
        <Button
          size="xs"
          variant="outline"
          className="self-end"
          onClick={handleSaveResponse}
          disabled={disabled || saving || response === savedResponse}
        >
          メモを保存
        </Button>
      </div>
    </article>
  );
}
