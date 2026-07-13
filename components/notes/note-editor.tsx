"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import {
  ArrowLeft,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Sparkles,
  TextQuote,
  Trash2,
  Undo2,
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
import { DeepDivePanel } from "@/components/notes/deep-dive-panel";
import { TagInput } from "@/components/notes/tag-input";
import { TemplateMenu, type Template } from "@/components/notes/template-menu";
import { tagVariant } from "@/components/notes/note-card";

type SaveStatus = "saved" | "saving" | "offline";

type Draft = { title: string; content: string; savedAt: number };

const AUTOSAVE_DELAY_MS = 2000;

function draftKey(noteId: string): string {
  return `nekonote:note-draft:${noteId}`;
}

function readDraft(noteId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(noteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.content !== "string" || typeof parsed.savedAt !== "number") return null;
    return { title: parsed.title ?? "", content: parsed.content, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
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
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [restorableDraft, setRestorableDraft] = useState<Draft | null>(null);
  const [showDeepDive, setShowDeepDive] = useState(false);

  const titleRef = useRef(note.title);
  const lastSavedRef = useRef({ title: note.title, content: note.content });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      // SPEC-notes §3.2: 往復安全な記法に限定（表・画像・コードブロック等はスコープ外）
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: { openOnClick: false },
      }),
      Markdown,
    ],
    content: note.content,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap-editor focus:outline-none",
        "aria-label": "ノート本文",
      },
    },
    onUpdate: () => scheduleSave(),
    // 復帰時: ドラフトがサーバー値より新しければ復元を提案（SPEC-notes §3.3）
    onCreate: () => {
      const draft = readDraft(note.id);
      if (draft && draft.savedAt > Date.parse(note.updated_at)) {
        setRestorableDraft(draft);
      }
    },
  });
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const save = useCallback(async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return;
    const payload = { title: titleRef.current, content: currentEditor.getMarkdown() };
    if (
      payload.title === lastSavedRef.current.title &&
      payload.content === lastSavedRef.current.content
    ) {
      return;
    }
    setStatus("saving");
    try {
      const result = await updateNote(note.id, payload);
      if (!result.ok) throw new Error(result.error.message);
      lastSavedRef.current = payload;
      localStorage.removeItem(draftKey(note.id));
      setStatus("saved");
    } catch {
      // 保存失敗（401・ネットワーク断）: localStorage へドラフト退避（SPEC-auth §6）
      const draft: Draft = { ...payload, savedAt: Date.now() };
      localStorage.setItem(draftKey(note.id), JSON.stringify(draft));
      setStatus("offline");
    }
  }, [note.id]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(save, AUTOSAVE_DELAY_MS);
  }, [save]);

  // ページ離脱時・バックグラウンド化時に即時保存
  useEffect(() => {
    function flush() {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void save();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [save]);

  function restoreDraft() {
    if (!restorableDraft || !editor) return;
    setTitle(restorableDraft.title);
    titleRef.current = restorableDraft.title;
    editor.commands.setContent(restorableDraft.content, { contentType: "markdown" });
    setRestorableDraft(null);
    void save();
  }

  function discardDraft() {
    localStorage.removeItem(draftKey(note.id));
    setRestorableDraft(null);
  }

  function handleAttached(tag: AttachedTag) {
    setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
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
    editor.chain().focus().insertContent(template.content, { contentType: "markdown" }).run();
    if (template.tag_name) {
      void attachTag(note.id, { name: template.tag_name, kind: "category" }).then((result) => {
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
    editor.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
  }

  async function handleTrash() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await save();
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
            <Badge key={tag.id} variant={tagVariant(tag.kind)} className="gap-0.5 pr-1">
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
              variant={showDeepDive ? "secondary" : "outline"}
              size="sm"
              aria-pressed={showDeepDive}
              onClick={() => setShowDeepDive((v) => !v)}
            >
              <Sparkles data-icon="inline-start" />
              掘り下げ
            </Button>
          </div>
        </div>

        <EditorContent editor={editor} className="flex flex-1 flex-col" />
        </main>

        {showDeepDive && (
          <DeepDivePanel
            noteId={note.id}
            getNoteContext={getNoteContext}
            onInsert={insertFromDeepDive}
            onClose={() => setShowDeepDive(false)}
          />
        )}
      </div>
    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  function toggleLink() {
    if (editor.isActive("link")) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const url = window.prompt("リンクURL");
    if (!url) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const buttons: {
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }[] = [
    {
      label: "見出し1",
      icon: <Heading1 />,
      active: state.h1,
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "見出し2",
      icon: <Heading2 />,
      active: state.h2,
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "見出し3",
      icon: <Heading3 />,
      active: state.h3,
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "太字",
      icon: <Bold />,
      active: state.bold,
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: <Italic />,
      active: state.italic,
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "箇条書き",
      icon: <List />,
      active: state.bulletList,
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "番号リスト",
      icon: <ListOrdered />,
      active: state.orderedList,
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "引用",
      icon: <TextQuote />,
      active: state.blockquote,
      onClick: () => editor.chain().focus().toggleBlockquote().run(),
    },
    { label: "リンク", icon: <Link2 />, active: state.link, onClick: toggleLink },
    {
      label: "区切り線",
      icon: <Minus />,
      onClick: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      label: "元に戻す",
      icon: <Undo2 />,
      disabled: !state.canUndo,
      onClick: () => editor.chain().focus().undo().run(),
    },
    {
      label: "やり直す",
      icon: <Redo2 />,
      disabled: !state.canRedo,
      onClick: () => editor.chain().focus().redo().run(),
    },
  ];

  return (
    <>
      {buttons.map((button) => (
        <Button
          key={button.label}
          variant={button.active ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={button.label}
          aria-pressed={button.active}
          disabled={button.disabled}
          onClick={button.onClick}
        >
          {button.icon}
        </Button>
      ))}
    </>
  );
}
