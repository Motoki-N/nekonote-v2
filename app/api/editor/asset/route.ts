import type { NextRequest } from "next/server";
import { z } from "zod";

import { joinRepoPath } from "@/lib/editor/book-config";
import { AppError, errorResponse } from "@/lib/errors";
import { patCredentialProvider } from "@/lib/git/credentials";
import { getRawFileBytes } from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import { gitBranchNameSchema } from "@/lib/schemas/manuscript";
import { createClient } from "@/lib/supabase/server";

// プレビュー用の画像認証プロキシ（SPEC-vertical-editor-phase2 §5.3）。
// PATを持たないブラウザに代わり、サーバーがGitHubから画像を取得して返す。
// 認可: セッション必須＋プロジェクト所有確認（RLS越し取得）＋パス検証（security-reviewer 対象）

/** 返してよい拡張子の allowlist と Content-Type の対応（それ以外は拒否） */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const uuidSchema = z.uuid();

// base_path 起点の相対パスのみ受け付ける（絶対パス・トラバーサル拒否）
const assetPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\"),
    "パスが不正です",
  );

export async function GET(request: NextRequest) {
  try {
    const projectId = uuidSchema.parse(
      request.nextUrl.searchParams.get("projectId"),
    );
    const assetPath = assetPathSchema.parse(
      request.nextUrl.searchParams.get("path"),
    );
    // 対象ブランチ（省略時はデフォルトブランチ。SPEC-vertical-editor-phase5 §3.4）
    const branchParam = request.nextUrl.searchParams.get("branch");
    const branch =
      branchParam === null || branchParam === ""
        ? undefined
        : gitBranchNameSchema.parse(branchParam);
    const extension = assetPath.split(".").pop()?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
    if (!contentType) {
      throw new AppError("validation", "この拡張子のファイルは取得できません");
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    enforceRateLimit(user.id, "editor-asset", { perMinute: 120, perDay: 3000 });

    // RLS越しの取得＝所有確認を兼ねる
    const { data: project, error } = await supabase
      .from("projects")
      .select("id, repo, base_path")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw new AppError("internal", error.message);
    if (!project)
      throw new AppError("not_found", "プロジェクトが見つかりません");
    if (!project.repo)
      throw new AppError("validation", "リポジトリが設定されていません");

    const credential = await patCredentialProvider.getCredential(supabase);
    if (!credential) throw new AppError("validation", "GitHub PATが未登録です");

    const basePath = (project.base_path ?? "").replace(/\/$/, "");
    const fullPath = joinRepoPath(basePath, assetPath);
    if (!fullPath) throw new AppError("validation", "パスが不正です");

    const bytes = await getRawFileBytes(
      credential.token,
      project.repo,
      fullPath,
      branch,
    );
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        // 同一ユーザーの再組版で毎回GitHubへ行かない程度の短命キャッシュ（private 必須）
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
