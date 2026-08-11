"use server";

import { z } from "zod";

import { toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import {
  createTagRef,
  getBranchHeadSha,
  getDefaultBranch,
  getReleaseByTag,
  listTags,
} from "@/lib/git/github";
import type { ReleaseAsset } from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import { loadEditorContext } from "./context";

/** ビルド種別。タグのサフィックス＝原稿リポジトリ側ワークフローのトリガーに対応する */
export type BuildKind = "nyuko" | "epub";

// 原稿リポジトリの Actions ワークフローのトリガー（`v*-nyuko` / `v*-epub` タグ push）に合わせる
const buildTagSchema = z
  .string()
  .regex(/^v[0-9A-Za-z._-]{1,30}-(nyuko|epub)$/, {
    error: "タグは「v0.3-nyuko」「v0.3-epub」の形式で入力してください",
  });

/** 既存タグから次のタグ名を提案する（v{major}.{minor}-<種別> の minor をインクリメント） */
function suggestNextTag(tags: string[], kind: BuildKind): string {
  let best: [number, number] | null = null;
  const pattern = new RegExp(`^v(\\d+)\\.(\\d+)-${kind}$`);
  for (const tag of tags) {
    const match = tag.match(pattern);
    if (!match) continue;
    const version: [number, number] = [Number(match[1]), Number(match[2])];
    if (
      !best ||
      version[0] > best[0] ||
      (version[0] === best[0] && version[1] > best[1])
    ) {
      best = version;
    }
  }
  return best ? `v${best[0]}.${best[1] + 1}-${kind}` : `v1.0-${kind}`;
}

export type BuildTagInfo = {
  /** ビルド種別ごとの既存タグ（新しい順の判定はできないためAPI返却順）と次タグ提案 */
  nyuko: { tags: string[]; suggestedTag: string };
  epub: { tags: string[]; suggestedTag: string };
  /** Actions ページへのリンク用 */
  repo: string;
};

/** ビルドダイアログの初期情報（既存タグ・次タグ提案） */
export async function getBuildTagInfo(
  projectId: string,
): Promise<ActionResult<BuildTagInfo>> {
  try {
    const ctx = await loadEditorContext(projectId);
    const tags = await listTags(ctx.token, ctx.repo);
    const nyukoTags = tags.filter((tag) => /-nyuko$/.test(tag));
    const epubTags = tags.filter((tag) => /-epub$/.test(tag));
    return {
      ok: true,
      data: {
        nyuko: {
          tags: nyukoTags,
          suggestedTag: suggestNextTag(nyukoTags, "nyuko"),
        },
        epub: {
          tags: epubTags,
          suggestedTag: suggestNextTag(epubTags, "epub"),
        },
        repo: ctx.repo,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * ビルドタグ（入稿PDF / EPUB）の作成＝Actions ビルドの起動（SPEC-phase3 §8。タグ作成の代行。
 * 対象はデフォルトブランチのHEAD。Contents権限で可能——PATスコープ変更なし）
 */
export async function createBuildTag(
  projectId: string,
  tagName: string,
): Promise<ActionResult<{ tag: string; headSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-build", { perMinute: 3, perDay: 30 });
    const tag = buildTagSchema.parse(tagName);
    const branch = await getDefaultBranch(ctx.token, ctx.repo);
    const headSha = await getBranchHeadSha(ctx.token, ctx.repo, branch);
    await createTagRef(ctx.token, ctx.repo, tag, headSha);
    return { ok: true, data: { tag, headSha } };
  } catch (error) {
    return toActionError(error);
  }
}

export type BuildStatus =
  { state: "pending" } | { state: "done"; assets: ReleaseAsset[] };

/**
 * ビルドの完了検知（SPEC-phase3 §8・論点B）。
 * 同タグの Release と成果物（-nyuko: PDF / -epub: EPUB）の出現をもって完了とみなす
 * （Actions API は使わない）
 */
export async function getBuildStatus(
  projectId: string,
  tagName: string,
): Promise<ActionResult<BuildStatus>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-build-status", {
      perMinute: 10,
      perDay: 500,
    });
    const tag = buildTagSchema.parse(tagName);
    const release = await getReleaseByTag(ctx.token, ctx.repo, tag);
    const extension = tag.endsWith("-epub") ? ".epub" : ".pdf";
    const assets =
      release?.assets.filter((asset) => asset.name.endsWith(extension)) ?? [];
    if (assets.length === 0) return { ok: true, data: { state: "pending" } };
    return { ok: true, data: { state: "done", assets } };
  } catch (error) {
    return toActionError(error);
  }
}
