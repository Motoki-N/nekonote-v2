-- スレッド一覧UI（SPEC-chat-thread-list §4.1）:
-- ダッシュボード相談をペルソナごとに複数スレッド化する

-- SPEC-conversational-personas §4.1 の予告どおり「ペルソナごと1本」の保証を外す
drop index public.chat_threads_user_persona_dashboard_uniq;

-- スレッドタイトル（null = 無題。最初の user 発言から自動設定）
alter table public.chat_threads add column title text;

-- 既存ダッシュボードスレッド（note_id null）のバックフィル:
-- 最初の user メッセージの最初の非空行 → 先頭のMarkdown記号除去 → 50字
-- （lib/chat-title.ts の chatTitleFrom と同じ整形）
with first_user_msg as (
  select distinct on (thread_id) thread_id, content
  from public.chat_messages
  where role = 'user'
  order by thread_id, created_at
)
update public.chat_threads t
set title = nullif(left(btrim(regexp_replace(
      (regexp_match(m.content, '([^\n]*\S[^\n]*)'))[1],
      '^[#>*+[:space:]-]+', '')), 50), '')
from first_user_msg m
where m.thread_id = t.id and t.note_id is null;
