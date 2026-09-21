"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DraftEntry } from "@/components/editor/hooks/use-draft-store";

/** 既定のコミットメッセージ（選択数に追従する。ユーザーが編集したら追従をやめる） */
const defaultMessageFor = (count: number) =>
  `執筆: ${count}件の章を更新（ネコノテAI 縦書きエディタ）`;

const fileNameOf = (path: string) => path.split("/").pop() ?? path;

/**
 * 未コミットの章をまとめて1コミットにするダイアログ（Issue #255-2）。
 * 一日の終わりなど作業の節目で、複数章の進捗を1コミットにまとめるための操作。
 * フォームは閉じるとアンマウントされるため、開くたびに初期状態へ戻る
 */
export function BulkCommitDialog({
  open,
  branch,
  drafts,
  committing,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  /** コミット先ブランチ（保存ダイアログと同じく明示する） */
  branch: string;
  /** 待避の一覧。null は読み込み中 */
  drafts: DraftEntry[] | null;
  committing: boolean;
  onConfirm: (paths: string[], message: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !committing && onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>まとめてコミット</DialogTitle>
          <DialogDescription>
            未コミットの章をまとめてブランチ「{branch}」に1コミットします
          </DialogDescription>
        </DialogHeader>
        {drafts === null ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            未コミットの章はありません
          </p>
        ) : (
          <BulkCommitForm
            drafts={drafts}
            committing={committing}
            onConfirm={onConfirm}
          />
        )}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={committing}
            onClick={() => onOpenChange(false)}
          >
            キャンセル
          </Button>
          {drafts !== null && drafts.length > 0 && (
            <Button
              type="submit"
              form="editor-bulk-commit-form"
              size="sm"
              disabled={committing}
            >
              {committing && (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              )}
              コミット
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkCommitForm({
  drafts,
  committing,
  onConfirm,
}: {
  drafts: DraftEntry[];
  committing: boolean;
  onConfirm: (paths: string[], message: string) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(drafts.map((draft) => draft.path)),
  );
  const [message, setMessage] = useState(() =>
    defaultMessageFor(drafts.length),
  );
  // ユーザーが手で直したメッセージを、選択の増減で上書きしない
  const [edited, setEdited] = useState(false);

  const toggle = (path: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      if (!edited) setMessage(defaultMessageFor(next.size));
      return next;
    });
  };

  const canSubmit = selected.size > 0 && message.trim().length > 0;

  return (
    <form
      id="editor-bulk-commit-form"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || committing) return;
        onConfirm(
          drafts
            .map((draft) => draft.path)
            .filter((path) => selected.has(path)),
          message.trim(),
        );
      }}
    >
      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {drafts.map((draft) => (
          <li key={draft.path} className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-3.5 shrink-0 accent-primary"
              checked={selected.has(draft.path)}
              disabled={committing}
              aria-label={`${fileNameOf(draft.path)}をコミットする`}
              onChange={(event) => toggle(draft.path, event.target.checked)}
            />
            <span
              className="min-w-0 flex-1 truncate text-sm text-foreground"
              title={draft.path}
            >
              {fileNameOf(draft.path)}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {new Date(draft.updatedAt).toLocaleString("ja-JP")}
            </span>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1.5 text-sm text-foreground">
        コミットメッセージ
        <Input
          value={message}
          onChange={(event) => {
            setEdited(true);
            setMessage(event.target.value);
          }}
          maxLength={200}
          disabled={committing}
        />
      </label>
      {selected.size === 0 && (
        <p className="text-xs text-muted-foreground">
          コミットする章を1つ以上選んでください
        </p>
      )}
    </form>
  );
}
