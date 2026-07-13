import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus, ProposalStatus } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProjectCard, type ProjectListItem } from "@/components/projects/project-card";
import { CreateProjectDialog } from "@/components/projects/project-form-dialog";

export default async function ProjectsPage() {
  const supabase = await createClient();

  const [{ data: projects }, { data: workingTitleTags }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, status, event_name, deadline, target_pages, proposals (status)")
      .order("created_at", { ascending: false }),
    supabase.from("tags").select("id, name").eq("kind", "working_title").order("name"),
  ]);

  const items: ProjectListItem[] = (projects ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status as ProjectStatus,
    event_name: p.event_name,
    deadline: p.deadline,
    target_pages: p.target_pages,
    proposalStatus: (p.proposals?.status ?? null) as ProposalStatus | null,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-semibold text-foreground">
            🐱
          </Link>
          <h1 className="text-lg font-semibold text-foreground">プロジェクト</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/notes">ノート</Link>}
          />
          <CreateProjectDialog workingTitleTags={workingTitleTags ?? []} />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            まだプロジェクトがありません。「新規プロジェクト」から本づくりをはじめましょう
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
