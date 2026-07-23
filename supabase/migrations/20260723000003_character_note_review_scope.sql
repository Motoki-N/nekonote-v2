-- キャラクターレビューの「ノート1枚単位」対応（Issue #47）。
-- target_phase='character' の既存標準プロファイルをそのまま流用し続ける
-- （CHECK制約変更なし・プロファイル複製なし）。「企画書一式が対象か、特定ノート1枚に
-- 絞ったレビューか」はセッションの付帯情報として review_sessions に持たせる
-- （AIのコンテキスト組み立てとUIの双方が構造として参照するため。null=従来通り企画書一式）

alter table public.review_sessions
  add column note_id uuid references public.notes (id) on delete cascade;

comment on column public.review_sessions.note_id is
  'null=企画書一式が対象（従来通り）。非null=target_phase=''character''のセッションを特定ノート1枚に絞り込む（Issue #47）';

create index review_sessions_note_id_idx on public.review_sessions (note_id);

-- 所有確認ポリシーにノート側の所有確認を追加（note_id が非null の場合のみ検証）
alter policy "review_sessions_owner_via_project" on public.review_sessions
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
    and (
      note_id is null
      or exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
    and (
      note_id is null
      or exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
    )
  );
