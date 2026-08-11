import { Input } from "@/components/ui/input";
import { DEFAULT_SORT, type SortValue } from "@/components/notes/sort-options";

/** タイトル＋本文の部分一致検索。GETフォームで searchParams に反映する（タグ選択・ソートは維持） */
export function SearchForm({
  q,
  tagsParam,
  sort,
}: {
  q?: string;
  tagsParam?: string;
  sort?: SortValue;
}) {
  return (
    <form action="/notes" method="get" role="search">
      {tagsParam && <input type="hidden" name="tags" value={tagsParam} />}
      {sort && sort !== DEFAULT_SORT && (
        <input type="hidden" name="sort" value={sort} />
      )}
      <Input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder="ノートを検索…"
        aria-label="ノートを検索"
      />
    </form>
  );
}
