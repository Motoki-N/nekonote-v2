"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";

import { approveProposal } from "@/lib/actions/review";
import type { ProposalStatus } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import { ReviewPanel } from "@/components/review/review-panel";

/**
 * 企画書レビューゲートパネル（SPEC-proposal-review §3.2）。
 * 共通レビューパネルに判定バッジ＋「企画を通す」フッターを載せたもの
 */
export function ProposalReviewPanel({
  proposalId,
  proposalStatus,
  flushSave,
  onClose,
}: {
  proposalId: string;
  proposalStatus: ProposalStatus;
  /** レビュー実行前にエディタの編集内容をDBへ確定させる（レビューは保存済みDB値で行う） */
  flushSave: () => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);

  // 承認はセッション単位（プロファイル並存のため、表示中のセッションを明示して確定する）
  async function handleApprove(sessionId: string) {
    if (approving) return;
    setApproving(true);
    try {
      const result = await approveProposal(sessionId);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast("企画が通りました！執筆準備に進みましょう");
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  return (
    <ReviewPanel
      kind="proposal"
      targetId={proposalId}
      title="企画書レビュー"
      emptyText="企画書がまとまってきたら、担当編集のレビューを受けましょう。承認が出るまで、指摘 → 改稿 → 再レビューを繰り返します。"
      showVerdict
      enableCopyToNote
      flushSave={flushSave}
      onClose={onClose}
      renderFooter={({ latestVerdict, busy, sessionId }) => {
        if (
          latestVerdict === "approved" &&
          proposalStatus !== "approved" &&
          !busy &&
          sessionId !== null
        ) {
          return (
            <Button
              onClick={() => void handleApprove(sessionId)}
              disabled={approving}
            >
              <BadgeCheck data-icon="inline-start" />
              企画を通す
            </Button>
          );
        }
        if (proposalStatus === "approved") {
          return (
            <p className="text-center text-xs text-muted-foreground">
              この企画は承認済みです。再審査したいときは、もう一度レビューを受けてください
            </p>
          );
        }
        return null;
      }}
    />
  );
}
