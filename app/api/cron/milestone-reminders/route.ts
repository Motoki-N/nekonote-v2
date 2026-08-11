import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { sendMilestoneReminderEmail } from "@/lib/email";
import {
  isMilestoneAchieved,
  scheduleSchema,
  type Schedule,
} from "@/lib/schemas/schedule";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** JST基準の今日（YYYY-MM-DD。cron はUTCで動くため明示する） */
function jstDate(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    at,
  );
}

/** 日付文字列（YYYY-MM-DD）同士の差（日数） */
function daysUntil(dueDate: string, today: string): number {
  return Math.round((Date.parse(dueDate) - Date.parse(today)) / 86_400_000);
}

/** 締切何日前にリマインドするか（Issue #51設計確認: 3日前＋前日の2段階） */
const REMINDER_DAYS = [3, 1];

/** タイミング攻撃を避ける定数時間比較（長さ不一致でも早期returnしない） */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // timingSafeEqual は同長が前提。長さ違いは自身と比較して時間を揃えつつ false を返す
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * マイルストーン締切リマインド（Issue #51 / SPEC-schedule-and-memo-tools 追補）。
 * Vercel Cron が1日1回叩く。CRON_SECRET で認証し、締切3日前・前日で未達成・
 * 当日まだ通知していないマイルストーンをプロジェクト所有者へメール通知する
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (
    !cronSecret ||
    !authHeader ||
    !safeEqual(authHeader, `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const today = jstDate(new Date());

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, user_id, title, schedule")
    .not("schedule", "is", null);
  if (projectsError) {
    console.error("milestone-reminders: プロジェクト取得失敗", projectsError);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const projectIds = (projects ?? []).map((project) => project.id);
  const { data: progressRows } =
    projectIds.length > 0
      ? await supabase
          .from("writing_progress")
          .select("project_id, date, total_chars")
          .in("project_id", projectIds)
          .order("date", { ascending: false })
      : {
          data: [] as {
            project_id: string;
            date: string;
            total_chars: number;
          }[],
        };
  // 降順で走査するため、project_id ごとに最初に見つかった行が最新
  const latestCharsByProject = new Map<string, number>();
  for (const row of progressRows ?? []) {
    if (!latestCharsByProject.has(row.project_id)) {
      latestCharsByProject.set(row.project_id, row.total_chars);
    }
  }

  const emailByUser = new Map<string, string | null>();
  let emailsSent = 0;
  let remindersSent = 0;

  for (const project of projects ?? []) {
    const parsed = scheduleSchema.safeParse(project.schedule);
    if (!parsed.success) continue;
    const latestChars = latestCharsByProject.get(project.id) ?? null;

    const targets = parsed.data.milestones.filter((milestone) => {
      if (isMilestoneAchieved(milestone, latestChars)) return false;
      if (milestone.remindedAt === today) return false;
      return REMINDER_DAYS.includes(daysUntil(milestone.dueDate, today));
    });
    if (targets.length === 0) continue;

    if (!emailByUser.has(project.user_id)) {
      const { data: userData, error: userError } =
        await supabase.auth.admin.getUserById(project.user_id);
      if (userError) {
        console.error(
          "milestone-reminders: ユーザー取得失敗",
          project.user_id,
          userError,
        );
      }
      emailByUser.set(project.user_id, userData?.user?.email ?? null);
    }
    const email = emailByUser.get(project.user_id);
    if (!email) continue;

    try {
      await sendMilestoneReminderEmail(
        email,
        targets.map((milestone) => ({
          projectTitle: project.title,
          label: milestone.label,
          dueDate: milestone.dueDate,
          daysUntil: daysUntil(milestone.dueDate, today),
        })),
      );
      emailsSent += 1;
      remindersSent += targets.length;
    } catch (sendError) {
      console.error(
        "milestone-reminders: メール送信失敗",
        project.id,
        sendError,
      );
      continue;
    }

    const remindedIds = new Set(targets.map((milestone) => milestone.id));
    const schedule: Schedule = {
      ...parsed.data,
      milestones: parsed.data.milestones.map((milestone) =>
        remindedIds.has(milestone.id)
          ? { ...milestone, remindedAt: today }
          : milestone,
      ),
      // toggleMilestone と同じ楽観ロック流儀（更新の事実を savedAt に刻む）
      savedAt: new Date().toISOString(),
    };
    const { error: updateError } = await supabase
      .from("projects")
      .update({ schedule })
      .eq("id", project.id)
      .eq("schedule->>savedAt", parsed.data.savedAt);
    if (updateError) {
      console.error(
        "milestone-reminders: remindedAt更新失敗",
        project.id,
        updateError,
      );
    }
  }

  return NextResponse.json({ ok: true, emailsSent, remindersSent });
}
