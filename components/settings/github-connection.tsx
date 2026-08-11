"use client";

import { useState } from "react";
import { CheckCircle2, GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { deleteGithubPat, registerGithubPat } from "@/lib/actions/settings";
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
 * GitHub連携セクション（SPEC-proofreading §3.1）。
 * 未登録=PAT入力フォーム、登録済み=接続状態＋差し替え＋削除。
 * 登録済みPATの値は表示しない（マスク表示もしない。存在と接続先ユーザー名のみ）
 */
export function GithubConnection({
  initialConnected,
  initialUsername,
}: {
  initialConnected: boolean;
  initialUsername: string | null;
}) {
  const [connected, setConnected] = useState(initialConnected);
  const [username, setUsername] = useState(initialUsername);
  const [replacing, setReplacing] = useState(false);

  const showForm = !connected || replacing;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {connected && (
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="size-4 text-muted-foreground" />
          <span className="flex items-center gap-1.5 text-sm text-card-foreground">
            <CheckCircle2 className="size-4 text-primary" />
            {/* username はDB由来の表示専用値（リンク化・URL組み立てには使わない） */}
            {username ? `@${username} として接続済み` : "接続済み"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {!replacing && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setReplacing(true)}
              >
                差し替え
              </Button>
            )}
            <DeletePatButton
              onDeleted={() => {
                setConnected(false);
                setUsername(null);
                setReplacing(false);
              }}
            />
          </div>
        </div>
      )}
      {showForm && (
        <PatForm
          replacing={connected}
          onCancelReplace={connected ? () => setReplacing(false) : undefined}
          onRegistered={(login) => {
            setConnected(true);
            setUsername(login);
            setReplacing(false);
          }}
        />
      )}
    </div>
  );
}

function PatForm({
  replacing,
  onCancelReplace,
  onRegistered,
}: {
  replacing: boolean;
  onCancelReplace?: () => void;
  onRegistered: (login: string) => void;
}) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await registerGithubPat(token);
      if (!result.ok || !result.data) {
        setError(result.ok ? "登録に失敗しました" : result.error.message);
        return;
      }
      setToken("");
      toast(`@${result.data.username} として接続しました`);
      onRegistered(result.data.username);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="github-pat">
        {replacing ? "新しいトークンに差し替える" : "Personal Access Token"}
        <Input
          id="github-pat"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          required
        />
      </label>
      <p className="text-xs text-muted-foreground">
        GitHubの Settings → Developer settings → Fine-grained personal access
        tokens で発行します。対象を原稿リポジトリのみに限定し、権限は Contents
        の Read and write を選んでください。
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2 self-end">
        {onCancelReplace && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancelReplace}
          >
            キャンセル
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={submitting || token.trim() === ""}
        >
          {submitting && (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          )}
          {submitting ? "接続を確認中…" : "登録する"}
        </Button>
      </div>
    </form>
  );
}

function DeletePatButton({ onDeleted }: { onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await deleteGithubPat();
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast("GitHubトークンを削除しました");
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
          <AlertDialogTitle>GitHubトークンを削除しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            原稿タブからリポジトリを読み込めなくなります。再登録すれば元に戻ります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void handleDelete()}
          >
            削除する
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
