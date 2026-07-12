import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** returnTo はサイト内パスのみ許可する（オープンリダイレクト防止） */
function sanitizeReturnTo(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

/**
 * Google 認証後のコールバック（SPEC-auth 3.2）。
 * 認可コードをセッションに交換し、元のページへ戻す。
 * 許可リスト外は DB トリガーでユーザー作成自体が失敗し、code ではなく error が返る
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${returnTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=signin_failed`);
}
