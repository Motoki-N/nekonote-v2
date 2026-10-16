import {
  entryOrderedPaths,
  extractEntryPaths,
  joinRepoPath,
} from "@/lib/editor/book-config";
import { AppError } from "@/lib/errors";
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
 * opened を渡すと、そのファイルは再取得せず渡された本文を使う
 */
export async function fetchAllManuscriptContents(
  token: string,
  repo: string,
  basePath: string,
  opened?: ManuscriptFileContent,
): Promise<ManuscriptFileContent[]> {
  const files = await getManuscriptTree(token, repo, basePath);
  return fetchContents(
    token,
    repo,
    files.map((f) => f.path),
    opened,
  );
}

/**
 * 講評に渡す原稿ファイルの本文を、本としての並び（book.config.js の entry 順）で取得する
 * （Issue #310・SPEC-dashboard-critique-settings §3.5）。
 * entry に載ったファイルだけを返す（講評の書き戻し先 00-review-notes.md や未登録の章は含めない）。
 * book.config.js がない（404）・entry から実在のファイルを1件も拾えない場合は、
 * fetchAllManuscriptContents と同じく base_path 配下の全ファイルをパス辞書順で返す
 */
export async function fetchCritiqueManuscriptContents(
  token: string,
  repo: string,
  basePath: string,
): Promise<ManuscriptFileContent[]> {
  const files = await getManuscriptTree(token, repo, basePath);
  const filePaths = files.map((f) => f.path);

  let entryPaths: string[] = [];
  const configPath = joinRepoPath(basePath, "book.config.js");
  if (configPath) {
    try {
      const config = await getFileContent(token, repo, configPath);
      entryPaths = extractEntryPaths(config.content);
    } catch (error) {
      // book.config.js がないリポジトリは許容する（全ファイルのフォールバックへ）。
      // それ以外の失敗（レート制限・PAT失効等）は黙ってフォールバックせずエラーにする——
      // フォールバックするとレビューメモや未登録の章が講評に混ざるうえ、
      // 講評パネルの概算と実行時でファイル集合がずれて15万字確認が食い違うため
      if (!(error instanceof AppError && error.code === "not_found"))
        throw error;
    }
  }

  return fetchContents(
    token,
    repo,
    entryOrderedPaths(filePaths, entryPaths, basePath) ?? filePaths,
  );
}

/**
 * 指定パスの本文を順序どおりに取得する。
 * 同時リクエストを絞って取得する（無制限の並列は GitHub の secondary rate limit に触れうる）。
 * opened を渡すと、そのファイルは再取得せず渡された本文を使う
 */
async function fetchContents(
  token: string,
  repo: string,
  paths: string[],
  opened?: ManuscriptFileContent,
): Promise<ManuscriptFileContent[]> {
  const results: ManuscriptFileContent[] = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      paths.slice(i, i + CONCURRENCY).map(async (path) => ({
        path,
        content:
          path === opened?.path
            ? opened.content
            : (await getFileContent(token, repo, path)).content,
      })),
    );
    results.push(...batch);
  }
  return results;
}
