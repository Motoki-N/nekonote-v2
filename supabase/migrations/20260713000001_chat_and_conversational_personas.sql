-- AI掘り下げ支援（SPEC-ai-deep-dive §4）: chat_threads / chat_messages + conversational ペルソナ標準シード
-- 汎用設計: note_id null = ノートに紐づかない会話（R2の独立チャット画面で使用）

-- ========================================
-- chat_threads
-- ========================================

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- ノートと運命共同体: 完全削除で cascade（ごみ箱中はUI側で非表示にするだけ）
  note_id uuid references public.notes (id) on delete cascade,
  -- 担当ペルソナ。削除されても履歴は残す
  persona_id uuid references public.personas (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ノートごとに1スレッド（R2のノート非紐づけ会話は複数可）
create unique index chat_threads_user_note_uniq
  on public.chat_threads (user_id, note_id)
  where note_id is not null;

create index chat_threads_user_id_idx on public.chat_threads (user_id);
create index chat_threads_note_id_idx on public.chat_threads (note_id);
create index chat_threads_persona_id_idx on public.chat_threads (persona_id);

create trigger set_updated_at before update on public.chat_threads
  for each row execute function public.set_updated_at();

-- ========================================
-- chat_messages（不変レコード。updated_at なし）
-- ========================================

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index chat_messages_thread_created_idx
  on public.chat_messages (thread_id, created_at);

-- ========================================
-- RLS
-- ========================================

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

-- default privileges（20260712000002）で anon への自動 GRANT は既に無効だが、多層防御として明示
revoke all on public.chat_threads, public.chat_messages from anon;

-- 所有者のみ＋参照先（自分のノート / 標準or自分のペルソナ）の所有検証つき
-- （note_tags 等の既存方針と同じく、他人のリソースへの紐づけを INSERT/UPDATE 時点で遮断する）
create policy "chat_threads_owner_all" on public.chat_threads
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and (note_id is null or exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = (select auth.uid())
    ))
    and (persona_id is null or exists (
      select 1 from public.personas p
      where p.id = persona_id and (p.user_id is null or p.user_id = (select auth.uid()))
    ))
  )
  with check (
    user_id = (select auth.uid())
    and (note_id is null or exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = (select auth.uid())
    ))
    and (persona_id is null or exists (
      select 1 from public.personas p
      where p.id = persona_id and (p.user_id is null or p.user_id = (select auth.uid()))
    ))
  );

-- メッセージは親スレッド経由の owner-only。
-- update / delete ポリシーは作らない（メッセージは不変。会話リセットはスレッドごと削除 → cascade）
create policy "chat_messages_select_owner_via_thread" on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads t
    where t.id = thread_id and t.user_id = (select auth.uid())
  ));

create policy "chat_messages_insert_owner_via_thread" on public.chat_messages
  for insert to authenticated
  with check (exists (
    select 1 from public.chat_threads t
    where t.id = thread_id and t.user_id = (select auth.uid())
  ));

-- ========================================
-- conversational ペルソナ標準シード（review-profiles スキル準拠）
-- 固定UUIDで採番し、コードから安定参照できるようにする（lib/ai/personas 定数と対応）
-- ========================================

insert into public.personas (id, user_id, name, description, ai_capability, reference_scope, persona_type, is_default) values
(
  'e5a1c0de-0001-4000-8000-000000000001',
  null,
  'アシスタント',
  E'あなたは小説家を支える有能なアシスタントです。\n- 口調: 丁寧で手際がよく、少し親しみのある「です・ます」調。前置きは最小限\n- 役割: 書き留められたネタの整理と掘り下げ。要点を短くまとめ、発想が広がる具体的な質問を投げかける\n- スタンス: 答えや設定を勝手に決めて与えない。作者自身が答えを見つけられるよう、選択肢や視点の提示にとどめる\n- 名称のネタ出しを頼まれたときだけは、具体案を複数挙げてよい',
  'medium',
  'chat_only',
  'conversational',
  true
),
(
  'e5a1c0de-0002-4000-8000-000000000002',
  null,
  '喫茶店のマスター',
  E'あなたは小説家が通う喫茶店のマスターです。カウンター越しの壁打ち相手を務めます。\n- 口調: 落ち着いた常体まじりの柔らかい話し言葉。急かさず、否定しない\n- 役割: 客（作者）の話をまず受け止めて要約し、「それで、その人はどうしてそうしたんだい？」のように一歩深い質問を一つずつ返す\n- スタンス: 助言よりも傾聴。会話の締めくくりには、それまでの話を短いメモにまとめて手渡す',
  'medium',
  'chat_only',
  'conversational',
  true
);
