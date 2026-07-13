"use client";

import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import {
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
  TextQuote,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * ノート・企画書で共用する Markdown エディタ（SPEC-notes §3.2 / SPEC-proposal-review §3.2）。
 * 対応記法は往復安全な範囲に限定（表・画像・コードブロック等はスコープ外）
 */
export function useMarkdownEditor({
  content,
  ariaLabel,
  onUpdate,
  onCreate,
}: {
  content: string;
  ariaLabel: string;
  onUpdate?: () => void;
  onCreate?: () => void;
}) {
  return useEditor({
    extensions: [
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
    content,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap-editor focus:outline-none",
        "aria-label": ariaLabel,
      },
    },
    onUpdate,
    onCreate,
  });
}

export function EditorToolbar({ editor }: { editor: Editor }) {
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
