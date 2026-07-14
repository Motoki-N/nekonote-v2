"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardList, FileText, LayoutPanelTop, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { refreshWritingProgress } from "@/lib/actions/manuscripts";
import type { ProposalStatus } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import { ProposalStatusBadge } from "@/components/projects/status-badges";
import { ProgressLine, type ProgressPoint } from "@/components/dashboard/progress-line";

export type DashboardProject = {
  id: string;
  title: string;
  event_name: string | null;
  deadline: string | null;
  proposalStatus: ProposalStatus | null;
  /** repo・PAT が揃っていて「今すぐ集計」を出せるか */
  canCollect: boolean;
  latest: ProgressPoint | null;
  /** 直近30日の記録（日付昇順） */
  series: ProgressPoint[];
};

const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" });

/** 日付文字列（YYYY-MM-DD）同士の差（日数）。時刻・タイムゾーンの影響を受けない */
function daysUntil(deadline: string, today: string): number {
  return Math.round((Date.parse(deadline) - Date.parse(today)) / 86_400_000);
}

function DeadlineCountdown({ deadline, today }: { deadline: string; today: string }) {
  const days = daysUntil(deadline, today);
  const overdue = days < 0;
  return (
    <span
      className={`flex items-center gap-1 ${overdue ? "font-medium text-destructive" : ""}`}
    >
      <CalendarDays className="size-3" />
      {dateFormat.format(new Date(deadline))}（
      {overdue ? `${-days}日超過` : days === 0 ? "今日が締切" : `あと${days}日`}）
    </span>
  );
}

/**
 * プロジェクト概況カード（SPEC-dashboard-critique-settings §3.1）。
 * 企画ステータス・締切カウントダウン・最新文字数・直近30日の推移＋各タブへの導線
 */
export function ProjectOverviewCard({
  project,
  today,
}: {
  project: DashboardProject;
  /** JST基準の今日（YYYY-MM-DD。サーバーで確定して渡す） */
  today: string;
}) {
  const router = useRouter();
  const [collecting, setCollecting] = useState(false);

  async function handleCollect() {
    if (collecting) return;
    setCollecting(true);
    try {
      const result = await refreshWritingProgress(project.id);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "集計に失敗しました" : result.error.message);
        return;
      }
      toast(`約${result.data.totalChars.toLocaleString("ja-JP")}字を記録しました`);
      router.refresh();
    } finally {
      setCollecting(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-card-foreground">{project.title}</span>
        {project.proposalStatus && <ProposalStatusBadge status={project.proposalStatus} />}
        {project.canCollect && (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            disabled={collecting}
            onClick={() => void handleCollect()}
          >
            {collecting ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            今すぐ集計
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {project.event_name && <span>{project.event_name}</span>}
        {project.deadline && <DeadlineCountdown deadline={project.deadline} today={today} />}
        {project.latest && (
          <span>
            {project.latest.totalChars.toLocaleString("ja-JP")}字（
            {dateFormat.format(new Date(project.latest.date))}時点）
          </span>
        )}
      </div>

      <ProgressLine points={project.series} />

      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          nativeButton={false}
          render={
            <Link href={`/projects/${project.id}`}>
              <ClipboardList data-icon="inline-start" />
              企画書
            </Link>
          }
        />
        <Button
          size="xs"
          variant="outline"
          nativeButton={false}
          render={
            <Link href={`/projects/${project.id}/board`}>
              <LayoutPanelTop data-icon="inline-start" />
              ビートボード
            </Link>
          }
        />
        <Button
          size="xs"
          variant="outline"
          nativeButton={false}
          render={
            <Link href={`/projects/${project.id}/manuscript`}>
              <FileText data-icon="inline-start" />
              原稿
            </Link>
          }
        />
      </div>
    </li>
  );
}
