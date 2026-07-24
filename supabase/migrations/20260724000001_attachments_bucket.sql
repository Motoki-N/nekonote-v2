-- Issue #35: ノート・企画書エディタの画像・ファイル添付
-- 非公開バケット 'attachments' を新設する。実体の参照は認証付きAPI
-- /api/attachments/{ファイル名} が署名URLへリダイレクトする（Markdown本文には
-- 失効しない安定URLだけを保存する）。パスは {user_id}/{uuid}.{拡張子}。
-- メタデータテーブルは持たない（Markdown本文が参照の実体。illustrations と異なり
-- 行管理する一覧UIがないため、最小構成とする）

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760, -- 10MB
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- 所有者のみ（第1階層フォルダ = 自分のuid）。illustrations と同型。
-- update は不要（添付は差し替えない。消して入れ直す）

create policy "attachments_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
