"use client";

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

/**
 * コミット前の確認ダイアログ（SPEC-zenn-integration §3.3 誤爆防止）。
 * published の状態を毎回明示し、公開時は強調表示する
 */
export function PublishDialog({
  open,
  onOpenChange,
  repo,
  path,
  published,
  isUpdate,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repo: string;
  path: string;
  published: boolean;
  /** true = 再コミット（更新）、false = 新規作成 */
  isUpdate: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isUpdate ? "記事を再コミットしますか？" : "記事を投稿しますか？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            コミット先:{" "}
            <span className="font-mono text-xs">
              {repo}/{path}
            </span>
            （デフォルトブランチへ直接コミット）
          </AlertDialogDescription>
        </AlertDialogHeader>
        {published ? (
          <p className="text-sm font-semibold text-destructive">
            公開記事として投稿します。コミットと同時にZennで公開されます（published:
            true）
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            下書きとして投稿します。Zennには公開されません（published: false）
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            variant={published ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {isUpdate
              ? "再コミットする"
              : published
                ? "公開して投稿する"
                : "下書きとして投稿する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
