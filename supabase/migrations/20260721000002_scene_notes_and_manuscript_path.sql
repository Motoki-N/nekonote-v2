-- シーンカードへのノート・原稿ファイル紐づけ（Issue #56）:
-- 構成（シーン）と執筆（章ファイル）・設定資料（ノート）を対応づける。
-- ノートは企画書（proposal_notes）と同型の参照モデル（草稿→浄書思想: コピーせず参照で紐づける）。
-- 原稿ファイルは1シーン=1ファイルの列で持つ（設計確認済み。画面が導線として構造参照する）

-- ========================================
-- scenes.manuscript_path
-- ========================================

-- 紐づく原稿ファイル（GitHubリポジトリ内の相対パス）。null = 未紐づけ。
-- パス形式の検証はアプリ側（manuscriptFilePathSchema）。エディタが開く際に base_path 検証を再実施する
alter table public.scenes
  add column manuscript_path text;

-- ========================================
-- scene_notes（シーン⇄ノートの多対多）
-- ========================================

create table public.scene_notes (
  scene_id uuid not null references public.scenes (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (scene_id, note_id)
);

create index scene_notes_note_id_idx on public.scene_notes (note_id);

alter table public.scene_notes enable row level security;

-- scene_notes: シーン（プロジェクト経由）とノートの両方を所有していること（proposal_notes と同型）
create policy "scene_notes_owner_all" on public.scene_notes
  for all to authenticated
  using (
    exists (
      select 1 from public.scenes s
      join public.projects p on p.id = s.project_id
      where s.id = scene_id and p.user_id = (select auth.uid())
    )
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
  )
  with check (
    exists (
      select 1 from public.scenes s
      join public.projects p on p.id = s.project_id
      where s.id = scene_id and p.user_id = (select auth.uid())
    )
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
  );
