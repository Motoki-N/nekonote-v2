"use client";

import type { DiffRow } from "@/lib/diff";
import { cn } from "@/lib/utils";

/**
 * 行diffの表示（SPEC-manuscript-history §2 の表示流儀）。
 * 原稿タブのコミット差分（parsePatch）と企画書の版間差分（diffTexts）で共用する。
 * パースは lib/diff.ts（純粋ロジック）に分離
 */
export function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="flex flex-col overflow-x-auto rounded-md border border-border text-sm leading-6">
      {rows.map((row, i) => {
        if (row.kind === "hunk") {
          return (
            <div key={i} className="bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {row.text}
            </div>
          );
        }
        if (row.kind === "context") {
          return (
            <div key={i} className="whitespace-pre-wrap break-all px-2 text-muted-foreground">
              {row.text === "" ? " " : row.text}
            </div>
          );
        }
        const del = row.kind === "del";
        return (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all px-2",
              del ? "bg-destructive/10" : "bg-primary/10",
            )}
          >
            <span className="select-none text-muted-foreground">{del ? "−" : "＋"}</span>
            {row.segments.map((segment, j) =>
              segment.changed ? (
                <mark
                  key={j}
                  className={cn(
                    "rounded-sm bg-transparent text-foreground",
                    del ? "bg-destructive/25 line-through decoration-destructive/60" : "bg-primary/25",
                  )}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={j} className="text-foreground">
                  {segment.text}
                </span>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
