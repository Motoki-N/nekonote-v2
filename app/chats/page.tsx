import Link from "next/link";

import { listConsultThreads } from "@/lib/actions/chat";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThreadList } from "@/components/chats/thread-list";

/**
 * ダッシュボード相談スレッドの一覧・リネーム・削除（SPEC-chat-thread-list §3.2）。
 * 会話の場は相談パネル＝行クリックで `/?consult=` に遷移して開く
 */
export default async function ChatsPage() {
  const result = await listConsultThreads();
  const threads = result.ok && result.data ? result.data : [];

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-semibold text-foreground">
            🐱
          </Link>
          <h1 className="text-lg font-semibold text-foreground">会話の履歴</h1>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        {!result.ok ? (
          <p className="py-12 text-center text-sm text-destructive">{result.error.message}</p>
        ) : (
          <ThreadList threads={threads} />
        )}
      </main>
    </div>
  );
}
