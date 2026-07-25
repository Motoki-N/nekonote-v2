-- 執筆ジャンル・執筆目的の基盤（Issue #94・SPEC-genre）:
-- AIプロンプトとジャンル別テンプレ選択が構造として参照するためカラム化する
-- （draft-to-clean-model 判断基準2。テンプレ本文はコード内定数のまま）。
-- 既存行は default で novel（小説）扱い。
-- RLS 変更なし（proposals_owner_via_project がカラム追加後もそのまま有効）。

alter table public.proposals
  add column writing_genre text not null default 'novel'
    check (writing_genre in ('novel', 'tech_book', 'other'));

alter table public.proposals
  add column purpose text;
