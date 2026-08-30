-- 章マーカーの導入（Issue #222・SPEC-board-chapters §3.1）。
-- 章は独立テーブルではなく、scenes の並びの中の「区切り行」として表す。
-- 章とシーンの所属は保存せず、正準順序上の位置から導出する（直前の章マーカー行がその章）。

alter table public.scenes
  add column kind text not null default 'scene'
    check (kind in ('scene', 'chapter'));

-- 目次ボードの既存章カードを章マーカーへ（行の移動・再作成はしない）
update public.scenes set kind = 'chapter' where part = 'chapter';

-- part='chapter'（目次レーン）は章マーカー専用
alter table public.scenes
  add constraint scenes_chapter_part_check
  check (kind = 'chapter' or part <> 'chapter');

-- 逆引き用（SPEC-manuscript-bridge §4.4・§5.5）
create index scenes_project_manuscript_path_idx
  on public.scenes (project_id, manuscript_path)
  where manuscript_path is not null;

-- RLS 変更なし。既存の scenes_owner_via_project（20260712000002）がそのまま効く
