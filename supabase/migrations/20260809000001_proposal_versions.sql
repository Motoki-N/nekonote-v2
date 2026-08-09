-- 企画書のバージョン履歴（Issue #64）:
-- 自動保存時に「上書き前の本文」を時間ベース間引き（10分間隔。判定はアプリ側 lib/actions/projects.ts）で
-- スナップショットするのに加え、企画書レビュー実行時にも必ず1版残す（kind='review'。
-- 「レビュー反復の前後で差分を表示したい」という動機に応えるため）。
-- 版は本文（content）のみ対象（構造化4項目は短い入力欄で変遷を追う価値が薄い）。
-- 版は不変データのため updated_at・更新トリガーは持たない（note_versions と同型）

create table public.proposal_versions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null default '', -- スナップショット時点の本文Markdown
  kind text not null default 'autosave' check (kind in ('autosave', 'review')),
  created_at timestamptz not null default now()
);

-- 履歴一覧（proposal_id ごとの created_at 降順）と最新版の間引き判定に使う
create index proposal_versions_proposal_created_idx on public.proposal_versions (proposal_id, created_at desc);

alter table public.proposal_versions enable row level security;

-- 所有者直付けポリシー。INSERT/UPDATE は proposal_id の所有確認（proposals→projects 経由）も課す
-- （note_versions_owner_all と同じ「参照先の所有確認」モデル。他人の proposal_id を指す版の作成を拒否する）
-- （anon への GRANT は core_schema の alter default privileges で遮断済み）
create policy "proposal_versions_owner_all" on public.proposal_versions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.proposals pr
      join public.projects p on p.id = pr.project_id
      where pr.id = proposal_id and p.user_id = (select auth.uid())
    )
  );
