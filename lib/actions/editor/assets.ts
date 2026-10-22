"use server";

import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import { joinRepoPath } from "@/lib/editor/book-config";
import {
  createBinaryFileContent,
  getDefaultBranch,
  getRawFileBytes,
} from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import { atelierImageFileName } from "@/lib/schemas/illustration";
import { createClient } from "@/lib/supabase/server";
import {
  loadEditorContext,
  parseBranch,
  uuidSchema,
  type EditorContext,
} from "./context";

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
// base64 は Server Action 引数配列の直下に置かずオブジェクトで包んで受ける。
// React のデコーダは引数配列配下の文字列長を arraySizeLimit（1e6）に数えるため、
// 直下に置くと約750KB超の画像が本体到達前に落ちる（Issue #316）
const imagePayloadSchema = z.object({ base64Content: imageBase64Schema });

/**
 * 画像を `images/` へ1コミットで追加する（uploadImage・placeIllustration の共通部）。
 * 同名ファイルがあるとき、reuseExisting=false なら `-2` からの連番でリネームして再試行し、
 * true なら既存ファイルをそのまま使う（コミットしない）
 */
async function commitImage(
  ctx: EditorContext,
  name: string,
  base64Content: string,
  branch: string | undefined,
  { reuseExisting }: { reuseExisting: boolean },
): Promise<{ repoPath: string; fileName: string }> {
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
        base64Content,
        message: `執筆: 挿絵 ${candidate} を追加（ネコノテAI 縦書きエディタ）`,
        branch,
      });
      return { repoPath: path, fileName: candidate };
    } catch (error) {
      if (error instanceof AppError && error.code === "conflict") {
        if (!reuseExisting) continue;
        // conflict は 409（ブランチの並行更新）と 422 をまとめた変換なので、
        // 既存ファイルが実在するときだけ再利用する（実在しなければ元のエラーを返す）
        const exists = await getRawFileBytes(ctx.token, ctx.repo, path, branch)
          .then(() => true)
          .catch(() => false);
        if (exists) return { repoPath: path, fileName: candidate };
      }
      throw error;
    }
  }
  throw new AppError(
    "conflict",
    "同名の画像が既に多数あります。ファイル名を変えてください",
  );
}

/**
 * 画像を `images/` へ即コミットする（SPEC-phase3 §6・論点C）。
 * 同名ファイルがある場合は `-2` からの連番でリネームして再試行する。
 * 挿入記法の追記はクライアント（エディタ）の責務
 */
export async function uploadImage(
  projectId: string,
  fileName: string,
  image: { base64Content: string },
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
    const { base64Content: content } = imagePayloadSchema.parse(image);
    if (Buffer.from(content, "base64").length > MAX_IMAGE_BYTES) {
      throw new AppError("validation", "画像が大きすぎます（上限10MB）");
    }

    const committed = await commitImage(ctx, name, content, branch, {
      reuseExisting: false,
    });
    return { ok: true, data: committed };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * アトリエのイラストを原稿リポジトリの `images/atelier-<UUID>.<拡張子>` へコピーコミットする（SPEC-illustrator §11）。
 * Storage は非公開・署名URLは短寿命で、組版ビルドにはリポジトリ内の実ファイルが要るため、直接参照はしない。
 * ファイル名に UUID が入るので、同名が既にあれば同じイラストとみなして再コミットしない（生成画像は不変）。
 * 既定ブランチへの配置なら⛳（placed_at）を付け、作業ブランチではコピー先パスだけ記録する
 * （マージ後の原稿走査で⛳が付く）。挿入記法の追記はクライアント（エディタ）の責務
 */
export async function placeIllustration(
  projectId: string,
  illustrationId: string,
  targetBranch?: string,
): Promise<
  ActionResult<{ repoPath: string; fileName: string; recorded: boolean }>
> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-upload", {
      perMinute: 6,
      perDay: 100,
    });
    const branch = parseBranch(targetBranch);
    const parsedId = uuidSchema.parse(illustrationId);
    const supabase = await createClient();

    // RLS越しの取得＝所有確認。storage_path はクライアントから受け取らない。
    // 別プロジェクトのイラストは配置させない（⛳の走査はプロジェクト単位のため）
    const { data: row, error } = await supabase
      .from("illustrations")
      .select("id, project_id, storage_path, placed_at")
      .eq("id", parsedId)
      .maybeSingle();
    if (error) throw new AppError("internal", error.message);
    if (!row || row.project_id !== projectId) {
      throw new AppError("not_found", "イラストが見つかりません");
    }

    const extension = /\.(png|jpg|webp)$/.exec(row.storage_path)?.[1];
    if (!extension) {
      throw new AppError("internal", "イラストの画像形式が想定外です");
    }
    const { data: blob, error: downloadError } = await supabase.storage
      .from("illustrations")
      .download(row.storage_path);
    if (downloadError || !blob) {
      throw new AppError(
        "internal",
        `イラストの取得に失敗しました: ${downloadError?.message}`,
      );
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    // バケットの上限（10MB）と同値だが、GitHub へ送る前に多層防御で確かめる
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new AppError("validation", "画像が大きすぎます（上限10MB）");
    }

    const committed = await commitImage(
      ctx,
      atelierImageFileName(row.id, extension),
      bytes.toString("base64"),
      branch,
      { reuseExisting: true },
    );

    // ⛳は既定ブランチへの配置のときだけ付ける。既定ブランチかどうかはサーバー側で判定する。
    // 判定に失敗しても配置（コミット済み）は失敗扱いにせず、⛳を付けない側に倒す（走査で補正できる）
    const onDefaultBranch =
      branch === undefined ||
      (await getDefaultBranch(ctx.token, ctx.repo)
        .then((defaultBranch) => branch === defaultBranch)
        .catch(() => false));
    // 記録の失敗で配置（コミット済み）を失敗扱いにしない。⛳は原稿走査で補正できる
    const { error: recordError } = await supabase
      .from("illustrations")
      .update({
        placed_image_path: committed.repoPath,
        ...(onDefaultBranch && row.placed_at === null
          ? { placed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", row.id);
    return { ok: true, data: { ...committed, recorded: !recordError } };
  } catch (error) {
    return toActionError(error);
  }
}
