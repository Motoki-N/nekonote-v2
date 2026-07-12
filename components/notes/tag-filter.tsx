import Link from "next/link";

import { Badge } from "@/components/ui/badge";

type Tag = { id: string; name: string; kind: string };

function buildHref(q: string | undefined, tagIds: string[]): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tagIds.length > 0) params.set("tags", tagIds.join(","));
  const qs = params.toString();
  return qs ? `/notes?${qs}` : "/notes";
}

/** タグチップによる絞り込み（複数選択はAND）。選択状態はURLの searchParams が正 */
export function TagFilter({
  tags,
  selectedTagIds,
  q,
}: {
  tags: Tag[];
  selectedTagIds: string[];
  q?: string;
}) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => {
        const selected = selectedTagIds.includes(tag.id);
        const nextIds = selected
          ? selectedTagIds.filter((id) => id !== tag.id)
          : [...selectedTagIds, tag.id];
        return (
          <Badge
            key={tag.id}
            variant={
              selected ? "default" : tag.kind === "working_title" ? "secondary" : "outline"
            }
            render={
              <Link href={buildHref(q, nextIds)}>
                {tag.kind === "working_title" ? `《${tag.name}》` : tag.name}
              </Link>
            }
          />
        );
      })}
      {selectedTagIds.length > 0 && (
        <Link
          href={buildHref(q, [])}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          絞り込み解除
        </Link>
      )}
    </div>
  );
}
