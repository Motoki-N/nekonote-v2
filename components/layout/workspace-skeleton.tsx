/**
 * 原稿タブ・エディタタブの読み込み中スケルトン（Issue #290）。
 * どちらもサーバー側の GitHub 取得を待ってから描画するため、タブクリック直後の
 * 無反応を避ける目的で loading.tsx から表示する（ツールバー＋左一覧＋本文の骨組み）
 */
export function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="h-7 w-32 animate-pulse rounded-md bg-muted" />
        <div className="ml-auto h-7 w-20 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-64 shrink-0 flex-col gap-2 border-r border-border p-3 lg:flex">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-muted" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-6">
          <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
