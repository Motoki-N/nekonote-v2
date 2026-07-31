import type { LinkedNote } from "@/lib/actions/projects";
import { createClient } from "@/lib/supabase/server";
import type { SceneRecord } from "@/lib/board";
import type { ApprovalStatus, StructureTemplate, WritingGenre } from "@/lib/schemas/enums";
import { BeatBoard } from "@/components/board/beat-board";
import { OutlineBoard } from "@/components/board/outline-board";

/**
 * 構成ボードページ。執筆ジャンルで出し分ける（SPEC-outline-board §3.1）:
 * 小説 = ビートボード（SPEC-beat-board §3.2）/ 技術書・その他 = 目次ボード。
 * プロジェクトの存在確認とヘッダーは layout.tsx が担う。ここではシーンを構成順に引く
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: scenes }, { data: project }, { data: sceneNotes }, { data: proposal }] =
    await Promise.all([
      supabase
        .from("scenes")
        .select(
          "id, project_id, part, anchor, order_index, title, content, emotion_start, emotion_end, status, manuscript_path",
        )
        .eq("project_id", id)
        .order("order_index"),
      // 構成レビューのゲート状態（Issue #57）＋構成テンプレート（Issue #54）
      supabase
        .from("projects")
        .select("structure_status, structure_template")
        .eq("id", id)
        .maybeSingle(),
      // シーンごとの紐づけノート（Issue #56。ごみ箱中は表示から除外する）
      supabase
        .from("scene_notes")
        .select("scene_id, notes (id, title, deleted_at), scenes!inner (project_id)")
        .eq("scenes.project_id", id)
        .order("created_at"),
      // ボードの出し分けキー（Issue #96）
      supabase.from("proposals").select("writing_genre").eq("project_id", id).maybeSingle(),
    ]);

  const genre = (proposal?.writing_genre ?? "novel") as WritingGenre;
  const structureStatus = (project?.structure_status ?? "draft") as ApprovalStatus;
  const structureTemplate = (project?.structure_template ?? "four_part") as StructureTemplate;

  if (genre !== "novel") {
    return (
      <OutlineBoard
        projectId={id}
        initialScenes={(scenes ?? []) as SceneRecord[]}
        structureStatus={structureStatus}
      />
    );
  }

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
      structureStatus={structureStatus}
      structureTemplate={structureTemplate}
    />
  );
}
