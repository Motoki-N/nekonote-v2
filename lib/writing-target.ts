import "server-only";

import { extractThemePath, joinRepoPath } from "@/lib/editor/book-config";
import { charsPerPage, extractKumiSettings } from "@/lib/editor/word-count";
import { getFileContent } from "@/lib/git/github";

/**
 * 目標ページ数→文字数の換算（Issue #60。SPEC-dashboard-critique-settings のスコープ外項目）。
 * エディタのページ数見積り（SPEC-vertical-editor-phase3 §5）と同じ材料を使う:
 * book.config.js の theme が指すテーマCSSから版面の行数×字詰めを読む。
 * repo/PAT がない・読めない場合は同じ既定（文庫A6: 640字/ページ）に落とすフェイルソフト
 */
export async function convertTargetPagesToChars(params: {
  targetPages: number;
  /** repo/PAT が揃わないときは null（既定換算になる） */
  token: string | null;
  repo: string | null;
  basePath: string;
}): Promise<number> {
  return params.targetPages * (await fetchCharsPerPage(params));
}

/** リポジトリのテーマCSSから1ページの収容字数を読む。読めなければ既定値 */
async function fetchCharsPerPage(params: {
  token: string | null;
  repo: string | null;
  basePath: string;
}): Promise<number> {
  const { token, repo, basePath } = params;
  if (!token || !repo) return charsPerPage(null);
  try {
    const configPath = joinRepoPath(basePath, "book.config.js");
    if (!configPath) return charsPerPage(null);
    const config = await getFileContent(token, repo, configPath);
    // npmパッケージ指定等はリポジトリ内にCSSがない＝既定に落とす（editor.ts loadSettings と同じ判定）
    const themePath = extractThemePath(config.content);
    if (!themePath || !themePath.endsWith(".css")) return charsPerPage(null);
    const cssPath = joinRepoPath(basePath, themePath);
    if (!cssPath) return charsPerPage(null);
    const css = await getFileContent(token, repo, cssPath);
    return charsPerPage(extractKumiSettings(css.content));
  } catch {
    // 換算は補助情報なのでダッシュボード表示を落とさない
    return charsPerPage(null);
  }
}
