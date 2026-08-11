// ノート一覧のソート定義。server / client 双方から参照するため "use client" を付けない

export const SORT_OPTIONS = [
  { value: "updated_desc", label: "更新が新しい順" },
  { value: "updated_asc", label: "更新が古い順" },
  { value: "created_desc", label: "作成が新しい順" },
  { value: "created_asc", label: "作成が古い順" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];

export const DEFAULT_SORT: SortValue = "updated_desc";

export function toSortValue(sort: string | undefined): SortValue {
  return SORT_OPTIONS.some((o) => o.value === sort)
    ? (sort as SortValue)
    : DEFAULT_SORT;
}
