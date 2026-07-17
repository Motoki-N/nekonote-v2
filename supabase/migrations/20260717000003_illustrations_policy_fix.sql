-- security-reviewer 指摘の修正（Issue #13 PR①）
-- H-1: illustrations_owner_all がポリシー内で illustrations 自身をサブクエリ参照しており、
--      PostgreSQL の RLS 再帰検出（infinite recursion detected）で全クエリが失敗する。
--      自己参照チェックを外し、reference_illustration_id の所有検証は
--      API 側の RLS 越し取得（他人のイラストは not found）で担保する（SPEC-illustrator §5.3）
-- L-1: バケットに MIME・サイズ制限がなかった（png のみ・10MB 上限に制限）

drop policy "illustrations_owner_all" on public.illustrations;

-- 所有者のみ＋project_id の所有検証（projects は別テーブルなので再帰しない）
create policy "illustrations_owner_all" on public.illustrations
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects pr
      where pr.id = project_id and pr.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects pr
      where pr.id = project_id and pr.user_id = (select auth.uid())
    )
  );

-- 直アップロード（アプリ非経由）の濫用防止: png のみ・10MB 上限
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/png']
where id = 'illustrations';
