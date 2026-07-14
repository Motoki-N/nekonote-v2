"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutPanelTop,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { refreshWritingProgress } from "@/lib/actions/manuscripts";
import { deleteSchedule, toggleMilestone } from "@/lib/actions/schedule";
import type { ProposalStatus } from "@/lib/schemas/enums";
import { isMilestoneAchieved, type Milestone, type Schedule } from "@/lib/schemas/schedule";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  /** アシスタントが確定保存した執筆スケジュール（SPEC-schedule-and-memo-tools） */
  schedule: Schedule | null;
};

// YYYY-MM-DD は new Date() でUTC深夜になるため、UTCのまま整形して端末TZの影響を受けない
// （日数判定 daysUntil の文字列比較とも整合。UTCより西のTZで1日前に表示される問題の回避）
const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeZone: "UTC" });

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

/** 期日の短い表示（「7/20（あと6日）」の形。締切超過は呼び出し側で色分け） */
function dueLabel(dueDate: string, today: string): string {
  const days = daysUntil(dueDate, today);
  const date = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC", // dateFormat と同じ理由（YYYY-MM-DD＝UTC深夜をそのまま整形）
  }).format(new Date(dueDate));
  return `${date}（${days < 0 ? `${-days}日超過` : days === 0 ? "今日" : `あと${days}日`}）`;
}

/** 直近7日境界を跨いだ実ペース（字/日）。基準になる過去の記録がなければ null */
function recentPace(series: ProgressPoint[], today: string): number | null {
  const latest = series.at(-1);
  if (!latest) return null;
  const boundary = new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10);
  const baseline = series.filter((point) => point.date <= boundary).at(-1);
  if (!baseline || baseline.date === latest.date) return null;
  const days = Math.round((Date.parse(latest.date) - Date.parse(baseline.date)) / 86_400_000);
  return Math.round((latest.totalChars - baseline.totalChars) / days);
}

/**
 * 保存済み執筆スケジュールのブロック（SPEC-schedule-and-memo-tools §5.3）。
 * 日次目標＋マイルストーン一覧（手動チェック・自動達成判定）＋削除
 */
function ScheduleBlock({
  projectId,
  schedule,
  latest,
  series,
  today,
}: {
  projectId: string;
  schedule: Schedule;
  latest: ProgressPoint | null;
  series: ProgressPoint[];
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const latestTotal = latest?.totalChars ?? null;
  const pace = recentPace(series, today);

  async function handleToggle(milestone: Milestone) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await toggleMilestone(projectId, milestone.id, !milestone.done);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await deleteSchedule(projectId);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast("スケジュールを削除しました");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-1.5">
        <CalendarCheck className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-card-foreground">執筆スケジュール</span>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="スケジュールを削除"
                className="ml-auto text-muted-foreground"
                disabled={busy}
              >
                <Trash2 />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>執筆スケジュールを削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                マイルストーンと日次目標がこのプロジェクトから消えます。この操作は元に戻せません（アシスタントに相談すれば新しく作り直せます）。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                削除する
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {schedule.dailyTargetChars !== null && (
        <p className="text-xs text-muted-foreground">
          1日あたり目標 {schedule.dailyTargetChars.toLocaleString("ja-JP")}字
          {pace !== null && `（直近7日の実ペース 約${pace.toLocaleString("ja-JP")}字/日）`}
        </p>
      )}

      {schedule.milestones.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {schedule.milestones.map((milestone) => {
            const achieved = isMilestoneAchieved(milestone, latestTotal);
            const overdue = daysUntil(milestone.dueDate, today) < 0;
            return (
              <li key={milestone.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 accent-primary"
                  checked={milestone.done}
                  disabled={busy}
                  aria-label={`「${milestone.label}」の達成チェック`}
                  onChange={() => void handleToggle(milestone)}
                />
                <span
                  className={
                    achieved ? "text-muted-foreground line-through" : "text-card-foreground"
                  }
                >
                  {milestone.label}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
                  <span className={overdue && !achieved ? "font-medium text-destructive" : ""}>
                    {dueLabel(milestone.dueDate, today)}
                  </span>
                  {milestone.targetChars !== null &&
                    (achieved ? (
                      <span>達成</span>
                    ) : (
                      <span>
                        残り
                        {Math.max(
                          milestone.targetChars - (latestTotal ?? 0),
                          0,
                        ).toLocaleString("ja-JP")}
                        字
                      </span>
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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

      {project.schedule && (
        <ScheduleBlock
          projectId={project.id}
          schedule={project.schedule}
          latest={project.latest}
          series={project.series}
          today={today}
        />
      )}

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
