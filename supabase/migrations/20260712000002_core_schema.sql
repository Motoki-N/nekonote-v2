-- コアスキーマ全体（16テーブル）
-- ER図Draft（docs/ネコノテAI_第二期_実装計画.md §3）に基づく。
-- 設計思想:
--   - draft-to-clean-model: notes + tags が中核。characters/chapters 等の構造化テーブルは作らない
--   - review-profiles: ペルソナ（誰が）とレビュープロファイル（どんな観点で）を分離
-- 列挙値は text + CHECK 制約で管理し、lib/schemas/enums.ts の定数と対応させる。
-- 標準ペルソナ・プロファイルのシードデータは Sprint 2 で投入する（本マイグレーションは定義のみ）。

-- ========================================
-- 共通: updated_at 自動更新トリガー関数
-- ========================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ========================================
-- 構想フェーズ（手帳→プロットモデル）
-- ========================================

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  content text not null default '', -- Markdown 生データ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_id_idx on public.notes (user_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  -- working_title = 仮タイトル（作品の卵の名前）。プロジェクト確定前のノート群を緩く束ねる
  kind text not null check (kind in ('category', 'working_title')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table public.note_tags (
  note_id uuid not null references public.notes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

create index note_tags_tag_id_idx on public.note_tags (tag_id);

-- ========================================
-- 企画フェーズ
-- ========================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  status text not null default 'planning'
    check (status in ('planning', 'writing', 'editing', 'completed')),
  target_pages integer,
  deadline date,
  event_name text,
  -- 原稿モノレポ運用: リポジトリ名 + リポジトリ内パスのペアで原稿の置き場所を指す
  repo text,
  base_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  -- 1プロジェクト1企画書
  project_id uuid not null unique references public.projects (id) on delete cascade,
  genre text,
  target_audience text,
  content text not null default '', -- Markdown（コンセプト/キャラ/テーマ）
  -- レビューゲート: 担当編集レビューを経て approved になるまで反復
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 企画書＝レポートの表紙、紐づくノート群＝本文（参照で紐づけ、コピーしない）
create table public.proposal_notes (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (proposal_id, note_id)
);

create index proposal_notes_note_id_idx on public.proposal_notes (note_id);

-- ========================================
-- 設計フェーズ（4部構成・ビートボード）
-- ========================================

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 4部構成のレーン
  part text not null check (part in ('setup', 'response', 'attack', 'resolution')),
  -- 5転換点アンカー（アンカーでないカードは null）
  anchor text check (anchor in ('pp1', 'pinch1', 'midpoint', 'pinch2', 'pp2')),
  order_index integer not null default 0, -- ボード上の並び順（AIレビューに渡す構成順序）
  title text not null default '',
  content text not null default '', -- 状況/出来事/葛藤の自由記述
  emotion_start text check (emotion_start in ('plus', 'minus')),
  emotion_end text check (emotion_end in ('plus', 'minus')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scenes_project_id_order_index_idx on public.scenes (project_id, order_index);

-- ========================================
-- AIレビュー（ペルソナ制）
-- ========================================

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  -- null = 標準同梱（全ユーザーが参照可能）、非null = ユーザー作成
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  description text not null, -- 性格・口調・スタンス（プロンプトに反映）
  -- ai_model_settings で実モデルにマッピングする
  ai_capability text not null check (ai_capability in ('high', 'medium', 'low')),
  reference_scope text not null
    check (reference_scope in ('all', 'manuscript_only', 'chat_only', 'manuscript_plus_target')),
  -- conversational はレビュープロファイルを持たず description のみで動作する
  persona_type text not null check (persona_type in ('reviewer', 'conversational')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 標準同梱行は所有者なし、ユーザー行は所有者必須
  check ((is_default and user_id is null) or (not is_default and user_id is not null))
);

create index personas_user_id_idx on public.personas (user_id);

create table public.review_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade, -- personas と同じ所有モデル
  name text not null,
  target_phase text not null
    check (target_phase in ('proposal', 'character', 'structure', 'scene', 'proofreading')),
  prompt_template text not null, -- 編集可能なプロンプト本文（フレームワーク差し替え可能）
  default_persona_id uuid references public.personas (id) on delete set null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_default and user_id is null) or (not is_default and user_id is not null))
);

create index review_profiles_user_id_idx on public.review_profiles (user_id);
create index review_profiles_default_persona_id_idx on public.review_profiles (default_persona_id);

create table public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- プロファイル/ペルソナが削除されても履歴は残す
  review_profile_id uuid references public.review_profiles (id) on delete set null,
  persona_id uuid references public.personas (id) on delete set null, -- 実際に起用したペルソナ
  target_ref text, -- レビュー対象（proposal id / scene id / 原稿パス）
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_sessions_project_id_idx on public.review_sessions (project_id);
create index review_sessions_review_profile_id_idx on public.review_sessions (review_profile_id);
create index review_sessions_persona_id_idx on public.review_sessions (persona_id);

create table public.review_feedbacks (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references public.review_sessions (id) on delete cascade,
  content text not null, -- AIからのフィードバック
  user_response text, -- ユーザーの返答・改稿メモ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_feedbacks_review_session_id_idx on public.review_feedbacks (review_session_id);

-- ========================================
-- 校正・進捗（GitHub連携）
-- ========================================

create table public.manuscript_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  file_path text not null,
  last_reviewed_commit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, file_path)
);

create table public.revision_suggestions (
  id uuid primary key default gen_random_uuid(),
  manuscript_link_id uuid not null references public.manuscript_links (id) on delete cascade,
  -- 文単位（誤字・表記揺れ）/ シーン単位（構成・不足の指摘）
  granularity text not null check (granularity in ('sentence', 'scene')),
  original_text text not null default '',
  suggested_text text not null default '',
  reason text,
  -- 保留（on_hold）はコミット後も残り、後から受け入れ/拒否できる
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'on_hold')),
  committed_sha text, -- まとめてコミット後に記録
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index revision_suggestions_manuscript_link_id_idx
  on public.revision_suggestions (manuscript_link_id);

create table public.writing_progress (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  total_chars integer not null default 0, -- Git取得原稿から集計
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, date)
);

-- ========================================
-- 設定系
-- ========================================

-- 能力レベル → 実モデルのマッピング（モデル世代交代に設定変更のみで追従する）
create table public.ai_model_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capability text not null check (capability in ('high', 'medium', 'low')),
  provider text not null check (provider in ('anthropic', 'openai', 'google')),
  model_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, capability)
);

-- 端末間で同期すべきUI状態のサーバー側保持（要求仕様 4.2。localStorage 頼みにしない）
-- GitHub PAT 列は GitHub連携SPEC 策定時（Sprint 4）に追加マイグレーションで定義する
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  selected_project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_settings_selected_project_id_idx
  on public.user_settings (selected_project_id);

-- ========================================
-- updated_at トリガー一括作成（junction テーブルは updated_at なしのため除外）
-- ========================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'notes', 'tags', 'projects', 'proposals', 'scenes',
    'personas', 'review_profiles', 'review_sessions', 'review_feedbacks',
    'manuscript_links', 'revision_suggestions', 'writing_progress',
    'ai_model_settings', 'user_settings'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ========================================
-- RLS
-- 方針: 全テーブル有効。ポリシーは authenticated のみ（anon はポリシーなし＝全拒否）。
-- さらに多層防御として anon の権限自体を剥奪する（本アプリに未認証で読める公開データはない）
-- ========================================

alter table public.notes enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;
alter table public.projects enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_notes enable row level security;
alter table public.scenes enable row level security;
alter table public.personas enable row level security;
alter table public.review_profiles enable row level security;
alter table public.review_sessions enable row level security;
alter table public.review_feedbacks enable row level security;
alter table public.manuscript_links enable row level security;
alter table public.revision_suggestions enable row level security;
alter table public.writing_progress enable row level security;
alter table public.ai_model_settings enable row level security;
alter table public.user_settings enable row level security;

revoke all on
  public.notes, public.tags, public.note_tags,
  public.projects, public.proposals, public.proposal_notes, public.scenes,
  public.personas, public.review_profiles, public.review_sessions, public.review_feedbacks,
  public.manuscript_links, public.revision_suggestions, public.writing_progress,
  public.ai_model_settings, public.user_settings
from anon;

-- 将来のマイグレーションで作成するテーブルにも anon の自動 GRANT を及ぼさない
alter default privileges in schema public revoke all on tables from anon;

-- ---- 所有者直付けテーブル ----

create policy "notes_owner_all" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "tags_owner_all" on public.tags
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "projects_owner_all" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "ai_model_settings_owner_all" on public.ai_model_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_settings_owner_all" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---- projects 配下 ----

create policy "proposals_owner_via_project" on public.proposals
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

create policy "scenes_owner_via_project" on public.scenes
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

create policy "review_sessions_owner_via_project" on public.review_sessions
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

create policy "manuscript_links_owner_via_project" on public.manuscript_links
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

create policy "writing_progress_owner_via_project" on public.writing_progress
  for all to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

-- ---- 孫テーブル（親をたどって所有確認） ----

-- note_tags: ノートとタグの両方を所有していること
create policy "note_tags_owner_all" on public.note_tags
  for all to authenticated
  using (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = (select auth.uid()))
  );

-- proposal_notes: 企画書（プロジェクト経由）とノートの両方を所有していること
create policy "proposal_notes_owner_all" on public.proposal_notes
  for all to authenticated
  using (
    exists (
      select 1 from public.proposals pr
      join public.projects p on p.id = pr.project_id
      where pr.id = proposal_id and p.user_id = (select auth.uid())
    )
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
  )
  with check (
    exists (
      select 1 from public.proposals pr
      join public.projects p on p.id = pr.project_id
      where pr.id = proposal_id and p.user_id = (select auth.uid())
    )
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
  );

create policy "review_feedbacks_owner_via_session" on public.review_feedbacks
  for all to authenticated
  using (exists (
    select 1 from public.review_sessions s
    join public.projects p on p.id = s.project_id
    where s.id = review_session_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.review_sessions s
    join public.projects p on p.id = s.project_id
    where s.id = review_session_id and p.user_id = (select auth.uid())
  ));

create policy "revision_suggestions_owner_via_link" on public.revision_suggestions
  for all to authenticated
  using (exists (
    select 1 from public.manuscript_links l
    join public.projects p on p.id = l.project_id
    where l.id = manuscript_link_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.manuscript_links l
    join public.projects p on p.id = l.project_id
    where l.id = manuscript_link_id and p.user_id = (select auth.uid())
  ));

-- ---- personas / review_profiles（標準同梱 + ユーザー所有のハイブリッド） ----

create policy "personas_select_default_or_own" on public.personas
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy "personas_insert_own" on public.personas
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "personas_update_own" on public.personas
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "personas_delete_own" on public.personas
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "review_profiles_select_default_or_own" on public.review_profiles
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy "review_profiles_insert_own" on public.review_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "review_profiles_update_own" on public.review_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "review_profiles_delete_own" on public.review_profiles
  for delete to authenticated
  using (user_id = (select auth.uid()));
