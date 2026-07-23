-- Issue #104: 参照画像のアップロード
-- 外部画像を参照用素材としてアップロードし、ギャラリーから参照画像に使えるようにする。
-- アップロード画像は illustrations の1行（kind 'reference'）として保存する＝
-- 既存の参照（reference_illustration_id）・署名URL・削除フローをそのまま流用する。
-- 'reference' は保存専用の種別であり、生成APIの依頼種別には追加しない（zod側で遮断）

alter table public.illustrations drop constraint illustrations_kind_check;
alter table public.illustrations add constraint illustrations_kind_check
  check (kind in ('cover', 'insert', 'character', 'concept', 'reference'));
