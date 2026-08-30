import { getEditorWorkspace } from "@/lib/actions/editor";
import { fetchLinkedScenesByPath } from "@/lib/board/scene-store";
import { createClient } from "@/lib/supabase/server";
import { VerticalEditor } from "@/components/editor/vertical-editor";

/**
 * 縦書きエディタタブ（SPEC-vertical-editor-phase2 §3.1）。
 * 章一覧・テーマCSSの取得はサーバー側で行い、前提未達（PAT未登録・repo未設定）や
 * GitHub APIエラーは VerticalEditor が誘導表示に変換する（原稿タブと同じフェイルソフト）
 */
export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ file?: string; branch?: string }>;
}) {
  const { id } = await params;
  const { file, branch } = await searchParams;
  const supabase = await createClient();
  const [result, linkedScenes] = await Promise.all([
    // ?branch= 指定時はそのブランチを開く（存在しなければサーバー側でデフォルトへ
    // フォールバックし、branchFallback で通知される。SPEC-vertical-editor-phase5 §3.1）
    getEditorWorkspace(id, typeof branch === "string" ? branch : undefined),
    // 逆引き（原稿 → シーン）はサーバーで1本引くだけ（SPEC-manuscript-bridge §5.5。
    // scenes.manuscript_path の等値検索で、GitHub API 呼び出しは増えない）
    fetchLinkedScenesByPath(supabase, id),
  ]);

  return (
    <VerticalEditor
      projectId={id}
      workspace={result.ok ? (result.data ?? null) : null}
      workspaceError={result.ok ? null : result.error.message}
      initialFile={typeof file === "string" ? file : null}
      linkedScenes={linkedScenes}
    />
  );
}
