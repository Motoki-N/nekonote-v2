-- 感情の変化を増減で表す（Issue #205）: emotion_start/emotion_end による
-- シーン間の二重管理をやめ、「そのシーンを通して感情がどれだけ動いたか」を表す
-- 単一値 emotion_delta へ移行する。
-- あわせて感情の起伏のレンジを ±5 から ±9（0〜9の10段階）へ拡張するため、
-- 変化量の CHECK 制約も -9〜+9 とする。
--
-- 既存データ: 起点・終点が両方そろっているシーンのみ差分へ変換する。片方だけの
-- シーンは変化量が確定しないため未設定（null）のままとする（設計確認済み）。
-- 旧レンジ（-5〜+5）の差分は最大 ±10 になりうるため、新レンジへ丸めてから書き込む

alter table public.scenes add column emotion_delta smallint;

update public.scenes
  set emotion_delta = greatest(-9, least(9, emotion_end - emotion_start))
  where emotion_start is not null and emotion_end is not null;

alter table public.scenes drop column emotion_start;
alter table public.scenes drop column emotion_end;

alter table public.scenes
  add constraint scenes_emotion_delta_check check (emotion_delta between -9 and 9);
