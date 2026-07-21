import type { LinkedNote } from "@/lib/actions/projects";
import { createClient } from "@/lib/supabase/server";
import type { SceneRecord } from "@/lib/board";
import type { ApprovalStatus } from "@/lib/schemas/enums";
import { BeatBoard } from "@/components/board/beat-board";

/**
 * ビートボードページ（SPEC-beat-board §3.2）。
 * プロジェクトの存在確認とヘッダーは layout.tsx が担う。ここではシーンを構成順に引く
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: scenes }, { data: project }, { data: sceneNotes }] = await Promise.all([
    supabase
      .from("scenes")
      .select(
        "id, project_id, part, anchor, order_index, title, content, emotion_start, emotion_end, status, manuscript_path",
      )
      .eq("project_id", id)
      .order("order_index"),
    // 構成レビューのゲート状態（Issue #57）
    supabase.from("projects").select("structure_status").eq("id", id).maybeSingle(),
    // シーンごとの紐づけノート（Issue #56。ごみ箱中は表示から除外する）
    supabase
      .from("scene_notes")
      .select("scene_id, notes (id, title, deleted_at), scenes!inner (project_id)")
      .eq("scenes.project_id", id),
  ]);

  const linkedNotes: Record<string, LinkedNote[]> = {};
  for (const row of sceneNotes ?? []) {
    if (!row.notes || row.notes.deleted_at !== null) continue;
    (linkedNotes[row.scene_id] ??= []).push({ id: row.notes.id, title: row.notes.title });
  }

  return (
    <BeatBoard
      projectId={id}
      initialScenes={(scenes ?? []) as SceneRecord[]}
      initialLinkedNotes={linkedNotes}
      structureStatus={(project?.structure_status ?? "draft") as ApprovalStatus}
    />
  );
}
