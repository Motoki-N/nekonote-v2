import { getFileContent, getManuscriptTree } from "@/lib/git/github";

// 原稿全ファイルの取得・文字数の共通処理。
// 進捗集計（lib/actions/manuscripts.ts）と講評の全文結合（/api/review・lib/actions/critique.ts)が共用する

export type ManuscriptFileContent = {
  path: string;
  content: string;
};

/** 空白・改行を除いた文字数（表示・進捗集計・講評ガードで共通の数え方） */
export function countChars(content: string): number {
  return content.replaceAll(/\s/g, "").length;
}

/**
 * base_path 配下の全原稿ファイルの本文をパス辞書順で取得する。
 * 同時リクエストを絞って取得する（無制限の並列は GitHub の secondary rate limit に触れうる）。
 * opened を渡すと、そのファイルは再取得せず渡された本文を使う
 */
export async function fetchAllManuscriptContents(
  token: string,
  repo: string,
  basePath: string,
  opened?: ManuscriptFileContent,
): Promise<ManuscriptFileContent[]> {
  const files = await getManuscriptTree(token, repo, basePath);
  const results: ManuscriptFileContent[] = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      files.slice(i, i + CONCURRENCY).map(async (f) => ({
        path: f.path,
        content:
          f.path === opened?.path
            ? opened.content
            : (await getFileContent(token, repo, f.path)).content,
      })),
    );
    results.push(...batch);
  }
  return results;
}
