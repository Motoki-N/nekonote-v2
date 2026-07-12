-- ノート機能（SPEC-notes §4）: ごみ箱対応 + templates テーブル + 標準テンプレシード
-- 設計思想: draft-to-clean-model（テンプレートはDB固定スキーマではなくMarkdown雛形として管理する）

-- ========================================
-- ごみ箱（ソフトデリート）
-- ========================================

-- null = 通常、非null = ごみ箱（自動パージはしない。SPEC-notes §3.6）
alter table public.notes add column deleted_at timestamptz;

-- 一覧クエリ（deleted_at is null かつ updated_at 降順）用の部分インデックス。
-- ごみ箱ビューは既存の notes_user_id_idx で足りるため残す
create index notes_user_active_idx
  on public.notes (user_id, updated_at desc)
  where deleted_at is null;

-- ========================================
-- templates（personas と同型のハイブリッド所有モデル）
-- ========================================

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  -- null = 標準同梱（全ユーザーが参照可能）、非null = ユーザー作成
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  content text not null, -- Markdown 雛形本文
  tag_name text, -- 挿入時に自動付与する category タグ名（notes 側で get-or-create）
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 標準同梱行は所有者なし、ユーザー行は所有者必須
  check ((is_default and user_id is null) or (not is_default and user_id is not null))
);

create index templates_user_id_idx on public.templates (user_id);

create trigger set_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

alter table public.templates enable row level security;

-- default privileges（20260712000002）で anon への自動 GRANT は既に無効だが、多層防御として明示
revoke all on public.templates from anon;

create policy "templates_select_default_or_own" on public.templates
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy "templates_insert_own" on public.templates
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "templates_update_own" on public.templates
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "templates_delete_own" on public.templates
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ========================================
-- 標準同梱テンプレート（SPEC-notes §3.5、story-engineering スキル準拠）
-- 雛形は「問いを促す」構成にとどめ、構造の強制はしない（挿入後は自由編集が前提）
-- ========================================

insert into public.templates (user_id, name, content, tag_name, is_default) values
(
  null,
  'コンセプト',
  E'## コンセプト\n\n### もし〜だったら？\n\n（物語の中核となる問いを1文で）\n\n### この「もし」の何が魅力か\n\n- \n\n### 読者への問いかけ（テーマの種）\n\n- \n',
  'コンセプト',
  true
),
(
  null,
  'キャラクター',
  E'## キャラクター\n\n### 名前・役割\n\n（名前 / 主人公・敵役・脇役）\n\n### 1. どんな人物か\n\n（タイプ・特徴・価値観・欠点）\n\n### 2. 何を求めているか\n\n（欲求と目標）\n\n### 3. なぜ求めているか\n\n（動機と必要性）\n\n### 4. 失敗したらどうなるか\n\n（物語を駆動する代償）\n\n### 5. どのように変わるか\n\n（内面的変化のアーク）\n',
  'キャラクター',
  true
),
(
  null,
  'テーマ',
  E'## テーマ\n\n### 物語が語る意味・問いかけ\n\n（この物語を読み終えた読者に何を考えてほしいか）\n\n### テーマが立ち上がる場面のアイデア\n\n- \n\n### 説教にしないための工夫\n\n- \n',
  'テーマ',
  true
),
(
  null,
  '世界観',
  E'## 世界観\n\n### 舞台・時代\n\n（どこで、いつの話か）\n\n### この世界のルール\n\n（現実と違うこと・変わらないこと）\n\n### 社会・文化の空気感\n\n（人々は何を信じ、何を恐れているか）\n\n### 物語に効いてくる設定\n\n- \n',
  '世界観',
  true
);
