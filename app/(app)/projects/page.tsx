import { createClient } from "@/lib/supabase/server";
import {
  ProjectCard,
  type ProjectListItem,
} from "@/components/projects/project-card";
import { CreateProjectDialog } from "@/components/projects/project-form-dialog";
import {
  parseEnum,
  parseEnumOrNull,
  projectStatuses,
  proposalStatuses,
} from "@/lib/schemas/enums";

export default async function ProjectsPage() {
  const supabase = await createClient();

  const [{ data: projects }, { data: workingTitleTags }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, title, status, event_name, deadline, target_pages, repo, base_path, proposals (status)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("tags")
      .select("id, name")
      .eq("kind", "working_title")
      .order("name"),
  ]);

  const items: ProjectListItem[] = (projects ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    status: parseEnum(projectStatuses, p.status, "projects.status"),
    event_name: p.event_name,
    deadline: p.deadline,
    target_pages: p.target_pages,
    repo: p.repo,
    base_path: p.base_path,
    proposalStatus: parseEnumOrNull(
      proposalStatuses,
      p.proposals?.status ?? null,
      "proposals.status",
    ),
  }));

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">プロジェクト</h1>
        <CreateProjectDialog workingTitleTags={workingTitleTags ?? []} />
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
