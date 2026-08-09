"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { ClipboardCheck, History, UsersRound } from "lucide-react";

import { updateProposal, type LinkedNote } from "@/lib/actions/projects";
import { writingGenres, type ProposalStatus, type WritingGenre } from "@/lib/schemas/enums";
import { WRITING_GENRE_LABEL } from "@/lib/constants/proposal-template";
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
import { ProposalHistoryPanel } from "@/components/projects/proposal-history-panel";
import { ProposalReviewPanel } from "@/components/projects/review-panel";
import { ProposalStatusBadge } from "@/components/projects/status-badges";

type ProposalPayload = {
  writing_genre: WritingGenre;
  purpose: string | null;
  genre: string | null;
  target_audience: string | null;
  content: string;
};

// Input と同じトーンの select（shadcn select 未導入のため。色はテーマ変数のみ）
const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

// localStorage 由来のドラフトは型保証がないため、不正値は 'novel' に落とす
function toWritingGenre(value: unknown): WritingGenre {
  return writingGenres.includes(value as WritingGenre) ? (value as WritingGenre) : "novel";
}

function draftKey(proposalId: string): string {
  return `nekonote:proposal-draft:${proposalId}`;
}

export function ProposalEditor({
  proposal,
  linkedNotes,
}: {
  proposal: {
    id: string;
    writing_genre: WritingGenre;
    purpose: string | null;
    genre: string | null;
    target_audience: string | null;
    content: string;
    status: ProposalStatus;
    updated_at: string;
  };
  linkedNotes: LinkedNote[];
}) {
  const [writingGenre, setWritingGenre] = useState<WritingGenre>(proposal.writing_genre);
  const [purpose, setPurpose] = useState(proposal.purpose ?? "");
  const [genre, setGenre] = useState(proposal.genre ?? "");
  const [targetAudience, setTargetAudience] = useState(proposal.target_audience ?? "");
  const [restorableDraft, setRestorableDraft] = useState<ProposalPayload | null>(null);
  // パネルは排他表示（企画書レビュー / キャラクターレビュー / バージョン履歴のいずれか一方。SPEC-character-review §3.1）
  const [openPanel, setOpenPanel] = useState<"proposal" | "character" | "history" | null>(null);

  const writingGenreRef = useRef<WritingGenre>(proposal.writing_genre);
  const purposeRef = useRef(proposal.purpose ?? "");
  const genreRef = useRef(proposal.genre ?? "");
  const targetAudienceRef = useRef(proposal.target_audience ?? "");
  const editorRef = useRef<Editor | null>(null);

  const getPayload = useCallback((): ProposalPayload | null => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return null;
    return {
      writing_genre: writingGenreRef.current,
      purpose: purposeRef.current.trim() === "" ? null : purposeRef.current,
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
      writing_genre: proposal.writing_genre,
      purpose: proposal.purpose,
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
    const draftWritingGenre = toWritingGenre(restorableDraft.writing_genre);
    setWritingGenre(draftWritingGenre);
    writingGenreRef.current = draftWritingGenre;
    setPurpose(restorableDraft.purpose ?? "");
    purposeRef.current = restorableDraft.purpose ?? "";
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

  async function toggleHistory() {
    if (openPanel === "history") {
      setOpenPanel(null);
      return;
    }
    // 未保存分を確定してから履歴を開く（開いた瞬間の一覧と実際の保存状態を揃える）
    await flush();
    setOpenPanel("history");
  }

  /** 復元された版をエディタへ反映する（サーバー側は復元済み） */
  function applyRestoredVersion(content: string) {
    editor?.commands.setContent(content, { contentType: "markdown" });
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
              執筆ジャンル
              <select
                className={selectClass}
                value={writingGenre}
                onChange={(e) => {
                  // 変更してもテンプレは再適用しない（本文には触れない。SPEC-genre）
                  const next = e.target.value as WritingGenre;
                  setWritingGenre(next);
                  writingGenreRef.current = next;
                  scheduleSave();
                }}
              >
                {writingGenres.map((g) => (
                  <option key={g} value={g}>
                    {WRITING_GENRE_LABEL[g]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              執筆目的
              <Input
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  purposeRef.current = e.target.value;
                  scheduleSave();
                }}
                placeholder="例: 技術書典17で頒布する"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              内容ジャンル
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
              <Button
                variant={openPanel === "history" ? "secondary" : "outline"}
                size="sm"
                aria-label="バージョン履歴"
                aria-pressed={openPanel === "history"}
                onClick={() => void toggleHistory()}
              >
                <History />
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
        {openPanel === "history" && (
          <ProposalHistoryPanel
            proposalId={proposal.id}
            flushSave={flush}
            getCurrentContent={() => editorRef.current?.getMarkdown() ?? proposal.content}
            onRestore={applyRestoredVersion}
            onClose={() => setOpenPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
