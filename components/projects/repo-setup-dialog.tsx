"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setupManuscriptRepo } from "@/lib/actions/repo-setup";
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

/** リポジトリ名から出力ファイル名（slug）の初期値を作る（小文字英数字とハイフンに正規化） */
function toSlug(repoName: string): string {
  return repoName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/**
 * 原稿リポジトリの初期セットアップダイアログ（SPEC-repo-setup §3.2）。
 * repo の初回設定直後に編集ダイアログから開かれる。スキップ（閉じる）しても
 * repo / base_path の保存自体は完了している
 */
export function RepoSetupDialog({
  open,
  onOpenChange,
  projectId,
  defaultTitle,
  repoName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultTitle: string;
  /** owner/ を除いたリポジトリ名（slug の初期値に使う） */
  repoName: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle);
  const [author, setAuthor] = useState("");
  const [slug, setSlug] = useState(toSlug(repoName));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await setupManuscriptRepo(projectId, {
        title: title.trim(),
        author: author.trim(),
        slug: slug.trim(),
      });
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "セットアップに失敗しました" : result.error.message,
        );
        return;
      }
      toast.success(
        result.data.backupDir
          ? `セットアップが完了しました（既存ファイルは ${result.data.backupDir}/ へ退避）`
          : "セットアップが完了しました",
      );
      onOpenChange(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>原稿リポジトリの初期セットアップ</DialogTitle>
          <DialogDescription>
            テンプレート（章ファイル・書籍設定・入稿ビルド）を作品情報に合わせてリポジトリへ展開します。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            作品タイトル（必須）
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            著者名（必須）
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="例: ペンネーム"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            出力ファイル名（入稿PDFなどの名前）
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              pattern="[a-z0-9][a-z0-9-]*"
              title="小文字英数字とハイフン（例: ningyo-no-uta）"
              required
            />
          </label>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>
              リポジトリに既にファイルがある場合、全ファイルを backup-日時/
              へ退避してから展開します
            </li>
            <li>
              完了時に原稿フォルダ（base_path）は空（リポジトリルート）に設定されます
            </li>
            <li>
              PATに Contents と Workflows の Read and write 権限が必要です
            </li>
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              スキップ
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "セットアップ中…" : "セットアップを実行"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
