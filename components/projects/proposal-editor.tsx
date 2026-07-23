"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { ClipboardCheck, UsersRound } from "lucide-react";

import { updateProposal, type LinkedNote } from "@/lib/actions/projects";
import type { ProposalStatus } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditorToolbar, useMarkdownEditor } from "@/components/editor/markdown-editor";
import {
  clearStoredDraft,
  readStoredDraft,
  useAutosave,
  type SaveStatus,
} from "@/components/editor/use-autosave";
import { CharacterReviewPanel } from "@/components/projects/character-review-panel";
import { LinkedNotes } from "@/components/projects/linked-notes";
import { ProposalReviewPanel } from "@/components/projects/review-panel";
import { ProposalStatusBadge } from "@/components/projects/status-badges";

type ProposalPayload = { genre: string | null; target_audience: string | null; content: string };

function draftKey(proposalId: string): string {
  return `nekonote:proposal-draft:${proposalId}`;
}

export function ProposalEditor({
  proposal,
  linkedNotes,
}: {
  proposal: {
    id: string;
    genre: string | null;
    target_audience: string | null;
    content: string;
    status: ProposalStatus;
    updated_at: string;
  };
  linkedNotes: LinkedNote[];
}) {
  const [genre, setGenre] = useState(proposal.genre ?? "");
  const [targetAudience, setTargetAudience] = useState(proposal.target_audience ?? "");
  const [restorableDraft, setRestorableDraft] = useState<ProposalPayload | null>(null);
  // レビューパネルは排他表示（企画書レビュー / キャラクターレビューのどちらか一方。SPEC-character-review §3.1）
  const [openPanel, setOpenPanel] = useState<"proposal" | "character" | null>(null);

  const genreRef = useRef(proposal.genre ?? "");
  const targetAudienceRef = useRef(proposal.target_audience ?? "");
  const editorRef = useRef<Editor | null>(null);

  const getPayload = useCallback((): ProposalPayload | null => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return null;
    return {
      genre: genreRef.current.trim() === "" ? null : genreRef.current,
      target_audience: targetAudienceRef.current.trim() === "" ? null : targetAudienceRef.current,
      content: currentEditor.getMarkdown(),
    };
  }, []);

  const savePayload = useCallback(
    (payload: ProposalPayload) => updateProposal(proposal.id, payload),
    [proposal.id],
  );

  const { status, scheduleSave, flush } = useAutosave({
    storageKey: draftKey(proposal.id),
    initialPayload: {
      genre: proposal.genre,
      target_audience: proposal.target_audience,
      content: proposal.content,
    },
    getPayload,
    save: savePayload,
  });

  const editor = useMarkdownEditor({
    content: proposal.content,
    ariaLabel: "企画書本文",
    onUpdate: scheduleSave,
    // 復帰時: ドラフトがサーバー値より新しければ復元を提案（ノートと同じ挙動）
    onCreate: () => {
      const draft = readStoredDraft<ProposalPayload>(draftKey(proposal.id));
      if (
        draft &&
        typeof draft.payload.content === "string" &&
        draft.savedAt > Date.parse(proposal.updated_at)
      ) {
        setRestorableDraft(draft.payload);
      }
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  function restoreDraft() {
    if (!restorableDraft || !editor) return;
    setGenre(restorableDraft.genre ?? "");
    genreRef.current = restorableDraft.genre ?? "";
    setTargetAudience(restorableDraft.target_audience ?? "");
    targetAudienceRef.current = restorableDraft.target_audience ?? "";
    editor.commands.setContent(restorableDraft.content, { contentType: "markdown" });
    setRestorableDraft(null);
    void flush();
  }

  function discardDraft() {
    clearStoredDraft(draftKey(proposal.id));
    setRestorableDraft(null);
  }

  const statusLabel: Record<SaveStatus, string> = {
    saved: "保存済み",
    saving: "保存中…",
    offline: "オフライン退避中",
  };

  return (
    // 共通レイアウト（ヘッダー＋タブ）の残り高さ内で完結させ、本文（main）とパネルが各自スクロールする
    <div className="flex min-h-0 flex-1 flex-col">
      {restorableDraft && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2 text-sm text-foreground sm:px-6">
          <span>保存されていない下書きがあります。復元しますか？</span>
          <span className="flex gap-2">
            <Button size="xs" onClick={restoreDraft}>
              復元する
            </Button>
            <Button size="xs" variant="outline" onClick={discardDraft}>
              破棄する
            </Button>
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={proposal.status} />
            <span
              className={`ml-auto text-xs ${status === "offline" ? "text-destructive" : "text-muted-foreground"}`}
              role="status"
            >
              {statusLabel[status]}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              ジャンル
              <Input
                value={genre}
                onChange={(e) => {
                  setGenre(e.target.value);
                  genreRef.current = e.target.value;
                  scheduleSave();
                }}
                placeholder="例: 現代ファンタジー"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              ターゲット層
              <Input
                value={targetAudience}
                onChange={(e) => {
                  setTargetAudience(e.target.value);
                  targetAudienceRef.current = e.target.value;
                  scheduleSave();
                }}
                placeholder="例: ライトノベルを読む高校生"
              />
            </label>
          </div>

          <LinkedNotes proposalId={proposal.id} initialNotes={linkedNotes} />

          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background/95 p-1 backdrop-blur">
            {/* useEditorState はマウント時の editor でスナップショットを初期化するため、生成後にマウントする */}
            {editor && <EditorToolbar editor={editor} />}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant={openPanel === "proposal" ? "secondary" : "outline"}
                size="sm"
                aria-pressed={openPanel === "proposal"}
                onClick={() => setOpenPanel((v) => (v === "proposal" ? null : "proposal"))}
              >
                <ClipboardCheck data-icon="inline-start" />
                レビュー
              </Button>
              <Button
                variant={openPanel === "character" ? "secondary" : "outline"}
                size="sm"
                aria-pressed={openPanel === "character"}
                onClick={() => setOpenPanel((v) => (v === "character" ? null : "character"))}
              >
                <UsersRound data-icon="inline-start" />
                キャラクター
              </Button>
            </div>
          </div>

          <EditorContent editor={editor} className="flex flex-1 flex-col" />
        </main>

        {openPanel === "proposal" && (
          <ProposalReviewPanel
            proposalId={proposal.id}
            proposalStatus={proposal.status}
            flushSave={flush}
            onClose={() => setOpenPanel(null)}
          />
        )}
        {openPanel === "character" && (
          <CharacterReviewPanel
            proposalId={proposal.id}
            linkedNotes={linkedNotes}
            flushSave={flush}
            onClose={() => setOpenPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
