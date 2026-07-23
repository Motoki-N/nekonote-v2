-- 感情の強度・数値化（Issue #55）: emotion_start/emotion_end を plus/minus の2値から
-- -5〜+5の11段階整数（0=中立、null=未設定）へ拡張する。
-- 順序: 旧CHECK制約を外す → 文字列のまま数値相当にUPDATE → 型をsmallintへ変換 → 新CHECK制約を追加
-- （制約を外す前に数値文字列を書き込むとCHECK違反になるため、この順序が必須）

alter table public.scenes drop constraint scenes_emotion_start_check;
alter table public.scenes drop constraint scenes_emotion_end_check;

-- 既存データ移行: plus→+3, minus→-3（強度は中間的な値として割り当てる。設計確認済み）
update public.scenes set emotion_start = case emotion_start
  when 'plus' then '3' when 'minus' then '-3' else emotion_start end;
update public.scenes set emotion_end = case emotion_end
  when 'plus' then '3' when 'minus' then '-3' else emotion_end end;

alter table public.scenes alter column emotion_start type smallint using emotion_start::smallint;
alter table public.scenes alter column emotion_end type smallint using emotion_end::smallint;

alter table public.scenes add constraint scenes_emotion_start_check check (emotion_start between -5 and 5);
alter table public.scenes add constraint scenes_emotion_end_check check (emotion_end between -5 and 5);
