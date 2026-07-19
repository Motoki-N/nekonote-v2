"use client";

import Link from "next/link";
import { ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { DEFAULT_SORT, SORT_OPTIONS, type SortValue } from "@/components/notes/sort-options";

function buildHref(q: string | undefined, tagsParam: string | undefined, sort: SortValue): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tagsParam) params.set("tags", tagsParam);
  if (sort !== DEFAULT_SORT) params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/notes?${qs}` : "/notes";
}

/** ノート一覧のソート切替。選択状態はURLの searchParams が正（検索・タグ選択は維持） */
export function SortMenu({
  sort,
  q,
  tagsParam,
}: {
  sort: SortValue;
  q?: string;
  tagsParam?: string;
}) {
  const current = SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <ArrowUpDown data-icon="inline-start" />
            {current.label}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            render={<Link href={buildHref(q, tagsParam, option.value)}>{option.label}</Link>}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
