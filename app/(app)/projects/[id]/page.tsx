import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { ProposalStatus, WritingGenre } from "@/lib/schemas/enums";
import type { LinkedNote } from "@/lib/actions/projects";
import { ProposalEditor } from "@/components/projects/proposal-editor";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // プロジェクト情報ヘッダーは layout.tsx が描画する。ここでは企画書のみ引く
  const { data: proposal } = await supabase
    .from("proposals")
    .select(
      "id, project_id, writing_genre, purpose, genre, target_audience, content, status, updated_at",
    )
    .eq("project_id", id)
    .maybeSingle();
  if (!proposal) notFound();

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
      proposal={{
        id: proposal.id,
        writing_genre: proposal.writing_genre as WritingGenre,
        purpose: proposal.purpose,
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
