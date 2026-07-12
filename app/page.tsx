import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">🐱 ネコノテAI</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action="/logout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              ログアウト
            </Button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-2xl font-bold text-foreground">
          第二期、基盤構築中です
        </p>
        <p className="text-sm text-muted-foreground">
          小説は人間が書き、AIはネタ出し・レビュー・校正で伴走する。
        </p>
        <Button nativeButton={false} render={<Link href="/notes">ノートをひらく</Link>} />
      </main>
    </div>
  );
}
