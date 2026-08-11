"use server";

import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import { joinRepoPath } from "@/lib/editor/book-config";
import { createBinaryFileContent } from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parseBranch, loadEditorContext } from "./context";

// 拡張子allowlistは画像プロキシ（/api/editor/asset）と同一に保つ
const imageFileNameSchema = z
  .string()
  .regex(/^(?!.*\.\.)[0-9A-Za-z][0-9A-Za-z._-]{0,80}\.(png|jpe?g|webp|gif)$/, {
    error:
      "画像ファイル名が不正です（英数字始まり・png/jpg/jpeg/webp/gif のみ）",
  });
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const imageBase64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: "画像データが不正です" })
  // base64は元サイズの約4/3。デコード前に長さで粗く弾く（正確な検査はデコード後）
  .max(Math.ceil((MAX_IMAGE_BYTES / 3) * 4) + 8, {
    error: "画像が大きすぎます（上限10MB）",
  });

/**
 * 画像を `images/` へ即コミットする（SPEC-phase3 §6・論点C）。
 * 同名ファイルがある場合は `-2` からの連番でリネームして再試行する。
 * 挿入記法の追記はクライアント（エディタ）の責務
 */
export async function uploadImage(
  projectId: string,
  fileName: string,
  base64Content: string,
  targetBranch?: string,
): Promise<ActionResult<{ repoPath: string; fileName: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-upload", {
      perMinute: 6,
      perDay: 100,
    });
    const branch = parseBranch(targetBranch);
    const name = imageFileNameSchema.parse(fileName);
    const content = imageBase64Schema.parse(base64Content);
    if (Buffer.from(content, "base64").length > MAX_IMAGE_BYTES) {
      throw new AppError("validation", "画像が大きすぎます（上限10MB）");
    }

    const dot = name.lastIndexOf(".");
    const stem = name.slice(0, dot);
    const ext = name.slice(dot);
    // 同名衝突は連番リネームで自動回避（最大5回。使い勝手優先で聞き返さない）
    for (let attempt = 1; attempt <= 5; attempt++) {
      const candidate = attempt === 1 ? name : `${stem}-${attempt}${ext}`;
      const path = joinRepoPath(ctx.basePath, "images", candidate);
      if (!path) throw new AppError("validation", "画像ファイル名が不正です");
      try {
        await createBinaryFileContent(ctx.token, ctx.repo, path, {
          base64Content: content,
          message: `執筆: 挿絵 ${candidate} を追加（ネコノテAI 縦書きエディタ）`,
          branch,
        });
        return { ok: true, data: { repoPath: path, fileName: candidate } };
      } catch (error) {
        if (error instanceof AppError && error.code === "conflict") continue;
        throw error;
      }
    }
    throw new AppError(
      "conflict",
      "同名の画像が既に多数あります。ファイル名を変えてください",
    );
  } catch (error) {
    return toActionError(error);
  }
}
