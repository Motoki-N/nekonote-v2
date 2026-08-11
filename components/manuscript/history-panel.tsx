"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History, Loader2, X } from "lucide-react";

import {
  getManuscriptCommitDiff,
  getManuscriptHistory,
} from "@/lib/actions/manuscripts";
import { parsePatch } from "@/lib/diff";
// 型のみの import は実行時に消えるため server-only モジュールでも安全
// （'use server' ファイルは async 関数しか export できず、型の再exportができない）
import type { FileCommitEntry } from "@/lib/git/github";
import { Button } from "@/components/ui/button";
import { DiffView } from "@/components/diff-view";

/** コミット日時の表示（JST・秒なし）。API欠損時は空表示 */
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

/**
 * 履歴パネル（SPEC-manuscript-history §3）。
 * 開いているファイルのコミット一覧（最新30件・デフォルトブランチ）を表示し、
 * コミットを選ぶとそのコミットでの変更（そのファイルのdiff）を展開する。
 * lg以上は右サイドパネル、lg未満はボトムシート（校正パネルと同じレイアウト言語）
 */
export function HistoryPanel({
  linkId,
  onClose,
}: {
  linkId: string;
  onClose: () => void;
}) {
  const [commits, setCommits] = useState<FileCommitEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  // 取得済みdiffのキャッシュ（null = patchなし＝差分を表示できないコミット）
  const [patches, setPatches] = useState<Record<string, string | null>>({});
  const [diffLoadingSha, setDiffLoadingSha] = useState<string | null>(null);
  // エラーは対象コミットに紐付ける（別コミットの展開領域へ誤表示させない）
  const [diffError, setDiffError] = useState<{
    sha: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getManuscriptHistory(linkId).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setListError(
          result.ok ? "履歴の取得に失敗しました" : result.error.message,
        );
        return;
      }
      setCommits(result.data.commits);
    });
    return () => {
      cancelled = true;
    };
  }, [linkId]);

  const toggleCommit = useCallback(
    async (sha: string) => {
      // 展開中の再クリックは閉じるだけ
      if (expandedSha === sha) {
        setExpandedSha(null);
        return;
      }
      setExpandedSha(sha);
      setDiffError(null);
      if (sha in patches) return;
      setDiffLoadingSha(sha);
      try {
        const result = await getManuscriptCommitDiff(linkId, sha);
        if (!result.ok || !result.data) {
          setDiffError({
            sha,
            message: result.ok
              ? "差分の取得に失敗しました"
              : result.error.message,
          });
          return;
        }
        const { patch } = result.data;
        setPatches((prev) => ({ ...prev, [sha]: patch }));
      } finally {
        // 別コミットの取得が始まっていたらそのローディング表示を消さない（並行時の混線防止）
        setDiffLoadingSha((prev) => (prev === sha ? null : prev));
      }
    },
    [expandedSha, linkId, patches],
  );

  return (
    <aside
      aria-label="履歴パネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <History className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">変更履歴</span>
        <span className="text-xs text-muted-foreground">最新30件</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="パネルを閉じる"
            className="text-muted-foreground"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {commits === null && listError === null && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            履歴を取得中…
          </div>
        )}
        {listError && (
          <p className="p-2 text-sm text-destructive">{listError}</p>
        )}
        {commits !== null && commits.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">
            このファイルのコミットが見つかりません
          </p>
        )}
        {commits !== null && (
          <ul className="flex flex-col gap-1.5">
            {commits.map((commit) => {
              const expanded = expandedSha === commit.sha;
              return (
                <li
                  key={commit.sha}
                  className="rounded-lg border border-border bg-card"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => void toggleCommit(commit.sha)}
                    className="flex w-full items-start gap-2 rounded-lg p-2.5 text-left transition-colors hover:bg-secondary/50"
                  >
                    {expanded ? (
                      <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-sm text-card-foreground">
                        {commit.message.split("\n")[0]}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(commit.date)}</span>
                        <code className="font-mono">
                          {commit.sha.slice(0, 7)}
                        </code>
                      </span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-border px-2.5 py-2">
                      {diffLoadingSha === commit.sha ? (
                        <div className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          差分を取得中…
                        </div>
                      ) : diffError?.sha === commit.sha &&
                        !(commit.sha in patches) ? (
                        <p className="p-1 text-sm text-destructive">
                          {diffError.message}
                        </p>
                      ) : patches[commit.sha] == null ? (
                        <p className="p-1 text-xs text-muted-foreground">
                          差分を表示できません（変更が大きすぎるか、このファイルの変更を含みません）
                        </p>
                      ) : (
                        <DiffView
                          rows={parsePatch(patches[commit.sha] as string)}
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
