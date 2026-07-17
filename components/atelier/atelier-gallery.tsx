"use client";

import { useState } from "react";
import { Check, Download, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteIllustration, updateIllustrationTitle } from "@/lib/actions/illustrations";
import { ILLUSTRATION_KIND_LABEL, type IllustrationItem } from "@/lib/schemas/illustration";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" });

/** 署名URLのパス部から拡張子を取り出す（ダウンロードのファイル名用） */
function extensionOf(signedUrl: string): string {
  const match = /\.(\w+)$/.exec(new URL(signedUrl).pathname);
  return match ? match[1] : "png";
}

/** 署名URLはクロスオリジンで download 属性が効かないため、blob 経由で保存する */
async function downloadImage(item: IllustrationItem): Promise<void> {
  const res = await fetch(item.signedUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${item.title}.${extensionOf(item.signedUrl)}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * ギャラリー（SPEC-illustrator §4.4）。
 * グリッド表示＋タイトルのインライン編集＋拡大表示（プロンプト=説明文）＋
 * ダウンロード・削除（被参照は警告）・参照画像にして依頼
 */
export function AtelierGallery({
  items,
  error,
  onSetReference,
  onDeleted,
  onTitleChanged,
}: {
  /** null = 読み込み中 */
  items: IllustrationItem[] | null;
  error: string | null;
  onSetReference: (item: IllustrationItem) => void;
  onDeleted: (id: string) => void;
  onTitleChanged: (id: string, title: string) => void;
}) {
  const [zoomed, setZoomed] = useState<IllustrationItem | null>(null);
  const [deleting, setDeleting] = useState<IllustrationItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSaveTitle(item: IllustrationItem) {
    const title = editingTitle.trim();
    if (title === "" || title === item.title) {
      setEditingId(null);
      return;
    }
    setBusyId(item.id);
    try {
      const result = await updateIllustrationTitle(item.id, title);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onTitleChanged(item.id, title);
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(item: IllustrationItem) {
    setBusyId(item.id);
    try {
      const result = await deleteIllustration(item.id);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onDeleted(item.id);
      toast("イラストを削除しました");
    } finally {
      setBusyId(null);
      setDeleting(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold text-card-foreground">ギャラリー</h2>

      {error ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : items === null ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" />
          読み込み中…
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col gap-2 py-6 text-center">
          <p className="text-sm text-card-foreground">まだイラストがありません。</p>
          <p className="text-sm text-muted-foreground">
            イラストレーターが原稿と設定資料を読み、表紙・挿絵・キャラクター・コンセプトアートを
            描きます。左のフォームから最初の依頼をどうぞ。
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-md border border-border p-2"
            >
              <button
                type="button"
                onClick={() => setZoomed(item)}
                aria-label={`${item.title} を拡大表示`}
                className="overflow-hidden rounded"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 署名URL（短寿命・外部最適化不可）のため素の img を使う */}
                <img
                  src={item.signedUrl}
                  alt={item.title}
                  loading="lazy"
                  className="h-44 w-full object-cover transition-transform hover:scale-105"
                />
              </button>

              <div className="flex items-center gap-1">
                {editingId === item.id ? (
                  <>
                    <Input
                      value={editingTitle}
                      autoFocus
                      disabled={busyId === item.id}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveTitle(item);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-7 flex-1 text-sm"
                      aria-label="タイトルを編集"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="タイトルを保存"
                      disabled={busyId === item.id}
                      onClick={() => void handleSaveTitle(item)}
                    >
                      <Check />
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-card-foreground">
                      {item.title}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${item.title} のタイトルを編集`}
                      className="text-muted-foreground"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditingTitle(item.title);
                      }}
                    >
                      <Pencil />
                    </Button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary">{ILLUSTRATION_KIND_LABEL[item.kind]}</Badge>
                <span className="text-xs text-muted-foreground">
                  {dateFormat.format(new Date(item.createdAt))}
                </span>
                <div className="ml-auto flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${item.title} をダウンロード`}
                    className="text-muted-foreground"
                    onClick={() => {
                      void downloadImage(item).catch(() =>
                        toast.error("ダウンロードに失敗しました"),
                      );
                    }}
                  >
                    <Download />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${item.title} を削除`}
                    className="text-muted-foreground"
                    disabled={busyId === item.id}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <Button size="sm" variant="outline" onClick={() => onSetReference(item)}>
                参照画像にして依頼
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 拡大表示: プロンプトを説明文として添える（SPEC §4.4） */}
      <Dialog open={zoomed !== null} onOpenChange={(open) => !open && setZoomed(null)}>
        <DialogContent className="sm:max-w-2xl">
          {zoomed && (
            <>
              <DialogHeader>
                <DialogTitle>{zoomed.title}</DialogTitle>
                <DialogDescription>
                  {ILLUSTRATION_KIND_LABEL[zoomed.kind]}・
                  {dateFormat.format(new Date(zoomed.createdAt))}
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element -- 署名URLのため素の img を使う */}
              <img
                src={zoomed.signedUrl}
                alt={zoomed.title}
                className="max-h-[60vh] w-full rounded object-contain"
              />
              <div className="max-h-32 overflow-y-auto rounded-md bg-muted/50 p-2">
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{zoomed.prompt}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 削除確認: 被参照なら警告を添える（SPEC §2） */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>イラストを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.title}」を完全に削除します。この操作は取り消せません。
              {deleting && deleting.referencedCount > 0 && (
                <>
                  <br />
                  このイラストは他の{deleting.referencedCount}
                  枚の参照元になっています（削除しても参照した画像は残ります）。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void handleDelete(deleting)}
              disabled={busyId !== null}
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
