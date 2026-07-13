import { createClient } from "@/lib/supabase/server";
import type { SceneRecord } from "@/lib/board";
import { BeatBoard } from "@/components/board/beat-board";

/**
 * ビートボードページ（SPEC-beat-board §3.2）。
 * プロジェクトの存在確認とヘッダーは layout.tsx が担う。ここではシーンを構成順に引く
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, project_id, part, anchor, order_index, title, content, emotion_start, emotion_end")
    .eq("project_id", id)
    .order("order_index");

  return <BeatBoard projectId={id} initialScenes={(scenes ?? []) as SceneRecord[]} />;
}
