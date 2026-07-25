"use client";

import { useState } from "react";
import { BookOpenText, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { deleteZennRepo, registerZennRepo } from "@/lib/actions/settings";
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
import { Input } from "@/components/ui/input";

/**
 * Zenn連携セクション（SPEC-zenn-integration §3.1）。
 * 未登録=リポジトリ入力フォーム、登録済み=リポジトリ名＋差し替え＋削除
 * （github-connection.tsx と同型のUI。登録時にサーバーで形式検証＋疎通検証）
 */
export function ZennRepoSettings({ initialRepo }: { initialRepo: string | null }) {
  const [repo, setRepo] = useState(initialRepo);
  const [replacing, setReplacing] = useState(false);

  const showForm = repo === null || replacing;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {repo !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <BookOpenText className="size-4 text-muted-foreground" />
          <span className="flex items-center gap-1.5 text-sm text-card-foreground">
            <CheckCircle2 className="size-4 text-primary" />
            {/* repo はDB由来の表示専用値（リンク化・URL組み立てには使わない） */}
            <span className="font-mono text-xs">{repo}</span> と連携済み
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {!replacing && (
              <Button variant="outline" size="xs" onClick={() => setReplacing(true)}>
                差し替え
              </Button>
            )}
            <DeleteZennRepoButton
              onDeleted={() => {
                setRepo(null);
                setReplacing(false);
              }}
            />
          </div>
        </div>
      )}
      {showForm && (
        <ZennRepoForm
          replacing={repo !== null}
          onCancelReplace={repo !== null ? () => setReplacing(false) : undefined}
          onRegistered={(registered) => {
            setRepo(registered);
            setReplacing(false);
          }}
        />
      )}
    </div>
  );
}

function ZennRepoForm({
  replacing,
  onCancelReplace,
  onRegistered,
}: {
  replacing: boolean;
  onCancelReplace?: () => void;
  onRegistered: (repo: string) => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await registerZennRepo(value);
      if (!result.ok || !result.data) {
        setError(result.ok ? "登録に失敗しました" : result.error.message);
        return;
      }
      setValue("");
      toast(`${result.data.repo} と連携しました`);
      onRegistered(result.data.repo);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="zenn-repo">
        {replacing ? "新しいリポジトリに差し替える" : "Zenn連携リポジトリ（owner/repo）"}
        <Input
          id="zenn-repo"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="owner/zenn-docs"
          required
        />
      </label>
      <p className="text-xs text-muted-foreground">
        ZennのGitHub連携に設定しているリポジトリを owner/repo 形式で入力します。
        GitHub PAT の対象リポジトリにこのリポジトリを含めておいてください（Contents の Read
        and write 権限）。
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2 self-end">
        {onCancelReplace && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancelReplace}>
            キャンセル
          </Button>
        )}
        <Button type="submit" size="sm" disabled={submitting || value.trim() === ""}>
          {submitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
          {submitting ? "接続を確認中…" : "登録する"}
        </Button>
      </div>
    </form>
  );
}

function DeleteZennRepoButton({ onDeleted }: { onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await deleteZennRepo();
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast("Zenn連携リポジトリを削除しました");
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="xs" className="text-destructive">
            削除
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Zenn連携リポジトリを削除しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            Zennへの投稿ができなくなります。再登録すれば元に戻ります（GitHub PATには影響しません）。
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
  );
}
