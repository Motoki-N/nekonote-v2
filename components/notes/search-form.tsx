import { Input } from "@/components/ui/input";

/** タイトル＋本文の部分一致検索。GETフォームで searchParams に反映する（タグ選択は維持） */
export function SearchForm({ q, tagsParam }: { q?: string; tagsParam?: string }) {
  return (
    <form action="/notes" method="get" role="search">
      {tagsParam && <input type="hidden" name="tags" value={tagsParam} />}
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
