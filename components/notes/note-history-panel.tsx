"use client";

import { useEffect, useState } from "react";
import { History, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  listNoteVersions,
  restoreNoteVersion,
  type NoteVersion,
} from "@/lib/actions/notes";
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
import { Button } from "@/components/ui/button";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** バージョン履歴パネル。lg以上は右サイドパネル、lg未満はボトムシート（DeepDivePanel と同配置） */
export function NoteHistoryPanel({
  noteId,
  flushSave,
  onRestore,
  onClose,
}: {
  noteId: string;
  /** 復元前に未保存分を確定させる（パネル表示中の入力が復元前スナップショットに含まれるように） */
  flushSave: () => Promise<void>;
  /** 復元成功時にエディタへ反映させる */
  onRestore: (version: { title: string; content: string }) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listNoteVersions(noteId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setVersions(result.data);
      else if (!result.ok) setLoadError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const selected = versions?.find((v) => v.id === selectedId) ?? null;

  async function handleRestore(version: NoteVersion) {
    setRestoring(true);
    await flushSave();
    const result = await restoreNoteVersion(noteId, version.id);
    setRestoring(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    onRestore({ title: version.title, content: version.content });
    toast("この版に復元しました");
    onClose();
  }

  return (
    <aside
      aria-label="バージョン履歴パネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <History className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">バージョン履歴</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="パネルを閉じる"
          className="ml-auto text-muted-foreground"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      {loadError ? (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-destructive">
          {loadError}
        </div>
      ) : versions === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2
            className="size-5 animate-spin text-muted-foreground"
            aria-label="読み込み中"
          />
        </div>
      ) : versions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          履歴はまだありません
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ul className="max-h-48 shrink-0 overflow-y-auto border-b border-border lg:max-h-64">
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  aria-pressed={version.id === selectedId}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                    version.id === selectedId ? "bg-muted" : ""
                  }`}
                  onClick={() => setSelectedId(version.id)}
                >
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dateFormat.format(new Date(version.created_at))}
                  </span>
                  <span className="truncate">{version.title || "無題"}</span>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {selected.content || "（本文なし）"}
                </p>
              </div>
              <div className="border-t border-border p-3">
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button size="sm" className="w-full" disabled={restoring}>
                        この版に復元
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        この版に復元しますか？
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        現在の内容は復元前に新しい版として保存されるため、履歴から戻せます。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleRestore(selected)}
                      >
                        復元する
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
              版を選択するとプレビューが表示されます
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
