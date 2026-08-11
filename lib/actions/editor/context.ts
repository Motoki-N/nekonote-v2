import { z } from "zod";

import { AppError } from "@/lib/errors";
import {
  extractEntryPaths,
  extractPageSizeCss,
  extractThemePath,
  joinRepoPath,
} from "@/lib/editor/book-config";
import { getFileContent, getManuscriptTree } from "@/lib/git/github";
import { loadProjectGitContext } from "@/lib/git/project-context";
import {
  gitBranchNameSchema,
  manuscriptFilePathSchema,
} from "@/lib/schemas/manuscript";

// 縦書きエディタの Server Actions（SPEC-vertical-editor-phase2）。
// 原稿の実体は常にGitHub（読み書きとも Contents API 経由・DBには置かない）

export const uuidSchema = z.uuid();
export const blobShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "SHAが不正です");
export const commitMessageSchema = z
  .string()
  .trim()
  .min(1, "コミットメッセージを入力してください")
  .max(200);
// Contents API の読み込み上限（1MB）に合わせる。超えると保存後に自分で開けなくなる
export const contentSchema = z
  .string()
  .max(1_000_000, "本文が大きすぎます（上限1MB）");
// 新規章のファイル名（`manuscripts/` 配下固定・スラッシュ不可・`..` 不可。SPEC §3.3）
export const chapterFileNameSchema = z
  .string()
  .regex(/^(?!.*\.\.)[0-9A-Za-z][0-9A-Za-z._-]{0,80}\.md$/, {
    error: "ファイル名は英数字で始まる「NN-slug.md」形式で入力してください",
  });
// ブランチ名の切替用検証は gitBranchNameSchema（lib/schemas/manuscript.ts）を共用する
export const branchNameSchema = gitBranchNameSchema;
// 新規ブランチ名（作成はASCII限定・英数字始まり。SPEC-phase5 §3.2）。
// git の ref 規則はパス要素ごとに課されるため、`/` 区切りの各要素を検証する
// （security-reviewer 指摘 M-1: 全体末尾だけの検査では foo.lock/bar 等が GitHub 側の
// 422 まで素通りし「既に存在します」と誤案内される）
export const newBranchNameSchema = z
  .string()
  .regex(/^(?!.*\.\.)(?!.*\/\/)[0-9A-Za-z][0-9A-Za-z._/-]{0,99}$/, {
    error:
      "ブランチ名は英数字で始まる100字以内（英数字・._/-）で入力してください",
  })
  .refine(
    (name) =>
      name
        .split("/")
        .every(
          (seg) =>
            seg.length > 0 &&
            !seg.startsWith(".") &&
            !seg.endsWith(".") &&
            !seg.endsWith(".lock"),
        ),
    {
      error:
        "ブランチ名が不正です（各階層は . で始まらず、. / .lock で終わらないこと）",
    },
  );

/** アクション引数のブランチ検証（省略時は undefined＝デフォルトブランチの現行動作） */
export function parseBranch(branch: string | undefined): string | undefined {
  if (branch === undefined || branch === "") return undefined;
  return branchNameSchema.parse(branch);
}

export type EditorContext = {
  userId: string;
  repo: string;
  basePath: string;
  token: string;
};

/** 認証＋プロジェクト所有確認（RLS越し取得）＋PAT取得。前提未達は AppError */
export async function loadEditorContext(
  projectId: string,
): Promise<EditorContext> {
  const { userId, repo, basePath, token } = await loadProjectGitContext(
    projectId,
    { patMessage: "GitHub PATが未登録です。設定から登録してください" },
  );
  return { userId, repo, basePath, token };
}

/** 章ファイルパスの検証（base_path 配下の manuscripts/*.md のみ許可） */
export function validateChapterPath(
  basePath: string,
  filePath: string,
): string {
  const path = manuscriptFilePathSchema.parse(filePath);
  const prefix = basePath === "" ? "" : `${basePath}/`;
  if (!path.startsWith(`${prefix}manuscripts/`) || !path.endsWith(".md")) {
    throw new AppError("validation", "ファイルパスが不正です");
  }
  return path;
}

export type EditorChapter = {
  /** リポジトリルートからのパス */
  path: string;
  /** book.config.js の entry に載っているか（未登録は一覧末尾に印つき表示。SPEC §3.3） */
  inEntry: boolean;
};

/** 章一覧を entry 順（正）＋entry未登録（ファイル名昇順・末尾）で返す */
export async function listChapters(
  ctx: EditorContext,
  ref?: string,
): Promise<{
  chapters: EditorChapter[];
  themePath: string | null;
  /** book.config.js の size（CSS値）。プレビューの @page size に注入する */
  pageSizeCss: string | null;
}> {
  const tree = await getManuscriptTree(ctx.token, ctx.repo, ctx.basePath, ref);
  const prefix = ctx.basePath === "" ? "" : `${ctx.basePath}/`;
  const files = tree
    .map((entry) => entry.path)
    .filter(
      (path) =>
        path.startsWith(`${prefix}manuscripts/`) && path.endsWith(".md"),
    );

  // book.config.js は実行せず文字列抽出（SPEC §3.3）。読めなければファイル名昇順フォールバック
  let entryPaths: string[] = [];
  let themePath: string | null = null;
  let pageSizeCss: string | null = null;
  const configPath = joinRepoPath(ctx.basePath, "book.config.js");
  if (configPath) {
    try {
      const config = await getFileContent(ctx.token, ctx.repo, configPath, ref);
      entryPaths = extractEntryPaths(config.content);
      themePath = extractThemePath(config.content);
      pageSizeCss = extractPageSizeCss(config.content);
    } catch {
      // book.config.js がないリポジトリも許容する（テーマは既定・章順はファイル名昇順）
    }
  }

  const fileSet = new Set(files);
  const ordered: EditorChapter[] = [];
  for (const entry of entryPaths) {
    const full = joinRepoPath(ctx.basePath, entry);
    if (full && fileSet.has(full)) {
      ordered.push({ path: full, inEntry: true });
      fileSet.delete(full);
    }
  }
  // entry 未登録の章は末尾へ（files はツリー取得時点でパス昇順）
  for (const path of files) {
    if (fileSet.has(path)) ordered.push({ path, inEntry: false });
  }
  return { chapters: ordered, themePath, pageSizeCss };
}
