-- Issue #328: アトリエのお気に入り☆と原稿配置の記録（SPEC-illustrator §11）
-- 純追加型（既存コードは新列を参照しない）。RLS 変更なし:
-- illustrations_owner_all（20260717000003）が select / update を含む全操作を所有者に限定済み

alter table public.illustrations
  -- お気に入り☆（ギャラリーの絞り込み・エディタのピッカーで使う）
  add column is_favorite boolean not null default false,
  -- 採用⛳: 既定ブランチ（本線）の原稿に載っている。
  -- 既定ブランチへの配置時と、ユーザーが任意に実行する原稿走査（既定ブランチ固定）で付与・解除する
  add column placed_at timestamptz,
  -- 原稿リポジトリへコピーしたパス（images/atelier-<UUID>.<拡張子>）。
  -- 作業ブランチへの配置でも記録する（⛳は付けない）。削除時の警告に使う
  add column placed_image_path text;
