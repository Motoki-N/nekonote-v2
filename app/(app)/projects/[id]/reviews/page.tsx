import { listReviewSessions } from "@/lib/actions/review-history";
import { ReviewHistoryList } from "@/components/reviews/review-history-list";

/**
 * レビュー履歴ページ（SPEC-review-history §3.2）。
 * プロジェクトの全レビューセッション（全フェーズ・全ステータス）を一覧し、
 * 過去のフィードバック往復を読み取り専用で閲覧できる。
 * プロジェクトの存在確認とヘッダーは layout.tsx が担う
 */
export default async function ReviewHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await listReviewSessions(id);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          レビュー履歴
        </h2>
        {result.ok ? (
          <ReviewHistoryList sessions={result.data ?? []} />
        ) : (
          <p className="text-sm text-destructive">{result.error.message}</p>
        )}
      </div>
    </div>
  );
}
