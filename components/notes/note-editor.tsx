"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, type Editor } from "@tiptap/react";
import {
  ArrowLeft,
  ClipboardCheck,
  History,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  attachTag,
  detachTag,
  restoreNote,
  trashNote,
  updateNote,
  type AttachedTag,
} from "@/lib/actions/notes";
import type { NoteContext } from "@/lib/ai/prompts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EditorToolbar,
  useMarkdownEditor,
} from "@/components/editor/markdown-editor";
import {
  clearStoredDraft,
  readStoredDraft,
  useAutosave,
  type SaveStatus,
} from "@/components/editor/use-autosave";
import { DeepDivePanel } from "@/components/notes/deep-dive-panel";
import { NoteHistoryPanel } from "@/components/notes/note-history-panel";
import { NoteCharacterReviewPanel } from "@/components/notes/note-character-review-panel";
import { TagInput } from "@/components/notes/tag-input";
import { TemplateMenu, type Template } from "@/components/notes/template-menu";
import { tagVariant } from "@/components/notes/note-card";

type NotePayload = { title: string; content: string };

function draftKey(noteId: string): string {
  return `nekonote:note-draft:${noteId}`;
}

export function NoteEditor({
  note,
  initialTags,
  allTags,
  templates,
}: {
  note: { id: string; title: string; content: string; updated_at: string };
  initialTags: AttachedTag[];
  allTags: AttachedTag[];
  templates: Template[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState<AttachedTag[]>(initialTags);
  const [restorableDraft, setRestorableDraft] = useState<NotePayload | null>(
    null,
  );
  // パネルは排他表示（掘り下げ / キャラクターレビュー / バージョン履歴のいずれか一方。Issue #47）
  const [openPanel, setOpenPanel] = useState<
    "deep-dive" | "character-review" | "history" | null
  >(null);

  const titleRef = useRef(note.title);
  const editorRef = useRef<Editor | null>(null);

  const getPayload = useCallback((): NotePayload | null => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return null;
    return { title: titleRef.current, content: currentEditor.getMarkdown() };
  }, []);

  const savePayload = useCallback(
    (payload: NotePayload) => updateNote(note.id, payload),
    [note.id],
  );

  const { status, scheduleSave, flush } = useAutosave({
    storageKey: draftKey(note.id),
    initialPayload: { title: note.title, content: note.content },
    getPayload,
    save: savePayload,
  });

  const editor = useMarkdownEditor({
    content: note.content,
    ariaLabel: "ノート本文",
    onUpdate: scheduleSave,
    // 復帰時: ドラフトがサーバー値より新しければ復元を提案（SPEC-notes §3.3）
    onCreate: () => {
      const draft = readStoredDraft<NotePayload>(draftKey(note.id));
      if (
        draft &&
        typeof draft.payload.content === "string" &&
        draft.savedAt > Date.parse(note.updated_at)
      ) {
        setRestorableDraft({
          title: draft.payload.title ?? "",
          content: draft.payload.content,
        });
      }
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  function restoreDraft() {
    if (!restorableDraft || !editor) return;
    setTitle(restorableDraft.title);
    titleRef.current = restorableDraft.title;
    editor.commands.setContent(restorableDraft.content, {
      contentType: "markdown",
    });
    setRestorableDraft(null);
    void flush();
  }

  function discardDraft() {
    clearStoredDraft(draftKey(note.id));
    setRestorableDraft(null);
  }

  function handleAttached(tag: AttachedTag) {
    setTags((prev) =>
      prev.some((t) => t.id === tag.id) ? prev : [...prev, tag],
    );
  }

  async function handleDetach(tagId: string) {
    const result = await detachTag(note.id, tagId);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== tagId));
  }

  function insertTemplate(template: Template) {
    if (!editor) return;
    // 1つの insertContent 呼び出し＝1回のUndoで丸ごと取り消せる
    editor
      .chain()
      .focus()
      .insertContent(template.content, { contentType: "markdown" })
      .run();
    if (template.tag_name) {
      void attachTag(note.id, {
        name: template.tag_name,
        kind: "category",
      }).then((result) => {
        if (result.ok && result.data) handleAttached(result.data);
        else if (!result.ok) toast.error(result.error.message);
      });
    }
  }

  /** 掘り下げパネルへ渡す、送信時点のノート現在値（保存前の編集内容を含む） */
  function getNoteContext(): NoteContext {
    return {
      title: titleRef.current,
      content: editorRef.current?.getMarkdown() ?? "",
      tags: tags.map((t) => t.name),
    };
  }

  function insertFromDeepDive(markdown: string) {
    if (!editor) return;
    // テンプレ挿入と同じ流儀: カーソル位置に挿入、1回のUndoで取り消せる
    editor
      .chain()
      .focus()
      .insertContent(markdown, { contentType: "markdown" })
      .run();
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
  function applyRestoredVersion(version: { title: string; content: string }) {
    setTitle(version.title);
    titleRef.current = version.title;
    editor?.commands.setContent(version.content, { contentType: "markdown" });
  }

  async function handleTrash() {
    await flush();
    const result = await trashNote(note.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast("ごみ箱に移動しました", {
      action: {
        label: "元に戻す",
        onClick: async () => {
          const restored = await restoreNote(note.id);
          if (!restored.ok) toast.error(restored.error.message);
        },
      },
    });
    router.push("/notes");
  }

  const statusLabel: Record<SaveStatus, string> = {
    saved: "保存済み",
    saving: "保存中…",
    offline: "オフライン退避中",
  };

  return (
    // エディタはビューポート内で完結させ、本文（main）とパネルが各自スクロールする
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={
            <Link href="/notes">
              <ArrowLeft data-icon="inline-start" />
              ノート一覧
            </Link>
          }
        />
        <div className="flex items-center gap-2">
          <span
            className={`text-xs ${status === "offline" ? "text-destructive" : "text-muted-foreground"}`}
            role="status"
          >
            {statusLabel[status]}
          </span>
          <Button
            variant={openPanel === "history" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="バージョン履歴"
            aria-pressed={openPanel === "history"}
            className="text-muted-foreground"
            onClick={toggleHistory}
          >
            <History />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="ごみ箱に移動"
            className="text-muted-foreground"
            onClick={handleTrash}
          >
            <Trash2 />
          </Button>
        </div>
      </header>

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
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              scheduleSave();
            }}
            placeholder="無題"
            aria-label="タイトル"
            className="h-auto border-none bg-transparent px-0 text-xl font-bold shadow-none focus-visible:ring-0 dark:bg-transparent"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <Badge
                key={tag.id}
                variant={tagVariant(tag.kind)}
                className="gap-0.5 pr-1"
              >
                {tag.kind === "working_title" ? `《${tag.name}》` : tag.name}
                <button
                  type="button"
                  aria-label={`タグ「${tag.name}」を外す`}
                  className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                  onClick={() => handleDetach(tag.id)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <TagInput
              noteId={note.id}
              allTags={allTags}
              attachedTagIds={tags.map((t) => t.id)}
              onAttached={handleAttached}
            />
          </div>

          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background/95 p-1 backdrop-blur">
            {/* useEditorState はマウント時の editor でスナップショットを初期化するため、生成後にマウントする */}
            {editor && <EditorToolbar editor={editor} />}
            <div className="ml-auto flex items-center gap-1">
              <TemplateMenu templates={templates} onInsert={insertTemplate} />
              <Button
                variant={openPanel === "deep-dive" ? "secondary" : "outline"}
                size="sm"
                aria-pressed={openPanel === "deep-dive"}
                onClick={() =>
                  setOpenPanel((v) => (v === "deep-dive" ? null : "deep-dive"))
                }
              >
                <Sparkles data-icon="inline-start" />
                掘り下げ
              </Button>
              <Button
                variant={
                  openPanel === "character-review" ? "secondary" : "outline"
                }
                size="sm"
                aria-pressed={openPanel === "character-review"}
                onClick={() =>
                  setOpenPanel((v) =>
                    v === "character-review" ? null : "character-review",
                  )
                }
              >
                <ClipboardCheck data-icon="inline-start" />
                キャラクターレビュー
              </Button>
            </div>
          </div>

          <EditorContent editor={editor} className="flex flex-1 flex-col" />
        </main>

        {openPanel === "deep-dive" && (
          <DeepDivePanel
            noteId={note.id}
            getNoteContext={getNoteContext}
            onInsert={insertFromDeepDive}
            onClose={() => setOpenPanel(null)}
          />
        )}
        {openPanel === "character-review" && (
          <NoteCharacterReviewPanel
            noteId={note.id}
            flushSave={flush}
            onClose={() => setOpenPanel(null)}
          />
        )}
        {openPanel === "history" && (
          <NoteHistoryPanel
            noteId={note.id}
            flushSave={flush}
            onRestore={applyRestoredVersion}
            onClose={() => setOpenPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
