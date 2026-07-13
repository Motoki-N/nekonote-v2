import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus, ProposalStatus } from "@/lib/schemas/enums";
import type { LinkedNote } from "@/lib/actions/projects";
import { ProposalEditor } from "@/components/projects/proposal-editor";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, title, status, event_name, deadline, target_pages, proposals (id, genre, target_audience, content, status, updated_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!project || !project.proposals) notFound();
  const proposal = project.proposals;

  // 紐づけノート（ごみ箱中は非表示。SPEC-proposal-review §3.2）
  const { data: links } = await supabase
    .from("proposal_notes")
    .select("notes (id, title, deleted_at)")
    .eq("proposal_id", proposal.id)
    .order("created_at");
  const linkedNotes: LinkedNote[] = (links ?? [])
    .flatMap((row) => (row.notes ? [row.notes] : []))
    .filter((note) => note.deleted_at === null)
    .map((note) => ({ id: note.id, title: note.title }));

  return (
    <ProposalEditor
      project={{
        id: project.id,
        title: project.title,
        status: project.status as ProjectStatus,
        event_name: project.event_name,
        deadline: project.deadline,
        target_pages: project.target_pages,
      }}
      proposal={{
        id: proposal.id,
        genre: proposal.genre,
        target_audience: proposal.target_audience,
        content: proposal.content,
        status: proposal.status as ProposalStatus,
        updated_at: proposal.updated_at,
      }}
      linkedNotes={linkedNotes}
    />
  );
}
