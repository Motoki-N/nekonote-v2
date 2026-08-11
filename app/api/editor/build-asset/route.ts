import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { AppError, errorResponse } from "@/lib/errors";
import {
  fetchProjectGitFields,
  resolveRepoGit,
} from "@/lib/git/project-context";
import { getReleaseAssetLocation } from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// 入稿PDF（Releaseアセット）のダウンロード（SPEC-vertical-editor-phase3 §8-9）。
// private リポジトリのアセットはブラウザから直接開けないため、認可のうえ
// GitHub が発行する一時的な署名付きURLへリダイレクトする（本体はプロキシしない——
// Vercel のレスポンスサイズ制限の回避。security-reviewer 対象）。
// アセットIDはリポジトリ配下のエンドポイントで解決されるため、他リポジトリのIDを
// 指定しても 404 になる（プロジェクトの repo にスコープされる）

const uuidSchema = z.uuid();
const assetIdSchema = z.coerce.number().int().positive();

export async function GET(request: NextRequest) {
  try {
    const projectId = uuidSchema.parse(
      request.nextUrl.searchParams.get("projectId"),
    );
    const assetId = assetIdSchema.parse(
      request.nextUrl.searchParams.get("assetId"),
    );

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    enforceRateLimit(user.id, "editor-build-asset", {
      perMinute: 10,
      perDay: 200,
    });

    // RLS越しの取得＝所有確認を兼ねる（画像プロキシと同じ作法）
    const project = await fetchProjectGitFields(supabase, projectId);
    const { repo, token } = await resolveRepoGit(supabase, project);

    const location = await getReleaseAssetLocation(token, repo, assetId);
    // 署名付きURLは短命。キャッシュさせずその場のダウンロードだけに使う
    return NextResponse.redirect(location, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
