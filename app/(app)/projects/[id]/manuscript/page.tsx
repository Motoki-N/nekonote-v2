import { getManuscriptFiles } from "@/lib/actions/manuscripts";
import { fetchLinkedScenesByPath } from "@/lib/board/scene-store";
import { createClient } from "@/lib/supabase/server";
import { ManuscriptWorkspace } from "@/components/manuscript/manuscript-workspace";

/**
 * 原稿タブ（SPEC-proofreading §3.2）。
 * ツリー取得はサーバー側で行い、前提未達（PAT未登録・repo未設定）や
 * GitHub APIエラーは ManuscriptWorkspace が誘導表示に変換する（フェイルソフト）
 */
export default async function ManuscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { id } = await params;
  const { file } = await searchParams;
  // 逆引き（原稿 → シーン）はサーバーで1本引くだけ（SPEC-manuscript-bridge §5.5。
  // scenes.manuscript_path の等値検索で、GitHub API 呼び出しは増えない）
  const supabase = await createClient();
  const [result, linkedScenes] = await Promise.all([
    getManuscriptFiles(id),
    fetchLinkedScenesByPath(supabase, id),
  ]);

  return (
    <ManuscriptWorkspace
      projectId={id}
      tree={result.ok ? (result.data ?? null) : null}
      treeError={result.ok ? null : result.error.message}
      initialFile={typeof file === "string" ? file : null}
      linkedScenes={linkedScenes}
    />
  );
}
