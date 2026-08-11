import Link from "next/link";

import { patCredentialProvider } from "@/lib/git/credentials";
import { scheduleSchema } from "@/lib/schemas/schedule";
import { createClient } from "@/lib/supabase/server";
import { convertTargetPagesToChars } from "@/lib/writing-target";
import { Button } from "@/components/ui/button";
import {
  ConsultLauncher,
  type ConsultProject,
} from "@/components/dashboard/consult-panel";
import {
  ProjectOverviewCard,
  type DashboardProject,
} from "@/components/dashboard/project-overview-card";
import type { ProgressPoint } from "@/components/dashboard/progress-line";
import { parseEnumOrNull, proposalStatuses } from "@/lib/schemas/enums";
import { jstDateString } from "@/lib/date";

/** ダッシュボード（SPEC-dashboard-critique-settings §3.1）。進捗＋プロジェクト概況の「作業基地」 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ consult?: string }>;
}) {
  // `/chats` の行クリック導線: 相談パネルを該当スレッドで自動オープンする（SPEC-chat-thread-list §3.1）
  const { consult } = await searchParams;
  const supabase = await createClient();

  const [{ data: projects }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, title, event_name, deadline, target_pages, repo, base_path, schedule, proposals (status)",
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("user_settings")
      .select("github_pat_ciphertext")
      .maybeSingle(),
  ]);
  const patRegistered = Boolean(settingsRow?.github_pat_ciphertext);

  // 進捗記録（最新行＋直近30日の推移）。単一クエリで引いてプロジェクト別に振り分ける
  const projectIds = (projects ?? []).map((p) => p.id);
  const { data: progressRows } =
    projectIds.length > 0
      ? await supabase
          .from("writing_progress")
          .select("project_id, date, total_chars")
          .in("project_id", projectIds)
          .order("date")
      : {
          data: [] as {
            project_id: string;
            date: string;
            total_chars: number;
          }[],
        };

  // 相談パネル（アシスタントタブのプロジェクトセレクタ）に渡す最小情報
  const consultProjects: ConsultProject[] = (projects ?? []).map((project) => ({
    id: project.id,
    title: project.title,
    deadline: project.deadline,
  }));

  const now = new Date();
  const today = jstDateString(now);
  const cutoff = jstDateString(new Date(now.getTime() - 29 * 86_400_000)); // 今日を含む直近30日

  // 目標線の字数換算（Issue #60）: 判型・組み設定はリポジトリのテーマCSS由来のため、
  // 目標ページ数×repo×PAT が揃うプロジェクトがあるときだけPATを復号する。
  // 復号や取得に失敗しても既定換算（文庫A6）に落ちてダッシュボード自体は表示する
  let token: string | null = null;
  if (
    patRegistered &&
    (projects ?? []).some((p) => p.target_pages !== null && p.repo)
  ) {
    try {
      token =
        (await patCredentialProvider.getCredential(supabase))?.token ?? null;
    } catch (credentialError) {
      console.error(
        "PATの復号に失敗（目標換算は既定値で継続）:",
        credentialError,
      );
    }
  }
  const targetCharsById = new Map<string, number>();
  await Promise.all(
    (projects ?? []).map(async (project) => {
      if (project.target_pages === null) return;
      targetCharsById.set(
        project.id,
        await convertTargetPagesToChars({
          targetPages: project.target_pages,
          token,
          repo: project.repo,
          basePath: (project.base_path ?? "").replace(/\/$/, ""),
        }),
      );
    }),
  );

  const items: DashboardProject[] = (projects ?? []).map((project) => {
    const rows: ProgressPoint[] = (progressRows ?? [])
      .filter((row) => row.project_id === project.id)
      .map((row) => ({ date: row.date, totalChars: row.total_chars }));
    // jsonb は器のみ＝読み出し時に必ずスキーマを通す（不正データは未保存として扱う）
    const schedule = scheduleSchema.safeParse(project.schedule);
    return {
      id: project.id,
      title: project.title,
      event_name: project.event_name,
      deadline: project.deadline,
      proposalStatus: parseEnumOrNull(
        proposalStatuses,
        project.proposals?.status ?? null,
        "proposals.status",
      ),
      canCollect: Boolean(project.repo) && patRegistered,
      latest: rows.at(-1) ?? null,
      series: rows.filter((row) => row.date >= cutoff),
      targetChars: targetCharsById.get(project.id) ?? null,
      targetPages: project.target_pages,
      schedule: schedule.success ? schedule.data : null,
    };
  });

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">
            プロジェクト概況
          </h2>
          <div className="ml-auto flex items-center gap-2">
            <ConsultLauncher
              projects={consultProjects}
              initialThreadId={consult}
            />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/atelier">アトリエ</Link>}
            />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/projects">プロジェクト一覧</Link>}
            />
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/notes">ノートをひらく</Link>}
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8">
            <p className="text-sm text-card-foreground">
              まだプロジェクトがありません。
            </p>
            <p className="text-sm text-muted-foreground">
              ネタはノートに書き溜め、本づくりはプロジェクトから始めます。
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                nativeButton={false}
                render={<Link href="/projects">プロジェクトをつくる</Link>}
              />
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/notes">ノートをひらく</Link>}
              />
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((project) => (
              <ProjectOverviewCard
                key={project.id}
                project={project}
                today={today}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
