import Link from "next/link";

import { getGithubConnection } from "@/lib/actions/settings";
import { ThemeToggle } from "@/components/theme-toggle";
import { GithubConnection } from "@/components/settings/github-connection";

/** 設定画面（SPEC-proofreading §3.1）。現状はGitHub連携のみ。Sprint 5 の設定拡張の受け皿 */
export default async function SettingsPage() {
  const connection = await getGithubConnection();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-semibold text-foreground">
            🐱
          </Link>
          <h1 className="text-lg font-semibold text-foreground">設定</h1>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">GitHub連携</h2>
          <p className="text-sm text-muted-foreground">
            原稿リポジトリの読み込みに使う Personal Access Token（PAT）を登録します。
            トークンは暗号化して保存され、登録後に値が表示されることはありません。
          </p>
          {connection.ok ? (
            <GithubConnection
              initialConnected={connection.data?.connected ?? false}
              initialUsername={connection.data?.username ?? null}
            />
          ) : (
            <p className="text-sm text-destructive">{connection.error.message}</p>
          )}
        </section>
      </main>
    </div>
  );
}
