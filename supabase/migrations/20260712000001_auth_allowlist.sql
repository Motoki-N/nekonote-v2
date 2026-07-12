-- SPEC-auth 4: メール許可リスト（一次ゲート: DB）
-- 許可リストを Postgres 設定（DB側の環境変数に相当）として保持し、
-- auth.users への BEFORE INSERT トリガーでリスト外のユーザー作成を拒否する。
-- 許可リスト変更時はこの設定値を UPDATE する（アプリ側 ALLOWED_EMAILS と手動同期）。
--
-- 【運用注意】ALTER DATABASE ... SET は新規接続にのみ反映される。
-- Auth サーバー（GoTrue）が古いプール接続を保持していると設定が NULL のままとなり、
-- フェイルクローズにより許可済みメールでもサインイン拒否される。
-- 適用後にログイン検証を行い、拒否される場合は Supabase ダッシュボードから
-- プロジェクトを再起動（Settings > General > Restart project）して接続を張り直すこと。

alter database postgres set app.allowed_emails = 'motoking55@gmail.com';

create or replace function public.check_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed text[];
begin
  -- 設定未定義時は空リスト＝全拒否（フェイルクローズ）
  allowed := string_to_array(
    replace(lower(coalesce(current_setting('app.allowed_emails', true), '')), ' ', ''),
    ','
  );

  if new.email is null or not (lower(new.email) = any (allowed)) then
    raise exception 'signup not allowed for this email';
  end if;

  return new;
end;
$$;

create trigger check_email_allowlist_before_insert
  before insert on auth.users
  for each row
  execute function public.check_email_allowlist();
