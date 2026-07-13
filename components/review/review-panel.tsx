"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CircleStop, ClipboardCheck, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import {
  getOrCreateReviewSession,
  getReviewSessionState,
  saveFeedbackResponse,
  type FeedbackRecord,
  type ReviewTargetKind,
} from "@/lib/actions/review";
import type { ReviewVerdict } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
};

/**
 * レビューパネル（企画書・構成・シーン共通。SPEC-beat-board §3.4）。
 * lg以上は右サイドパネル、lg未満はボトムシート。
 * 対象（kind + targetId）を切り替えて使う場合は key={targetId} で使い分けること
 */
export function ReviewPanel({
  kind,
  targetId,
  title,
  personaLabel = "担当編集",
  emptyText,
  showVerdict,
  flushSave,
  onClose,
  renderFooter,
}: {
  kind: ReviewTargetKind;
  targetId: string;
  title: string;
  personaLabel?: string;
  emptyText: string;
  /** 判定バッジの表示（企画書レビューのみ true。構成・シーンは都度フィードバック型） */
  showVerdict: boolean;
  /** レビュー実行前に編集内容をDBへ確定させる（レビューは保存済みDB値で行う） */
  flushSave?: () => Promise<void>;
  onClose: () => void;
  /** フッター拡張（企画書レビューの「企画を通す」等） */
  renderFooter?: (context: ReviewFooterContext) => React.ReactNode;
}) {
  const router = useRouter();
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const busy = streamingText !== null;

  // 開いたときに running セッションの履歴を読む（開いただけではセッションを作らない）
  useEffect(() => {
    let cancelled = false;
    void getReviewSessionState(kind, targetId).then((result) => {
      if (cancelled) return;
      if (result.ok) setFeedbacks(result.data?.feedbacks ?? []);
      else setError(result.error.message);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, targetId]);

  // ストリーミング中は追記に合わせて最下部へ追従
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feedbacks, streamingText]);

  const runReview = useCallback(async () => {
    if (busy) return;
    setError(null);

    // 編集中の内容を保存してから、保存済みDB値でレビューする
    if (flushSave) await flushSave();

    const session = await getOrCreateReviewSession(kind, targetId);
    if (!session.ok || !session.data) {
      setError(session.ok ? "セッションの取得に失敗しました" : session.error.message);
      return;
    }
    setFeedbacks(session.data.feedbacks);

    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingText("");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.data.sessionId }),
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
      const refreshed = await getReviewSessionState(kind, targetId);
      if (refreshed.ok) setFeedbacks(refreshed.data?.feedbacks ?? []);
      router.refresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // stop ボタンによる中断。未完のフィードバックは保存されない
      } else {
        setError("レビューの実行に失敗しました。時間をおいて再試行してください");
      }
    } finally {
      abortRef.current = null;
      setStreamingText(null);
    }
  }, [busy, flushSave, kind, targetId, router]);

  const latest = feedbacks.at(-1);
  const footerExtra = renderFooter?.({ latestVerdict: latest?.verdict ?? null, busy }) ?? null;

  return (
    <aside
      aria-label={`${title}パネル`}
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ClipboardCheck className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{personaLabel}</span>
        <div className="ml-auto flex items-center gap-0.5">
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
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
          <Button variant={footerExtra ? "outline" : "default"} onClick={() => void runReview()}>
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
  disabled,
}: {
  feedback: FeedbackRecord;
  round: number;
  showVerdict: boolean;
  disabled: boolean;
}) {
  const [response, setResponse] = useState(feedback.user_response ?? "");
  const [savedResponse, setSavedResponse] = useState(feedback.user_response ?? "");
  const [saving, setSaving] = useState(false);

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
        <span className="text-xs text-muted-foreground">第{round}回</span>
        {showVerdict && <VerdictBadge verdict={feedback.verdict} />}
      </header>
      <div className="text-sm whitespace-pre-wrap text-card-foreground">{feedback.content}</div>
      <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-2">
        <label className="text-xs text-muted-foreground" htmlFor={`response-${feedback.id}`}>
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
