"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** プロジェクト配下のタブナビ（企画書 | ビートボード。SPEC-beat-board §3.1）。
 * boardLabel は執筆ジャンルで出し分ける（小説=ビートボード / 技術書・その他=目次。SPEC-outline-board §3.1） */
export function ProjectTabs({
  projectId,
  boardLabel = "ビートボード",
}: {
  projectId: string;
  boardLabel?: string;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: `/projects/${projectId}`, label: "企画書", exact: true },
    { href: `/projects/${projectId}/board`, label: boardLabel, exact: false },
    { href: `/projects/${projectId}/manuscript`, label: "原稿", exact: false },
    { href: `/projects/${projectId}/editor`, label: "エディタ", exact: false },
    // 過去レビューセッションの閲覧（SPEC-review-history §3.1）
    {
      href: `/projects/${projectId}/reviews`,
      label: "レビュー履歴",
      exact: false,
    },
  ];

  return (
    <nav aria-label="プロジェクトのタブ" className="flex gap-1">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
