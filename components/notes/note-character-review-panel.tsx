"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import {
  getLinkedProposalsForNote,
  type LinkedProposalOption,
} from "@/lib/actions/review";
import { Button } from "@/components/ui/button";
import { ReviewPanel } from "@/components/review/review-panel";

/**
 * ノート編集画面からのキャラクターレビュー起動（Issue #47）。
 * ノートは project_id を持たないため、まず紐づく企画書を解決してから ReviewPanel を出す:
 * 0件 = 案内のみ（紐づけは企画書画面の既存導線に委ねる）／1件 = 自動選択／複数 = 選択UI
 */
export function NoteCharacterReviewPanel({
  noteId,
  flushSave,
  onClose,
}: {
  noteId: string;
  flushSave: () => Promise<void>;
  onClose: () => void;
}) {
  // undefined = 読込中
  const [linked, setLinked] = useState<LinkedProposalOption[] | undefined>(
    undefined,
  );
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLinkedProposalsForNote(noteId).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setLoadError(
          result.ok ? "紐づく企画の取得に失敗しました" : result.error.message,
        );
        setLinked([]);
        return;
      }
      setLinked(result.data);
      if (result.data.length === 1)
        setSelectedProposalId(result.data[0].proposalId);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const selected = linked?.find((p) => p.proposalId === selectedProposalId);

  if (selectedProposalId !== null) {
    return (
      <ReviewPanel
        key={selectedProposalId}
        kind="character"
        targetId={selectedProposalId}
        noteId={noteId}
        title="キャラクターレビュー"
        subtitle={selected ? `『${selected.projectTitle}』` : undefined}
        emptyText="このノート1枚を主対象に、5つの問い（誰が・何を・なぜ・失敗の代償・どう変わるか）で見てもらいましょう。"
        showVerdict={false}
        flushSave={flushSave}
        onClose={onClose}
        headerExtra={
          linked !== undefined && linked.length > 1 ? (
            <select
              aria-label="レビューする企画"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={selectedProposalId}
              onChange={(e) => setSelectedProposalId(e.target.value)}
            >
              {linked.map((p) => (
                <option key={p.proposalId} value={p.proposalId}>
                  企画: {p.projectTitle}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
    );
  }

  // 企画未確定（読込中・未紐づけ・複数からの初回選択）はプレースホルダーパネルを出す
  return (
    <aside
      aria-label="キャラクターレビューパネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">キャラクターレビュー</span>
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
      <div className="flex-1 overflow-y-auto p-4 text-sm text-muted-foreground">
        {linked === undefined ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin" aria-label="読み込み中" />
          </div>
        ) : loadError ? (
          <p className="text-destructive">{loadError}</p>
        ) : linked.length === 0 ? (
          <p>
            このノートはまだどの企画にも紐づいていません。企画書画面の「紐づけノート」からこのノートを追加すると、その企画の文脈でキャラクターレビューを受けられます。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p>
              このノートは複数の企画に紐づいています。レビューする企画を選んでください。
            </p>
            <select
              aria-label="レビューする企画"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value=""
              onChange={(e) => {
                if (e.target.value !== "")
                  setSelectedProposalId(e.target.value);
              }}
            >
              <option value="">企画を選択…</option>
              {linked.map((p) => (
                <option key={p.proposalId} value={p.proposalId}>
                  {p.projectTitle}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </aside>
  );
}
