-- Issue #335: アトリエの参照画像を複数枚に（SPEC-illustrator §13）
-- 参照関係を illustrations.reference_illustration_id（単一）から中間テーブルへ移し、旧列は削除する。
-- 旧列を select する旧コードはこの適用で壊れるため、本番適用はデプロイと同時に行う

create table public.illustration_references (
  illustration_id uuid not null references public.illustrations (id) on delete cascade,
  -- 参照元が消えても、参照していたイラストの行は残る（参照関係の行だけが消える。
  -- 旧列の on delete set null と同じ結果）
  reference_illustration_id uuid not null references public.illustrations (id) on delete cascade,
  -- 画像モデルへの添付順（上限4枚。lib/schemas/illustration.ts の REFERENCE_IMAGES_MAX と対応）
  position smallint not null check (position between 0 and 3),
  primary key (illustration_id, reference_illustration_id),
  unique (illustration_id, position),
  check (illustration_id <> reference_illustration_id)
);

-- 被参照数の集計（ギャラリーの削除警告）と参照元削除時の cascade 用
create index illustration_references_reference_idx
  on public.illustration_references (reference_illustration_id);

-- ========================================
-- RLS
-- ========================================

alter table public.illustration_references enable row level security;

-- default privileges（20260712000002）で anon への自動 GRANT は既に無効だが、多層防御として明示
revoke all on public.illustration_references from anon;

-- 両端のイラストが自分のものであること。illustrations は別テーブルなので RLS の再帰は起きない
-- （旧列では再帰回避のため外していた参照先の所有検証を、DB 側で掛け直せる。20260717000003）
create policy "illustration_references_owner_all" on public.illustration_references
  for all to authenticated
  using (
    exists (
      select 1 from public.illustrations i
      where i.id = illustration_id and i.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.illustrations r
      where r.id = reference_illustration_id and r.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.illustrations i
      where i.id = illustration_id and i.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.illustrations r
      where r.id = reference_illustration_id and r.user_id = (select auth.uid())
    )
  );

-- ========================================
-- 既存の参照関係を移行してから旧列を削除
-- ========================================

insert into public.illustration_references (illustration_id, reference_illustration_id, position)
select id, reference_illustration_id, 0
from public.illustrations
where reference_illustration_id is not null;

drop index if exists public.illustrations_reference_idx;
alter table public.illustrations drop column reference_illustration_id;
