import Link from "next/link";
import { Settings } from "lucide-react";

import type { ProposalStatus } from "@/lib/schemas/enums";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ProjectOverviewCard,
  type DashboardProject,
} from "@/components/dashboard/project-overview-card";
import type { ProgressPoint } from "@/components/dashboard/progress-line";

/** JST基準の日付（YYYY-MM-DD。サーバーはUTCで動くため明示する） */
function jstDate(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(at);
}

/** ダッシュボード（SPEC-dashboard-critique-settings §3.1）。進捗＋プロジェクト概況の「作業基地」 */
export default async function Home() {
  const supabase = await createClient();

  const [{ data: projects }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, event_name, deadline, repo, proposals (status)")
      .order("updated_at", { ascending: false }),
    supabase.from("user_settings").select("github_pat_ciphertext").maybeSingle(),
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
      : { data: [] as { project_id: string; date: string; total_chars: number }[] };

  const now = new Date();
  const today = jstDate(now);
  const cutoff = jstDate(new Date(now.getTime() - 29 * 86_400_000)); // 今日を含む直近30日

  const items: DashboardProject[] = (projects ?? []).map((project) => {
    const rows: ProgressPoint[] = (progressRows ?? [])
      .filter((row) => row.project_id === project.id)
      .map((row) => ({ date: row.date, totalChars: row.total_chars }));
    return {
      id: project.id,
      title: project.title,
      event_name: project.event_name,
      deadline: project.deadline,
      proposalStatus: (project.proposals?.status ?? null) as ProposalStatus | null,
      canCollect: Boolean(project.repo) && patRegistered,
      latest: rows.at(-1) ?? null,
      series: rows.filter((row) => row.date >= cutoff),
    };
  });

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">🐱 ネコノテAI</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="設定"
            className="text-muted-foreground"
            nativeButton={false}
            render={
              <Link href="/settings">
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

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">プロジェクト概況</h2>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/projects">プロジェクト一覧</Link>}
            />
            <Button size="sm" nativeButton={false} render={<Link href="/notes">ノートをひらく</Link>} />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8">
            <p className="text-sm text-card-foreground">まだプロジェクトがありません。</p>
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
              <ProjectOverviewCard key={project.id} project={project} today={today} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
