import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { NoteEditor } from "@/components/notes/note-editor";

export default async function NoteEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: note } = await supabase
    .from("notes")
    .select("id, title, content, updated_at, deleted_at, note_tags(tags(id, name, kind))")
    .eq("id", id)
    .maybeSingle();

  if (!note) notFound();
  // ごみ箱内のノートは編集させない（復元してから）
  if (note.deleted_at) redirect("/notes?view=trash");

  const [{ data: allTags }, { data: templates }] = await Promise.all([
    supabase.from("tags").select("id, name, kind").order("kind").order("name"),
    // 標準同梱を先頭に、その後ユーザー作成分を名前順で
    supabase
      .from("templates")
      .select("id, name, content, tag_name")
      .order("is_default", { ascending: false })
      .order("name"),
  ]);

  return (
    <NoteEditor
      note={{
        id: note.id,
        title: note.title,
        content: note.content,
        updated_at: note.updated_at,
      }}
      initialTags={note.note_tags.flatMap((nt) => (nt.tags ? [nt.tags] : []))}
      allTags={allTags ?? []}
      templates={templates ?? []}
    />
  );
}
