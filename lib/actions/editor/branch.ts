"use server";

import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import {
  createBranchRef,
  createPullRequest,
  getBranchHeadSha,
  getDefaultBranch,
  listBranches,
} from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  branchNameSchema,
  newBranchNameSchema,
  loadEditorContext,
} from "./context";

export type EditorBranches = {
  /** デフォルトブランチを先頭に、残りは名前昇順 */
  branches: string[];
  defaultBranch: string;
};

/** ブランチ一覧（セレクタ用）。デフォルトブランチを先頭に返す */
export async function listEditorBranches(
  projectId: string,
): Promise<ActionResult<EditorBranches>> {
  try {
    const ctx = await loadEditorContext(projectId);
    const [names, defaultBranch] = await Promise.all([
      listBranches(ctx.token, ctx.repo),
      getDefaultBranch(ctx.token, ctx.repo),
    ]);
    const rest = names
      .filter((name) => name !== defaultBranch)
      .sort((a, b) => a.localeCompare(b, "en"));
    return {
      ok: true,
      data: { branches: [defaultBranch, ...rest], defaultBranch },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * ブランチ作成（SPEC-phase5 §3.2）。起点は常にデフォルトブランチのHEAD。
 * Git Refs API（Contents権限で可能——PATスコープ変更なし）
 */
export async function createEditorBranch(
  projectId: string,
  branchName: string,
): Promise<ActionResult<{ branch: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-branch", {
      perMinute: 6,
      perDay: 100,
    });
    const branch = newBranchNameSchema.parse(branchName);
    const defaultBranch = await getDefaultBranch(ctx.token, ctx.repo);
    if (branch === defaultBranch) {
      throw new AppError(
        "conflict",
        `ブランチ ${branch} は既に存在します。別の名前を指定してください`,
      );
    }
    const headSha = await getBranchHeadSha(ctx.token, ctx.repo, defaultBranch);
    await createBranchRef(ctx.token, ctx.repo, branch, headSha);
    return { ok: true, data: { branch } };
  } catch (error) {
    return toActionError(error);
  }
}

const prTitleSchema = z
  .string()
  .trim()
  .min(1, "タイトルを入力してください")
  .max(200);
const prBodySchema = z.string().max(5000, "本文が長すぎます（上限5000字）");

/**
 * Pull Request 作成（SPEC-phase5 §3.3）。head=指定ブランチ・base=デフォルトブランチ固定。
 * マージ・レビューはGitHub側で行う（アプリは作成の入口まで）
 */
export async function createEditorPullRequest(
  projectId: string,
  params: { branch: string; title: string; body: string },
): Promise<ActionResult<{ number: number; url: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-pr", { perMinute: 3, perDay: 30 });
    const branch = branchNameSchema.parse(params.branch);
    const title = prTitleSchema.parse(params.title);
    const body = prBodySchema.parse(params.body);
    const defaultBranch = await getDefaultBranch(ctx.token, ctx.repo);
    if (branch === defaultBranch) {
      throw new AppError(
        "validation",
        "デフォルトブランチからはPull Requestを作成できません",
      );
    }
    const pr = await createPullRequest(ctx.token, ctx.repo, {
      title,
      body,
      head: branch,
      base: defaultBranch,
    });
    return { ok: true, data: { number: pr.number, url: pr.htmlUrl } };
  } catch (error) {
    return toActionError(error);
  }
}
