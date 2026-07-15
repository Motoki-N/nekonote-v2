"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** プロジェクト配下のタブナビ（企画書 | ビートボード。SPEC-beat-board §3.1） */
export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/projects/${projectId}`, label: "企画書", exact: true },
    { href: `/projects/${projectId}/board`, label: "ビートボード", exact: false },
    { href: `/projects/${projectId}/manuscript`, label: "原稿", exact: false },
    { href: `/projects/${projectId}/editor`, label: "エディタ", exact: false },
  ];

  return (
    <nav aria-label="プロジェクトのタブ" className="flex gap-1">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
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
