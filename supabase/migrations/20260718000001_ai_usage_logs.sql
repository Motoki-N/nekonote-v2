-- Issue #45: AI使用量計測（第1弾: トークン数のみ。金額換算・履歴要約はスコープ外）
-- AI呼び出し1回＝1行の追記専用ログ。表示は設定画面の直近30日サマリーのみ

create table public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 機能種別は lib/rate-limit のキーと同じ語彙（lib/ai/usage.ts の AiUsageFeature と対応）
  feature text not null check (
    feature in ('chat', 'review', 'proofread', 'illustration-propose', 'illustration-generate')
  ),
  provider text not null check (provider in ('anthropic', 'openai', 'google')),
  model_id text not null,
  -- プロバイダが返さない場合がある（画像生成等）ため nullable
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

-- サマリー集計（user_id は RLS、created_at は期間絞り込み）用
create index ai_usage_logs_user_created_idx
  on public.ai_usage_logs (user_id, created_at desc);

-- ========================================
-- RLS: 追記専用ログ＝所有者の select / insert のみ（update / delete ポリシーは作らない）
-- 注意: authenticated は自分名義の行を PostgREST 直挿入できる（表示専用の統計なので許容）。
-- 将来この値をクォータ制御・課金判断に使う場合は insert を revoke しサーバー専用経路に切り替えること
-- ========================================

alter table public.ai_usage_logs enable row level security;

-- default privileges（20260712000002）で anon への自動 GRANT は既に無効だが、多層防御として明示
revoke all on public.ai_usage_logs from anon;

create policy "ai_usage_logs_select_own" on public.ai_usage_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "ai_usage_logs_insert_own" on public.ai_usage_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ========================================
-- 直近N日のサマリー集計（設定画面用）
-- 集計はDB側で行う（PostgREST の行数上限・転送量を避ける）。
-- security invoker ＝ 実行ユーザーの RLS がそのまま効き、自分の行しか集計されない
-- ========================================

create function public.ai_usage_summary(days integer)
returns table (
  feature text,
  provider text,
  model_id text,
  call_count bigint,
  input_tokens bigint,
  output_tokens bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.feature,
    l.provider,
    l.model_id,
    count(*) as call_count,
    coalesce(sum(l.input_tokens), 0) as input_tokens,
    coalesce(sum(l.output_tokens), 0) as output_tokens
  from public.ai_usage_logs l
  where l.created_at >= now() - make_interval(days => days)
  group by l.feature, l.provider, l.model_id
  order by l.feature, l.provider, l.model_id;
$$;

-- PostgREST の /rest/v1/rpc/ 露出は authenticated のみに絞る（lint 0028/0029 対応の流儀）
revoke execute on function public.ai_usage_summary(integer) from public, anon;
