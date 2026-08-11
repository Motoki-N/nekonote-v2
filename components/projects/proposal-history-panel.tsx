"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  listProposalVersions,
  restoreProposalVersion,
  type ProposalVersion,
} from "@/lib/actions/projects";
import { diffTexts } from "@/lib/diff";
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
import { DiffView } from "@/components/diff-view";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * 企画書のバージョン履歴パネル（Issue #64）。
 * 版を選ぶと「その版 → 次の版（最新の版は現在の本文）」の差分を展開する
 * （レビュー反復ごとの改稿を追う形。原稿タブのコミット履歴と同じ差分の見せ方）。
 * lg以上は右サイドパネル、lg未満はボトムシート（レビューパネルと同配置）
 */
export function ProposalHistoryPanel({
  proposalId,
  flushSave,
  getCurrentContent,
  onRestore,
  onClose,
}: {
  proposalId: string;
  /** 復元前に未保存分を確定させる（パネル表示中の入力が復元前スナップショットに含まれるように） */
  flushSave: () => Promise<void>;
  /** 最新の版との差分に使う現在の本文（エディタの編集中内容） */
  getCurrentContent: () => string;
  /** 復元成功時にエディタへ反映させる */
  onRestore: (content: string) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<ProposalVersion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listProposalVersions(proposalId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setVersions(result.data);
      else if (!result.ok) setLoadError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  const selectedIndex = versions?.findIndex((v) => v.id === selectedId) ?? -1;
  // 差分は「選択した版 → 1つ新しい版（先頭の版は現在の本文）」
  const diffRows = useMemo(() => {
    if (!versions || selectedIndex < 0) return null;
    const newer =
      selectedIndex === 0
        ? getCurrentContent()
        : versions[selectedIndex - 1].content;
    return diffTexts(versions[selectedIndex].content, newer);
  }, [versions, selectedIndex, getCurrentContent]);

  async function handleRestore(version: ProposalVersion) {
    setRestoring(true);
    await flushSave();
    const result = await restoreProposalVersion(proposalId, version.id);
    setRestoring(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    onRestore(version.content);
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
        <div className="flex-1 overflow-y-auto p-3">
          <ul className="flex flex-col gap-1.5">
            {versions.map((version) => {
              const expanded = version.id === selectedId;
              return (
                <li
                  key={version.id}
                  className="rounded-lg border border-border bg-card"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setSelectedId(expanded ? null : version.id)}
                    className="flex w-full items-center gap-2 rounded-lg p-2.5 text-left transition-colors hover:bg-secondary/50"
                  >
                    {expanded ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm text-card-foreground">
                      {dateFormat.format(new Date(version.created_at))}
                    </span>
                    {version.kind === "review" && (
                      <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        レビュー時
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2">
                      <p className="text-xs text-muted-foreground">
                        この版から{selectedIndex === 0 ? "現在" : "次の版"}
                        への変更
                      </p>
                      {diffRows && diffRows.length > 0 ? (
                        <DiffView rows={diffRows} />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          変更はありません
                        </p>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={restoring}
                            >
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
                              企画書の本文がこの版の内容に置き換わります。現在の本文は復元前に新しい版として保存されるため、履歴から戻せます。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void handleRestore(version)}
                            >
                              復元する
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
