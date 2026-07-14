-- 対話型ペルソナ（SPEC-conversational-personas §4.1）:
-- ダッシュボード相談はペルソナごとに1スレッド（note_id null 行）。
-- get-or-create の同時実行を 23505 で捕捉できるようにする（note スレッド側の
-- chat_threads_user_note_uniq と同じ流儀）
create unique index chat_threads_user_persona_dashboard_uniq
  on public.chat_threads (user_id, persona_id)
  where note_id is null;
