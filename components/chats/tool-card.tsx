"use client";

import Link from "next/link";
import type { ToolUIPart } from "ai";
import { CalendarCheck, Check, ExternalLink, Loader2 } from "lucide-react";

import type { SaveMemoNoteOutput, SaveScheduleOutput } from "@/lib/schemas/schedule";

/**
 * ツール呼び出しの結果カード（セッション内表示のみ。リロード後は消える。
 * SPEC-schedule-and-memo-tools §5.2）。相談パネルと掘り下げパネルで共用する
 */
export function ToolCard({ part }: { part: ToolUIPart }) {
  const isSchedule = part.type === "tool-saveSchedule";
  const failedText = isSchedule
    ? "スケジュールの保存に失敗しました"
    : "ノートへの保存に失敗しました";

  if (part.state === "output-error") {
    return <p className="mr-4 self-start text-sm text-destructive">{failedText}</p>;
  }
  if (part.state !== "output-available") {
    return (
      <div className="mr-4 flex items-center gap-2 self-start rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {isSchedule ? "スケジュールを保存しています…" : "ノートに保存しています…"}
      </div>
    );
  }

  // 出力型はサーバーの execute 戻り値と共有（lib/schemas/schedule.ts）
  const output = part.output as (SaveScheduleOutput | SaveMemoNoteOutput) | undefined;
  if (!output?.ok) {
    return <p className="mr-4 self-start text-sm text-destructive">{output?.message ?? failedText}</p>;
  }
  return (
    <div className="mr-4 flex flex-wrap items-center gap-2 self-start rounded-lg border border-border bg-card px-3 py-2 text-xs text-card-foreground">
      {"milestoneCount" in output ? (
        <>
          <CalendarCheck className="size-3.5 text-muted-foreground" />
          スケジュールを保存しました
          {`（マイルストーン${output.milestoneCount}件）`}
        </>
      ) : (
        <>
          <Check className="size-3.5 text-muted-foreground" />
          ノートに保存しました
          <Link
            href={`/notes/${output.noteId}`}
            className="flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-3" />
            ノートをひらく
          </Link>
        </>
      )}
    </div>
  );
}
