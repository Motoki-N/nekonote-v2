"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** グローバルナビの行き先（現在地判定は前方一致。ダッシュボードはロゴが担う） */
const NAV_ITEMS = [
  { href: "/projects", label: "プロジェクト" },
  { href: "/notes", label: "ノート" },
  { href: "/atelier", label: "アトリエ" },
  { href: "/chats", label: "相談" },
  { href: "/zenn/new", label: "Zenn" },
] as const;

/** 全認証ページ共通のグローバルナビゲーションバー（現在地ハイライト付き） */
export function AppHeader() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2 sm:px-6">
      {/* モバイル: ナビリンクをハンバーガーに畳む */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="メニュー"
              className="text-muted-foreground sm:hidden"
            >
              <Menu />
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {NAV_ITEMS.map((item) => (
            <DropdownMenuItem
              key={item.href}
              render={<Link href={item.href}>{item.label}</Link>}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Link
        href="/"
        className="shrink-0 text-base font-semibold text-foreground"
        aria-label="ダッシュボードへ"
      >
        🐱 <span className="hidden md:inline">ネコノテAI</span>
      </Link>

      <nav aria-label="グローバルナビ" className="ml-2 hidden gap-1 sm:flex">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive(item.href)
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="設定"
          className={cn(
            isActive("/settings") ? "text-foreground" : "text-muted-foreground",
          )}
          nativeButton={false}
          render={
            <Link
              href="/settings"
              aria-current={isActive("/settings") ? "page" : undefined}
            >
              <Settings />
            </Link>
          }
        />
        <ThemeToggle />
        <form action="/logout" method="post">
          <Button type="submit" variant="ghost" size="sm">
            ログアウト
          </Button>
        </form>
      </div>
    </header>
  );
}
