-- Issue #5: Supabase Security Advisor 対応①
-- public.check_email_allowlist() は SECURITY DEFINER のトリガー関数だが、
-- public スキーマにあるため PostgREST の /rest/v1/rpc/ に露出し、
-- デフォルト権限（PUBLIC への EXECUTE 付与）により anon / authenticated から実行可能と検出された
-- （lint 0028 / 0029）。
--
-- トリガー関数の EXECUTE 権限チェックはトリガー作成時のみで発火時には行われないため、
-- revoke しても auth.users への BEFORE INSERT トリガー（許可リスト一次ゲート）の動作には影響しない。

revoke execute on function public.check_email_allowlist() from public, anon, authenticated;
