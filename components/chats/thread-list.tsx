"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteThread, renameThread, type ConsultThreadListItem } from "@/lib/actions/chat";
import { formatDate } from "@/components/notes/note-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

/** スレッドの表示タイトル（null = 無題。SPEC-chat-thread-list §3.2） */
function displayTitle(thread: ConsultThreadListItem): string {
  return thread.title ?? "無題の会話";
}

/** ダッシュボード相談スレッドの一覧（/chats）。行クリックで相談パネルの該当スレッドへ */
export function ThreadList({ threads }: { threads: ConsultThreadListItem[] }) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8">
        <p className="text-sm text-card-foreground">まだ会話がありません。</p>
        <p className="text-sm text-muted-foreground">
          相談はダッシュボードの「相談する」から始められます。
        </p>
        <Button nativeButton={false} render={<Link href="/">ダッシュボードへ</Link>} />
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {threads.map((thread) => (
        <ThreadRow key={thread.id} thread={thread} />
      ))}
    </ul>
  );
}

function ThreadRow({ thread }: { thread: ConsultThreadListItem }) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function handleDelete() {
    const result = await deleteThread(thread.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast(`「${displayTitle(thread)}」を削除しました`);
    router.refresh();
  }

  return (
    <li className="group relative rounded-lg border border-border bg-card transition-colors hover:bg-muted/50">
      <Link href={`/?consult=${thread.id}`} className="block p-4">
        <div className="flex flex-col gap-1.5">
          <span className="pr-8 font-medium text-card-foreground">{displayTitle(thread)}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">{thread.personaName ?? "（削除済みペルソナ）"}</Badge>
            <span>{formatDate(thread.updatedAt)}</span>
          </span>
        </div>
      </Link>

      <div className="absolute top-3 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`「${displayTitle(thread)}」のメニュー`}
                className="text-muted-foreground"
              >
                <MoreVertical />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pencil data-icon="inline-start" />
              リネーム
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 data-icon="inline-start" />
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <RenameDialog thread={thread} open={renameOpen} onOpenChange={setRenameOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{displayTitle(thread)}」を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この会話の履歴がすべて削除されます。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** リネームダイアログ（1〜100字・trim。サーバー側でも同条件を再検証） */
function RenameDialog({
  thread,
  open,
  onOpenChange,
}: {
  thread: ConsultThreadListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(thread.title ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (submitting || trimmed === "" || trimmed.length > 100) return;
    setSubmitting(true);
    try {
      const result = await renameThread(thread.id, trimmed);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onOpenChange(false);
      toast("タイトルを変更しました");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>会話のタイトルを変更</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            aria-label="タイトル"
            placeholder="タイトルを入力"
            required
          />
          <DialogFooter>
            <Button type="submit" disabled={submitting || title.trim() === ""}>
              保存する
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
