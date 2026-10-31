"use server";

import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import { joinRepoPath } from "@/lib/editor/book-config";
import {
  PRIMARY_CONFIG,
  STYLE_SETS,
  TYPESETTING_CANDIDATE_PATHS,
  TYPESETTING_STYLES,
  convertTypesettingStyle,
  detectTypesettingStyle,
  templatePathsFor,
} from "@/lib/editor/typesetting-style";
import type {
  TypesettingProblem,
  TypesettingStyle,
} from "@/lib/editor/typesetting-style";
import {
  createCommit,
  createTree,
  getBranchHeadShaOrNull,
  getDefaultBranch,
  getFileContent,
  getFullTree,
  updateBranchRef,
  type SetupTreeEntry,
} from "@/lib/git/github";
import { loadTemplateFiles } from "@/lib/git/template";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  blobShaSchema,
  branchNameSchema,
  loadEditorContext,
  parseBranch,
  type EditorContext,
} from "./context";

// 組版スタイル（縦書き・文庫 ⇄ 横書き・技術書）の切替（SPEC-horizontal-typesetting §7）。
// 変換そのものは純関数 convertTypesettingStyle（初期セットアップと共用）に任せ、
// ここは HEAD の読み取り・楽観ロック・1コミット化だけを受け持つ

/** 差分表示に本文を返さないファイル（巨大で、差分を読む意味が薄い） */
const NO_DIFF_PATHS = new Set(["package-lock.json"]);

export type TypesettingPreviewChange = {
  /** プロジェクトルート起点のパス */
  path: string;
  kind: "modify" | "add" | "delete";
  /** 差分表示用（NO_DIFF_PATHS・削除・追加の片側は null） */
  before: string | null;
  after: string | null;
};

export type TypesettingPreview =
  | {
      ok: true;
      from: TypesettingStyle;
      to: TypesettingStyle;
      changes: TypesettingPreviewChange[];
      warnings: string[];
      /** 楽観ロック基準（リポジトリルートからのパス → blob SHA）。候補パスのうち存在するものすべて */
      baseShas: Record<string, string>;
    }
  | { ok: false; problems: TypesettingProblem[] };

const switchInputSchema = z.object({
  to: z.enum(TYPESETTING_STYLES),
  /** コミット先ブランチ（省略時はデフォルト。SPEC-phase5 §3.4） */
  branch: branchNameSchema.optional(),
});

const switchSaveSchema = switchInputSchema.extend({
  /** プレビュー時点の blob SHA（パス → SHA） */
  baseShas: z.record(z.string().max(300), blobShaSchema),
});

/**
 * 指定コミット時点の候補ファイルを読む。書き換え対象は定数表の候補パスに限る
 * （クライアントから任意パスを受け取らない。SPEC §7.1）
 */
async function readCandidates(ctx: EditorContext, headSha: string) {
  const { treeSha, files } = await getFullTree(ctx.token, ctx.repo, headSha);
  const shaByPath = new Map(files.map((file) => [file.path, file.sha]));
  const contents: Record<string, string> = {};
  const shas: Record<string, string> = {};
  const fullPath = (relPath: string) => joinRepoPath(ctx.basePath, relPath);
  await Promise.all(
    TYPESETTING_CANDIDATE_PATHS.map(async (relPath) => {
      const path = fullPath(relPath);
      const sha = path ? shaByPath.get(path) : undefined;
      if (!path || sha === undefined) return;
      shas[path] = sha;
      contents[relPath] = (
        await getFileContent(ctx.token, ctx.repo, path, headSha)
      ).content;
    }),
  );
  return { treeSha, contents, shas, fullPath };
}

/** HEAD の内容で変換を試算する（プレビュー・コミットの両方がこれを通る） */
async function convertAtHead(
  ctx: EditorContext,
  headSha: string,
  to: TypesettingStyle,
) {
  const read = await readCandidates(ctx, headSha);
  const config = read.contents[PRIMARY_CONFIG];
  if (config === undefined)
    throw new AppError("validation", "book.config.js が見つかりません");
  const from = detectTypesettingStyle(config);
  if (from === "custom") {
    return {
      read,
      from,
      result: {
        ok: false as const,
        problems: [
          {
            path: PRIMARY_CONFIG,
            reason:
              "テーマを手で指定しているため、アプリからは切り替えられません",
          },
        ],
      },
    };
  }
  const template = await loadTemplateFiles(templatePathsFor(to));
  const result = convertTypesettingStyle({
    files: read.contents,
    template,
    from,
    to,
  });
  return { read, from, result };
}

async function resolveHead(ctx: EditorContext, branch: string | undefined) {
  const targetBranch =
    parseBranch(branch) ?? (await getDefaultBranch(ctx.token, ctx.repo));
  const headSha = await getBranchHeadShaOrNull(
    ctx.token,
    ctx.repo,
    targetBranch,
  );
  if (headSha === null)
    throw new AppError("validation", "コミット先のブランチが見つかりません");
  return { targetBranch, headSha };
}

/** 切替の試算（変更されるファイルの一覧と差分、または切り替えられない理由）を返す */
export async function previewTypesettingSwitch(
  projectId: string,
  params: z.infer<typeof switchInputSchema>,
): Promise<ActionResult<TypesettingPreview>> {
  try {
    const ctx = await loadEditorContext(projectId);
    const { to, branch } = switchInputSchema.parse(params);
    const { headSha } = await resolveHead(ctx, branch);
    const { read, from, result } = await convertAtHead(ctx, headSha, to);
    if (!result.ok)
      return { ok: true, data: { ok: false, problems: result.problems } };
    // result.ok のとき from は custom ではない（custom は必ず ok: false を返す）
    if (from === "custom") throw new AppError("internal", "判定の不整合です");
    return {
      ok: true,
      data: {
        ok: true,
        from,
        to,
        changes: result.changes.map((change) => ({
          path: change.path,
          kind: change.kind,
          before: NO_DIFF_PATHS.has(change.path) ? null : change.before,
          after: NO_DIFF_PATHS.has(change.path) ? null : change.after,
        })),
        warnings: result.warnings,
        baseShas: read.shas,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 組版スタイルを切り替えて1コミットにする（SPEC §7.1）。
 * プレビュー後に候補ファイルが1つでも変わっていれば（増減を含む）何もコミットせず conflict。
 * 変換はプレビュー結果を信用せず HEAD の内容でやり直す
 */
export async function switchTypesettingStyle(
  projectId: string,
  params: z.infer<typeof switchSaveSchema>,
): Promise<ActionResult<{ warnings: string[] }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const { to, branch, baseShas } = switchSaveSchema.parse(params);
    const { targetBranch, headSha } = await resolveHead(ctx, branch);
    const { read, result } = await convertAtHead(ctx, headSha, to);

    const headPaths = Object.keys(read.shas);
    if (
      headPaths.length !== Object.keys(baseShas).length ||
      headPaths.some((path) => baseShas[path] !== read.shas[path])
    ) {
      throw new AppError(
        "conflict",
        "設定ファイルがリモートで更新されています。設定を開き直してください",
      );
    }
    if (!result.ok) {
      throw new AppError(
        "validation",
        `組版スタイルを切り替えられません（${result.problems.map((p) => p.path).join("・")}）`,
      );
    }

    const entries = result.changes.flatMap((change): SetupTreeEntry[] => {
      const path = read.fullPath(change.path);
      if (!path) return [];
      return change.kind === "delete"
        ? [{ path, mode: "100644", type: "blob", sha: null }]
        : [
            {
              path,
              mode: "100644",
              type: "blob",
              content: change.after ?? "",
            },
          ];
    });
    if (entries.length === 0)
      throw new AppError("validation", "変更する内容がありません");

    const treeSha = await createTree(
      ctx.token,
      ctx.repo,
      entries,
      read.treeSha,
    );
    const commitSha = await createCommit(ctx.token, ctx.repo, {
      message: `設定: 組版スタイルを${STYLE_SETS[to].label}に切り替え（ネコノテAI）`,
      treeSha,
      parentSha: headSha,
    });
    await updateBranchRef(ctx.token, ctx.repo, targetBranch, commitSha);
    return { ok: true, data: { warnings: result.warnings } };
  } catch (error) {
    return toActionError(error);
  }
}
