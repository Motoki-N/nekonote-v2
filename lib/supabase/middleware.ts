import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** 認証不要の公開ルート（SPEC-auth 3.3: 例外は /login と /auth/callback のみ） */
function isPublicRoute(pathname: string): boolean {
  return pathname === "/login" || pathname === "/auth/callback";
}

/**
 * ユーザーセッションではなく Bearer トークン（CRON_SECRET）で認証するルート
 * （SPEC-auth 3.3 / Issue #51）。Vercel Cron はSupabaseセッションCookieを持たないため、
 * ここでセッションチェックをスキップし、認証自体はルートハンドラ側で行う
 */
function isCronRoute(pathname: string): boolean {
  return pathname.startsWith("/api/cron/");
}

/** ALLOWED_EMAILS（カンマ区切り）との照合。未設定・リスト外は拒否（フェイルクローズ） */
function isEmailAllowed(email: string | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/**
 * 全リクエストでセッション Cookie を更新し、未認証・許可リスト外を /login へ誘導する。
 * トークンリフレッシュをユーザー操作に依存させないための中核（SPEC-auth 3.1）
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  if (isCronRoute(request.nextUrl.pathname)) return supabaseResponse;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname, search } = request.nextUrl;

  // 環境変数未設定時はフェイルクローズ（公開ルート以外は設定エラーとして /login へ）
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isPublicRoute(pathname)) return supabaseResponse;
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("error", "config");
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() がトークン検証とリフレッシュを行う（getSession は使わない）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // リダイレクト時も、この間に更新されたセッション Cookie を持ち越すためのヘルパー
  const redirectTo = (url: URL) => {
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  // 許可リスト二次ゲート（一次ゲートは DB トリガー。SPEC-auth 4.2 の多層防御）
  if (user && !isEmailAllowed(user.email)) {
    await supabase.auth.signOut();
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("error", "denied");
    return redirectTo(redirectUrl);
  }

  if (!user && !isPublicRoute(pathname)) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("returnTo", pathname + search);
    return redirectTo(redirectUrl);
  }

  // ログイン済みで /login を開いた場合はトップへ
  if (user && pathname === "/login") {
    return redirectTo(new URL("/", request.url));
  }

  return supabaseResponse;
}
