-- Issue #13 / SPEC-illustrator §5.1: AIイラストレーター基盤
-- persona_type 'illustrator'＋capability 'image'（CHECK 張り替え）＋ペルソナシード
-- ＋illustrations テーブル＋Storage 非公開バケット 'illustrations'

-- ========================================
-- personas.persona_type に 'illustrator' を追加
-- 既存コードは 'reviewer' / 'conversational' の明示フィルタのみ＝新型が既存経路に漏れることはない
-- ========================================

alter table public.personas drop constraint personas_persona_type_check;
alter table public.personas add constraint personas_persona_type_check
  check (persona_type in ('reviewer', 'conversational', 'illustrator'));

-- ========================================
-- ai_model_settings.capability に 'image' を追加
-- （personas.ai_capability の CHECK は変更しない。'image' はモデル設定専用の能力枠）
-- ========================================

alter table public.ai_model_settings drop constraint ai_model_settings_capability_check;
alter table public.ai_model_settings add constraint ai_model_settings_capability_check
  check (capability in ('high', 'medium', 'low', 'image'));

-- ========================================
-- イラストレーターペルソナ標準シード
-- 既存シードと同じ流儀: user_id null / is_default true / 固定UUID（lib/ai/personas.ts と対応）
-- ai_capability 'high' は第1段階（案出しLLM）用。画像生成自体は capability 'image' のモデルが担う
-- ========================================

insert into public.personas (id, user_id, name, description, ai_capability, reference_scope, persona_type, is_default) values
(
  'e5a1c0de-0007-4000-8000-000000000007',
  null,
  'イラストレーター',
  E'あなたは小説の装画・挿絵を手がけるイラストレーターです。作品を読み込み、その世界を絵にして作家に届けます。\n- 口調: 穏やかで職人肌の「です・ます」調。絵の意図（構図・光・色・視線誘導）を言葉で説明できる\n- 役割: 表紙イラスト・文中の挿絵・キャラクターイラスト・コンセプトアートの案出しと作画。原稿や設定資料から場面・人物・世界観を正確に読み取り、作家のリクエスト（カラー/モノクロ・構図・描いてほしい対象）に合った複数の案を提案する\n- スタンス: 原作への忠実さを最優先する。本文に書かれた外見・情景の描写と矛盾する絵は描かない。書かれていない部分は作品のトーンから補い、解釈が分かれるところは案の説明で明示する',
  'high',
  'all',
  'illustrator',
  true
);

-- ========================================
-- illustrations: 生成イラストのメタデータ（画像の実体は Storage）
-- 行が存在する時点で画像がある（失敗した生成は保存しない）＝ status 列は持たない
-- ========================================

create table public.illustrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('cover', 'insert', 'character', 'concept')),
  -- ユーザー編集可能なタイトル。初期値はサーバーが「プロジェクト名＋種別」で付与（重複可）
  title text not null,
  -- 依頼内容（カラー/モノクロ・アスペクト比・自由記述・挿絵の対象ファイル等。zodで検証）
  request jsonb not null,
  -- 画像モデルに渡した最終プロンプト。ギャラリーの説明文・追加依頼時の引き継ぎ元を兼ねる
  prompt text not null,
  -- 参照画像（編集依頼・キャラ一貫性）。参照元が消えても行は残す
  reference_illustration_id uuid references public.illustrations (id) on delete set null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index illustrations_project_created_idx
  on public.illustrations (project_id, created_at desc);
create index illustrations_user_id_idx on public.illustrations (user_id);
create index illustrations_reference_idx
  on public.illustrations (reference_illustration_id);

create trigger set_updated_at before update on public.illustrations
  for each row execute function public.set_updated_at();

-- ========================================
-- RLS
-- ========================================

alter table public.illustrations enable row level security;

-- default privileges（20260712000002）で anon への自動 GRANT は既に無効だが、多層防御として明示
revoke all on public.illustrations from anon;

-- 所有者のみ＋参照先（自分のプロジェクト / 自分のイラスト）の所有検証つき
-- （chat_threads と同じ方針: 他人のリソースへの紐づけを INSERT/UPDATE 時点で遮断する）
create policy "illustrations_owner_all" on public.illustrations
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects pr
      where pr.id = project_id and pr.user_id = (select auth.uid())
    )
    and (reference_illustration_id is null or exists (
      select 1 from public.illustrations ref
      where ref.id = reference_illustration_id and ref.user_id = (select auth.uid())
    ))
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects pr
      where pr.id = project_id and pr.user_id = (select auth.uid())
    )
    and (reference_illustration_id is null or exists (
      select 1 from public.illustrations ref
      where ref.id = reference_illustration_id and ref.user_id = (select auth.uid())
    ))
  );

-- ========================================
-- Storage: 非公開バケット 'illustrations'
-- パスは {user_id}/{illustration_id}.png。表示は短寿命の署名URL（SPEC §6）
-- ========================================

insert into storage.buckets (id, name, public)
values ('illustrations', 'illustrations', false)
on conflict (id) do nothing;

-- 所有者のみ（第1階層フォルダ = 自分のuid）。update は不要（画像は差し替えない）
create policy "illustrations_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'illustrations'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "illustrations_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'illustrations'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "illustrations_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'illustrations'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
