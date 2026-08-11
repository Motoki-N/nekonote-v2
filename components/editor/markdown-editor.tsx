"use client";

import { useRef } from "react";
import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Redo2,
  SquareCode,
  Table,
  TextQuote,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { uploadAttachment } from "@/lib/actions/attachments";
import {
  ATTACHMENT_EXTENSION_BY_MIME,
  ATTACHMENT_IMAGE_MIMES,
} from "@/lib/schemas/attachment";
import { Button } from "@/components/ui/button";

/**
 * ノート・企画書で共用する Markdown エディタ（SPEC-notes §3.2 / SPEC-proposal-review §3.2）。
 * 対応記法は往復安全な範囲に限定（Issue #35 で表・画像・コードブロック・ファイル添付まで拡張。
 * いずれも @tiptap 公式拡張の Markdown 往復仕様の範囲内）
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
        strike: false,
        underline: false,
        link: { openOnClick: false },
      }),
      // 列幅リサイズは colwidth が Markdown に載らないため無効のまま使う
      TableKit,
      Image,
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

/** input[type=file] の accept 属性（アップロード可能な MIME の列挙） */
const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_EXTENSION_BY_MIME).join(",");
const IMAGE_ACCEPT = [...ATTACHMENT_IMAGE_MIMES].join(",");

export function EditorToolbar({ editor }: { editor: Editor }) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  /** アップロードして、画像はimgノード・それ以外はリンクとしてカーソル位置に挿入する */
  async function uploadAndInsert(file: File, kind: "image" | "file") {
    if (kind === "image" && !ATTACHMENT_IMAGE_MIMES.has(file.type)) {
      toast.error("対応している画像形式は PNG / JPEG / WebP / GIF です");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadAttachment(formData);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    if (!result.data) return;
    if (editor.isDestroyed) return; // アップロード完了前にページ遷移したケース
    const { url, fileName } = result.data;
    if (kind === "image") {
      // alt は extension-image の renderMarkdown にエスケープなしで埋め込まれるため、
      // Markdown 構造を壊す [ ] と改行を除去する（リンクと違いノード挿入では回避できない）
      const safeAlt = fileName.replace(/[\[\]\n]/g, "");
      editor.chain().focus().setImage({ src: url, alt: safeAlt }).run();
      return;
    }
    // ファイル名に [ ] ( ) が含まれても壊れないよう、Markdown文字列ではなくノードで挿入する
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: fileName,
        marks: [{ type: "link", attrs: { href: url } }],
      })
      .run();
  }

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
    kind: "image" | "file",
  ) {
    const file = event.target.files?.[0];
    // 同じファイルの再選択でも change を発火させる
    event.target.value = "";
    if (file) void uploadAndInsert(file, kind);
  }

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
    {
      label: "リンク",
      icon: <Link2 />,
      active: state.link,
      onClick: toggleLink,
    },
    {
      label: "コードブロック",
      icon: <SquareCode />,
      active: state.codeBlock,
      onClick: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "区切り線",
      icon: <Minus />,
      onClick: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      label: "表を挿入",
      icon: <Table />,
      // 表の中に表は作れない（表内では下の操作ボタン群を使う）
      disabled: state.table,
      onClick: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
  ];

  const historyButtons: typeof buttons = [
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

  /** カーソルが表内にあるときだけ出す操作（アイコンでは判別しにくいためテキストボタン） */
  const tableButtons: { label: string; onClick: () => void }[] = [
    {
      label: "行を追加",
      onClick: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      label: "行を削除",
      onClick: () => editor.chain().focus().deleteRow().run(),
    },
    {
      label: "列を追加",
      onClick: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      label: "列を削除",
      onClick: () => editor.chain().focus().deleteColumn().run(),
    },
    {
      label: "表を削除",
      onClick: () => editor.chain().focus().deleteTable().run(),
    },
  ];

  function renderIconButton(button: (typeof buttons)[number]) {
    return (
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
    );
  }

  return (
    <>
      {buttons.map(renderIconButton)}
      {/* ref を触る onClick は JSX に直接渡す（react-hooks/refs が配列格納の関数を event handler と認識しないため） */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="画像を挿入"
        onClick={() => imageInputRef.current?.click()}
      >
        <ImagePlus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="ファイルを添付"
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip />
      </Button>
      {historyButtons.map(renderIconButton)}
      {state.table &&
        tableButtons.map((button) => (
          <Button
            key={button.label}
            variant="ghost"
            size="xs"
            onClick={button.onClick}
          >
            {button.label}
          </Button>
        ))}
      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => handleFileChange(e, "image")}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => handleFileChange(e, "file")}
      />
    </>
  );
}
