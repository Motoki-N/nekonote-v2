import "server-only";

// シーン行の取得・保存の共通ヘルパ（SPEC-manuscript-bridge §5.4）。
// もとは lib/actions/scenes.ts のプライベート関数だったものを、原稿生成アクション
// （lib/actions/manuscript-generate.ts）と共用するために切り出した。
// "use server" ファイルは async 関数しか export できず、Supabase クライアントを引数に取る
// 関数を export するとクライアントから呼べる Server Action になってしまうため、この層に置く。
// ロジックは移動のみで変更していない

import type { LinkedScene, SceneRecord } from "@/lib/board";
import { AppError } from "@/lib/errors";
import { parseEnum, sceneKinds, structureTemplates } from "@/lib/schemas/enums";
import type { StructureTemplate } from "@/lib/schemas/enums";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const SCENE_COLUMNS =
  "id, project_id, kind, part, anchor, order_index, title, content, emotion_delta, status, manuscript_path";

/** プロジェクトの全シーンを構成順（order_index 昇順）で取得。RLS越し＝所有分のみ */
export async function fetchProjectScenes(
  supabase: Supabase,
  projectId: string,
): Promise<SceneRecord[]> {
  const { data, error } = await supabase
    .from("scenes")
    .select(SCENE_COLUMNS)
    .eq("project_id", projectId)
    .order("order_index");
  if (error) throw new AppError("internal", error.message);
  return (data ?? []) as SceneRecord[];
}

/**
 * 原稿ファイルのパス → 紐づくシーン／章（SPEC-manuscript-bridge §5.5）。
 * `scenes.manuscript_path` の等値検索のみで、`manuscript_links` とは結合しない
 * （目的の違う遅延生成レコードのため。理由は SPEC §5.5）。
 * エディタ・原稿タブのサーバーコンポーネントから1本だけ引く（GitHub API は増えない）
 */
export async function fetchLinkedScenesByPath(
  supabase: Supabase,
  projectId: string,
): Promise<Record<string, LinkedScene[]>> {
  const { data, error } = await supabase
    .from("scenes")
    .select("id, kind, title, content, manuscript_path")
    .eq("project_id", projectId)
    .not("manuscript_path", "is", null)
    .order("order_index");
  // 逆引きは補助情報なので、失敗しても本体（章一覧・原稿ツリー）は出す。
  // ただし切り分けできるようにログには残す
  if (error) {
    console.error("fetchLinkedScenesByPath:", error.message);
    return {};
  }
  const map: Record<string, LinkedScene[]> = {};
  for (const row of data ?? []) {
    if (row.manuscript_path === null) continue;
    (map[row.manuscript_path] ??= []).push({
      id: row.id,
      kind: parseEnum(sceneKinds, row.kind, "scenes.kind"),
      title: row.title,
      content: row.content,
    });
  }
  return map;
}

/** RLS越しのプロジェクト所有確認（他人・不存在はともに not_found に正規化）。
 * 検証に使う構成テンプレートも返す（Issue #54） */
export async function getOwnedProject(
  supabase: Supabase,
  projectId: string,
): Promise<{ structureTemplate: StructureTemplate }> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, structure_template")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!data) throw new AppError("not_found", "プロジェクトが見つかりません");
  return {
    structureTemplate: parseEnum(
      structureTemplates,
      data.structure_template,
      "projects.structure_template",
    ),
  };
}

/**
 * 変更のあった行だけを1回の upsert で保存する。
 * supabase-js にトランザクションがないため、単一ステートメント＝原子的な一括更新で整合を保つ
 */
export async function persistChanges(
  supabase: Supabase,
  before: Map<string, SceneRecord>,
  after: SceneRecord[],
): Promise<void> {
  const changed = after.filter((scene) => {
    const prev = before.get(scene.id);
    if (!prev) return true; // 新規行
    return (
      prev.kind !== scene.kind ||
      prev.part !== scene.part ||
      prev.anchor !== scene.anchor ||
      prev.order_index !== scene.order_index ||
      prev.title !== scene.title ||
      prev.content !== scene.content ||
      prev.emotion_delta !== scene.emotion_delta ||
      prev.manuscript_path !== scene.manuscript_path
    );
  });
  if (changed.length === 0) return;
  // status はシーン系アクションの管理外（approveBoardReview だけが更新する）。取得時点の値を
  // 書き戻して承認を巻き戻さないよう upsert ペイロードから除外する（新規行は default 'draft'）
  const payload = changed.map((scene) => ({
    id: scene.id,
    project_id: scene.project_id,
    // 新規行の挿入に必要（既存行では実質不変。SPEC-board-chapters §6）
    kind: scene.kind,
    part: scene.part,
    anchor: scene.anchor,
    order_index: scene.order_index,
    title: scene.title,
    content: scene.content,
    emotion_delta: scene.emotion_delta,
    manuscript_path: scene.manuscript_path,
  }));
  const { error } = await supabase.from("scenes").upsert(payload);
  if (error) throw new AppError("internal", error.message);
}

export function toMap(scenes: SceneRecord[]): Map<string, SceneRecord> {
  return new Map(scenes.map((s) => [s.id, s]));
}
