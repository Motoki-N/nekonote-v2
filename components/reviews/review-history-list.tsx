"use client";

import { useState } from "react";
import { BadgeCheck, Copy, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import {
  getReviewHistoryFeedbacks,
  type ReviewHistoryFeedback,
  type ReviewSessionSummary,
} from "@/lib/actions/review-history";
import type { ReviewVerdict } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

// フェーズ表示名（review_profiles.target_phase 由来。null = プロファイル削除済みで導出不能）
const phaseLabels: Record<
  NonNullable<ReviewSessionSummary["phase"]>,
  string
> = {
  proposal: "企画書",
  structure: "構成",
  scene: "シーン",
  character: "キャラクター",
  manuscript: "講評",
};

const statusBadges: Record<
  ReviewSessionSummary["status"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  running: { label: "実施中", variant: "secondary" },
  completed: { label: "完了", variant: "default" },
  failed: { label: "失敗", variant: "destructive" },
};

function VerdictBadge({ verdict }: { verdict: ReviewVerdict | null }) {
  // null = 判定なし（ゲート化前の履歴・都度フィードバック型）。バッジを出さない
  if (verdict === null) return null;
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

/**
 * レビュー履歴の一覧（SPEC-review-history §3.2）。
 * アコーディオン行を開いた時点でフィードバックを遅延取得する読み取り専用ビュー
 */
export function ReviewHistoryList({
  sessions,
}: {
  sessions: ReviewSessionSummary[];
}) {
  // セッション別のフィードバックキャッシュ（undefined=未ロード / null=取得失敗）
  const [feedbacksBySession, setFeedbacksBySession] = useState<
    Record<string, ReviewHistoryFeedback[] | null>
  >({});

  async function loadFeedbacks(sessionId: string) {
    if (feedbacksBySession[sessionId] !== undefined) return;
    const result = await getReviewHistoryFeedbacks(sessionId);
    if (!result.ok) {
      toast.error(result.error.message);
      setFeedbacksBySession((prev) => ({ ...prev, [sessionId]: null }));
      return;
    }
    setFeedbacksBySession((prev) => ({
      ...prev,
      [sessionId]: result.data ?? [],
    }));
  }

  if (sessions.length === 0) {
    return (
      <p className="p-2 text-sm text-muted-foreground">
        まだレビュー履歴がありません
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => {
        const feedbacks = feedbacksBySession[session.sessionId];
        const status = statusBadges[session.status];
        return (
          <details
            key={session.sessionId}
            className="group rounded-lg border border-border bg-card"
            onToggle={(e) => {
              if (e.currentTarget.open) void loadFeedbacks(session.sessionId);
            }}
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 p-3 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
              <Badge variant="outline">
                {session.phase !== null
                  ? phaseLabels[session.phase]
                  : "レビュー"}
              </Badge>
              <span className="font-medium text-card-foreground">
                {session.profileName ?? "（削除済みプロファイル）"}
              </span>
              {session.personaName && <span>{session.personaName}</span>}
              {session.targetLabel && (
                <span className="min-w-0 truncate">{session.targetLabel}</span>
              )}
              <Badge variant={status.variant}>{status.label}</Badge>
              <VerdictBadge verdict={session.latestVerdict} />
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <span>{session.feedbackCount}回</span>
                <span>
                  {dateTimeFormat.format(new Date(session.createdAt))}
                </span>
              </span>
            </summary>
            <div className="flex flex-col gap-3 border-t border-border p-3">
              {feedbacks === undefined ? (
                <Loader2
                  className="size-4 animate-spin self-center text-muted-foreground"
                  aria-label="読み込み中"
                />
              ) : feedbacks === null ? (
                <p className="text-sm text-destructive">
                  フィードバックの取得に失敗しました
                </p>
              ) : feedbacks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  フィードバックはありません
                </p>
              ) : (
                feedbacks.map((feedback, index) => (
                  <FeedbackView
                    key={feedback.id}
                    feedback={feedback}
                    round={index + 1}
                  />
                ))
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function FeedbackView({
  feedback,
  round,
}: {
  feedback: ReviewHistoryFeedback;
  round: number;
}) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(feedback.content);
      toast("フィードバックをコピーしました");
    } catch {
      toast.error("コピーに失敗しました");
    }
  }

  return (
    <article className="rounded-lg border border-border bg-background p-3">
      <header className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>第{round}回</span>
        <VerdictBadge verdict={feedback.verdict} />
        <span>{dateTimeFormat.format(new Date(feedback.createdAt))}</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          onClick={() => void handleCopy()}
        >
          <Copy data-icon="inline-start" />
          コピー
        </Button>
      </header>
      <div className="text-sm whitespace-pre-wrap text-foreground">
        {feedback.content}
      </div>
      {feedback.userResponse !== null && (
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
          <span className="text-xs text-muted-foreground">返答メモ</span>
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {feedback.userResponse}
          </p>
        </div>
      )}
    </article>
  );
}
