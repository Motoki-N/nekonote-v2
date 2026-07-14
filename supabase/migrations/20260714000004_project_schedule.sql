-- SPEC-schedule-and-memo-tools §4.1: 構造化スケジュール保存
-- アシスタントが確定保存する執筆スケジュール（1プロジェクト1本・丸ごと上書き）。
-- 構造の検証は zod（lib/schemas/schedule.ts）で行い、DB側は器のみ持つ。
-- RLS・cascade は projects のものがそのまま効く（新テーブルは作らない＝手帳→浄書の判断基準）
alter table public.projects add column schedule jsonb;
