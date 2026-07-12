"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { trashNote, restoreNote } from "@/lib/actions/notes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type NoteListItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: { id: string; name: string; kind: string }[];
};

/** Markdown記法をおおまかに落として本文冒頭の抜粋を作る */
export function excerpt(markdown: string, length = 100): string {
  return markdown
    .replaceAll(/^#{1,6}\s+/gm, "")
    .replaceAll(/[*_`>]/g, "")
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/^-{3,}\s*$/gm, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** タグ種類で見た目を分ける: 仮タイトル=secondary（塗り）、カテゴリ=outline */
export function tagVariant(kind: string): "secondary" | "outline" {
  return kind === "working_title" ? "secondary" : "outline";
}

export function NoteCard({ note }: { note: NoteListItem }) {
  async function handleTrash() {
    const result = await trashNote(note.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast("ごみ箱に移動しました", {
      action: {
        label: "元に戻す",
        onClick: async () => {
          const restored = await restoreNote(note.id);
          if (!restored.ok) toast.error(restored.error.message);
        },
      },
    });
  }

  return (
    <li className="group relative rounded-lg border border-border bg-card transition-colors hover:bg-muted/50">
      <Link href={`/notes/${note.id}`} className="block p-4">
        <div className="flex flex-col gap-1.5">
          <span className="pr-8 font-medium text-card-foreground">
            {note.title || "無題"}
          </span>
          {note.content && (
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {excerpt(note.content)}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {note.tags.map((tag) => (
              <Badge key={tag.id} variant={tagVariant(tag.kind)}>
                {tag.name}
              </Badge>
            ))}
            <span>{formatDate(note.updatedAt)}</span>
          </span>
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="ごみ箱に移動"
        className="absolute top-3 right-3 text-muted-foreground opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
        onClick={handleTrash}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
