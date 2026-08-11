"use server";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import type { ThemeAssets } from "@/lib/editor/preview";
import { resolveThemeAssets } from "@/lib/editor/theme";
import { getBranchHeadSha, getDefaultBranch } from "@/lib/git/github";
import { loadProjectGitOrGate } from "@/lib/git/project-context";
import { createClient } from "@/lib/supabase/server";
import { parseBranch, listChapters } from "./context";
import type { EditorContext, EditorChapter } from "./context";

export type EditorWorkspaceData =
  | { gate: "no_repo" }
  | { gate: "no_pat" }
  | {
      gate: "ok";
      repo: string;
      /** 開いているブランチ（IndexedDB待避キーにも使う。SPEC-phase5でデフォルト以外も可） */
      branch: string;
      /** デフォルトブランチ（PRのbase・入稿ビルド対象。SPEC-phase5 §3） */
      defaultBranch: string;
      /** 要求されたブランチが存在せずデフォルトへフォールバックしたか（SPEC-phase5 §3.1） */
      branchFallback: boolean;
      basePath: string;
      chapters: EditorChapter[];
      theme: ThemeAssets;
    };

/**
 * エディタの初期データ（章一覧・テーマCSS）。前提未達（repo/PAT）は gate で返す。
 * branch 指定時はそのブランチの内容を返す（存在しなければデフォルトへフォールバック）
 */
export async function getEditorWorkspace(
  projectId: string,
  branch?: string,
): Promise<ActionResult<EditorWorkspaceData>> {
  try {
    const supabase = await createClient();

    // middleware・RLSに加えた明示チェック（SPEC-auth §3.3 の多層防御）
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    const gitCtx = await loadProjectGitOrGate(supabase, projectId);
    if (gitCtx.gate !== "ok") return { ok: true, data: { gate: gitCtx.gate } };

    const ctx: EditorContext = {
      userId: user.id,
      repo: gitCtx.repo,
      basePath: gitCtx.basePath,
      token: gitCtx.token,
    };
    // ブランチ解決（SPEC-phase5 §3.1）。存在しない・不正なブランチはデフォルトへ
    // フォールバックする（URL直打ちでエディタ全体をエラーにしない）
    let requested: string | undefined;
    let branchFallback = false;
    try {
      requested = parseBranch(branch);
    } catch {
      requested = undefined;
      branchFallback = true;
    }
    const defaultBranch = await getDefaultBranch(ctx.token, ctx.repo);
    let currentBranch = defaultBranch;
    if (requested !== undefined && requested !== defaultBranch) {
      try {
        await getBranchHeadSha(ctx.token, ctx.repo, requested);
        currentBranch = requested;
      } catch {
        branchFallback = true;
      }
    }
    const ref = currentBranch === defaultBranch ? undefined : currentBranch;
    const { chapters, themePath, pageSizeCss } = await listChapters(ctx, ref);
    const resolved = await resolveThemeAssets(
      ctx.token,
      ctx.repo,
      ctx.basePath,
      themePath,
      ref,
    );
    // 判型の注入: CLIビルドでは book.config.js の size が @page size を与えるが、
    // ブラウザプレビューには渡らない。--vs-page--size（theme-base の @page が参照）を
    // 注入しないと size: auto のままページ分割されない（2026-07-16 に発見したバグの修正）。
    // resolveThemeAssets はモジュール共有の既定テーマを返すことがあるため非破壊で足す
    const theme = pageSizeCss
      ? {
          ...resolved,
          inlineCss: `${resolved.inlineCss}\n:root { --vs-page--size: ${pageSizeCss}; }\n`,
        }
      : resolved;
    return {
      ok: true,
      data: {
        gate: "ok",
        repo: ctx.repo,
        branch: currentBranch,
        defaultBranch,
        branchFallback,
        basePath: ctx.basePath,
        chapters,
        theme,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}
