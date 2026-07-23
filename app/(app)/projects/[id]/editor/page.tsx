import { getEditorWorkspace } from "@/lib/actions/editor";
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
  // ?branch= 指定時はそのブランチを開く（存在しなければサーバー側でデフォルトへ
  // フォールバックし、branchFallback で通知される。SPEC-vertical-editor-phase5 §3.1）
  const result = await getEditorWorkspace(
    id,
    typeof branch === "string" ? branch : undefined,
  );

  return (
    <VerticalEditor
      projectId={id}
      workspace={result.ok ? (result.data ?? null) : null}
      workspaceError={result.ok ? null : result.error.message}
      initialFile={typeof file === "string" ? file : null}
    />
  );
}
