-- SPEC-auth 4: メール許可リスト（一次ゲート: DB）
-- 許可リストを private スキーマのテーブルに保持し、
-- auth.users への BEFORE INSERT トリガーでリスト外のユーザー作成を拒否する。
-- 許可リスト変更時はこのテーブルを UPDATE する（アプリ側 ALLOWED_EMAILS と手動同期）。
--
-- ※ 当初は ALTER DATABASE ... SET（GUC方式）の設計だったが、ホスト版 Supabase では
--    postgres ロールに ALTER DATABASE 権限がなく（所有者は supabase_admin）実行不可のため、
--    テーブル方式に変更した。トリガーが毎回テーブルを参照するので、変更は即時反映される。

create schema if not exists private;

create table private.auth_allowlist (
  email text primary key
);

-- API（PostgREST）経由のアクセスを禁止する。private スキーマは公開スキーマ外だが多層防御として明示
revoke all on schema private from anon, authenticated;
revoke all on private.auth_allowlist from anon, authenticated;

-- 許可するメールアドレスを投入する。空のままだとトリガーが全サインアップを拒否する
-- （フェイルクローズ）ため、このプロジェクトを利用する場合は自分のメールに書き換えて
-- 適用するか、適用後に SQL Editor 等から手動で insert すること。
-- insert into private.auth_allowlist (email) values ('you@example.com');

create or replace function public.check_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- テーブルが空なら全拒否（フェイルクローズ）
  if new.email is null or not exists (
    select 1
    from private.auth_allowlist a
    where lower(a.email) = lower(new.email)
  ) then
    raise exception 'signup not allowed for this email';
  end if;

  return new;
end;
$$;

create trigger check_email_allowlist_before_insert
  before insert on auth.users
  for each row
  execute function public.check_email_allowlist();
