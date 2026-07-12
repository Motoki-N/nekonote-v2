"use client";

import { toast } from "sonner";

import { restoreNote, deleteNotePermanently } from "@/lib/actions/notes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  excerpt,
  formatDate,
  tagVariant,
  type NoteListItem,
} from "@/components/notes/note-card";

export function TrashCard({ note }: { note: NoteListItem }) {
  async function handleRestore() {
    const result = await restoreNote(note.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast("ノートを復元しました");
  }

  async function handleDelete() {
    const result = await deleteNotePermanently(note.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast("ノートを完全に削除しました");
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="font-medium text-card-foreground">{note.title || "無題"}</span>
        {note.content && (
          <span className="line-clamp-1 text-sm text-muted-foreground">
            {excerpt(note.content)}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {note.tags.map((tag) => (
            <Badge key={tag.id} variant={tagVariant(tag.kind)}>
              {tag.name}
            </Badge>
          ))}
          {note.deletedAt && <span>削除: {formatDate(note.deletedAt)}</span>}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleRestore}>
          復元
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" size="sm">
                完全削除
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ノートを完全に削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                「{note.title || "無題"}」を完全に削除します。この操作は元に戻せません（タグ自体は残ります）。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>完全に削除する</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
