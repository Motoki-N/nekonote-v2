import Link from "next/link";

import { getZennWorkspace } from "@/lib/actions/zenn";
import { ZennWorkspace } from "@/components/zenn/zenn-workspace";

/**
 * Zenn記事の新規投稿画面（SPEC-zenn-integration §3.2）。
 * 前提未達（PAT / zenn_repo）は設定画面への誘導を表示する（gate方式）
 */
export default async function ZennNewPage() {
  const workspace = await getZennWorkspace();

  if (!workspace.ok || !workspace.data) {
    return (
      <Gate
        message={
          workspace.ok ? "読み込みに失敗しました" : workspace.error.message
        }
      />
    );
  }

  const data = workspace.data;
  if (data.gate === "no_pat") {
    return (
      <Gate message="GitHub PATが未登録です。設定のGitHub連携から登録してください。PATの対象リポジトリにZenn連携リポジトリを含める必要があります。" />
    );
  }
  if (data.gate === "no_zenn_repo") {
    return (
      <Gate message="Zenn連携リポジトリが未登録です。設定のZenn連携から登録してください。" />
    );
  }

  // slug の初期値はサーバーで生成して渡す（クライアント初期化だとSSRとのハイドレーション不一致になる）
  const initialSlug = crypto.randomUUID().replace(/-/g, "").slice(0, 14);

  return <ZennWorkspace repo={data.repo} initialSlug={initialSlug} />;
}

function Gate({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">Zennへ投稿</h1>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-4 p-6">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link
          href="/settings"
          className="text-sm font-medium text-primary underline"
        >
          設定を開く
        </Link>
      </main>
    </div>
  );
}
