import { getManuscriptTree } from "@/lib/actions/manuscripts";
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
  const result = await getManuscriptTree(id);

  return (
    <ManuscriptWorkspace
      projectId={id}
      tree={result.ok ? (result.data ?? null) : null}
      treeError={result.ok ? null : result.error.message}
      initialFile={typeof file === "string" ? file : null}
    />
  );
}
