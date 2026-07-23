import Link from "next/link";
import { Download, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { createNote } from "@/lib/actions/notes";
import { Button } from "@/components/ui/button";
import { NoteCard, type NoteListItem } from "@/components/notes/note-card";
import { TrashCard } from "@/components/notes/trash-card";
import { TagFilter } from "@/components/notes/tag-filter";
import { SearchForm } from "@/components/notes/search-form";
import { SortMenu } from "@/components/notes/sort-menu";
import { toSortValue, type SortValue } from "@/components/notes/sort-options";

// ILIKE パターンと PostgREST の or() 構文を壊す文字を除去・エスケープする
function toSearchPattern(q: string): string {
  const cleaned = q.replaceAll(/[,()"\\]/g, "").replaceAll(/[%_]/g, (m) => `\\${m}`);
  return `%${cleaned}%`;
}

// ソート値 → Supabase の order() 引数
const SORT_ORDERS: Record<SortValue, { column: string; ascending: boolean }> = {
  updated_desc: { column: "updated_at", ascending: false },
  updated_asc: { column: "updated_at", ascending: true },
  created_desc: { column: "created_at", ascending: false },
  created_asc: { column: "created_at", ascending: true },
};

type NoteRow = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  deleted_at: string | null;
  note_tags: { tags: { id: string; name: string; kind: string } | null }[];
};

function toListItem(row: NoteRow): NoteListItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    tags: row.note_tags.flatMap((nt) => (nt.tags ? [nt.tags] : [])),
  };
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tags?: string; view?: string; sort?: string }>;
}) {
  const { q, tags: tagsParam, view, sort: sortParam } = await searchParams;
  const sort = toSortValue(sortParam);
  const isTrash = view === "trash";
  const supabase = await createClient();

  // 絞り込みチップ用の全タグ
  const { data: allTags } = await supabase
    .from("tags")
    .select("id, name, kind")
    .order("kind")
    .order("name");

  const selectedTagIds = (tagsParam ?? "").split(",").filter(Boolean);

  // タグAND絞り込み: 選択タグごとの note_id 集合を交差させる（ソロ利用規模のためJS交差で十分）
  let tagFilteredNoteIds: string[] | null = null;
  if (!isTrash && selectedTagIds.length > 0) {
    const { data: links } = await supabase
      .from("note_tags")
      .select("note_id, tag_id")
      .in("tag_id", selectedTagIds);
    const byTag = new Map<string, Set<string>>();
    for (const link of links ?? []) {
      const set = byTag.get(link.tag_id) ?? new Set<string>();
      set.add(link.note_id);
      byTag.set(link.tag_id, set);
    }
    tagFilteredNoteIds = selectedTagIds.reduce<string[] | null>((acc, tagId) => {
      const ids = [...(byTag.get(tagId) ?? new Set<string>())];
      if (acc === null) return ids;
      const set = new Set(ids);
      return acc.filter((id) => set.has(id));
    }, null);
  }

  let notes: NoteListItem[] = [];
  if (tagFilteredNoteIds === null || tagFilteredNoteIds.length > 0) {
    let query = supabase
      .from("notes")
      .select("id, title, content, updated_at, deleted_at, note_tags(tags(id, name, kind))");
    if (isTrash) {
      query = query.not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    } else {
      const order = SORT_ORDERS[sort];
      query = query.is("deleted_at", null).order(order.column, { ascending: order.ascending });
      if (q) {
        const pattern = toSearchPattern(q);
        query = query.or(`title.ilike.${pattern},content.ilike.${pattern}`);
      }
      if (tagFilteredNoteIds) {
        query = query.in("id", tagFilteredNoteIds);
      }
    }
    const { data } = await query;
    notes = (data ?? []).map(toListItem);
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">
          {isTrash ? "ごみ箱" : "ノート"}
        </h1>
        <div className="flex items-center gap-2">
          {isTrash ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/notes">ノートへ戻る</Link>}
            />
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Markdownエクスポート"
                title="Markdownエクスポート"
                nativeButton={false}
                render={
                  // download 属性は付けない: エラー時（429等）にJSONがファイル保存されるのを避け、
                  // 成功時は Content-Disposition: attachment でダウンロードになる
                  <a href="/api/notes/export">
                    <Download />
                  </a>
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="ごみ箱"
                nativeButton={false}
                render={
                  <Link href="/notes?view=trash">
                    <Trash2 />
                  </Link>
                }
              />
              <form action={createNote}>
                <Button type="submit" size="sm">
                  新規ノート
                </Button>
              </form>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        {!isTrash && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchForm q={q} tagsParam={tagsParam} sort={sort} />
              </div>
              <SortMenu sort={sort} q={q} tagsParam={tagsParam} />
            </div>
            <TagFilter tags={allTags ?? []} selectedTagIds={selectedTagIds} q={q} sort={sort} />
          </>
        )}

        {notes.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {isTrash
              ? "ごみ箱は空です"
              : q || selectedTagIds.length > 0
                ? "条件に合うノートがありません"
                : "まだノートがありません。「新規ノート」から書きはじめましょう"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) =>
              isTrash ? (
                <TrashCard key={note.id} note={note} />
              ) : (
                <NoteCard key={note.id} note={note} />
              ),
            )}
          </ul>
        )}
      </main>
    </div>
  );
}
