import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * サービスロールキーで RLS を越えるクライアント。
 * cron 等、ユーザーセッションを介さないバックグラウンド処理専用（Issue #51）。
 * 通常のリクエスト処理では lib/supabase/server.ts を使うこと
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
