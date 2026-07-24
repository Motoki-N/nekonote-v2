import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // 静的アセット以外の全リクエストを対象にする（SPEC-auth 3.3）。
  // /api/ 配下は画像拡張子つきURL（/api/attachments/{uuid}.png 等）でも
  // 許可リスト二次ゲートを通す（Issue #35 security-reviewer L-1）
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    "/api/:path*",
  ],
};
