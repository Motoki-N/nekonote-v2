-- SPEC-zenn-integration §6: Zenn連携リポジトリ（owner/repo）。
-- 記事本文はDBに持たない（原稿リポジトリと同じ思想）。
-- 検証はアプリ層 repoSchema（登録時・使用時の二重）。RLSは既存の本人のみポリシーがそのまま効く
alter table public.user_settings add column zenn_repo text;

comment on column public.user_settings.zenn_repo is
  'Zenn連携リポジトリ（owner/repo）。記事本文はGitHubが実体でDBには持たない';
