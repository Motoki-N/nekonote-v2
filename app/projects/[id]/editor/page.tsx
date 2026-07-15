import { getEditorWorkspace } from "@/lib/actions/editor";
import { VerticalEditor } from "@/components/editor/vertical-editor";

/**
 * 縦書きエディタタブ（SPEC-vertical-editor-phase2 §3.1）。
 * 章一覧・テーマCSSの取得はサーバー側で行い、前提未達（PAT未登録・repo未設定）や
 * GitHub APIエラーは VerticalEditor が誘導表示に変換する（原稿タブと同じフェイルソフト）
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEditorWorkspace(id);

  return (
    <VerticalEditor
      projectId={id}
      workspace={result.ok ? (result.data ?? null) : null}
      workspaceError={result.ok ? null : result.error.message}
    />
  );
}
