-- ノートのバージョン履歴（Issue #111）:
-- 自動保存時に「上書き前の行」を時間ベース間引き（10分間隔。判定はアプリ側 lib/actions/notes.ts）で
-- スナップショットする。毎保存1バージョンはレコード爆発するため不採用（#38 の設計確認済み）。
-- 版は不変データのため updated_at・更新トリガーは持たない

create table public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  content text not null default '', -- スナップショット時点のMarkdown
  created_at timestamptz not null default now()
);

-- 履歴一覧（note_id ごとの created_at 降順）と最新版の間引き判定に使う
create index note_versions_note_created_idx on public.note_versions (note_id, created_at desc);

alter table public.note_versions enable row level security;

-- 所有者直付けポリシー。INSERT/UPDATE は note_id の所有確認も課す
-- （note_tags_owner_all と同じ「参照先の所有確認」モデル。他人の note_id を指す版の作成を拒否する）
-- （anon への GRANT は core_schema の alter default privileges で遮断済み）
create policy "note_versions_owner_all" on public.note_versions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = (select auth.uid())
    )
  );
