"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { attachTag, type AttachedTag } from "@/lib/actions/notes";
import type { TagKind } from "@/lib/schemas/enums";
import { Input } from "@/components/ui/input";

type Tag = { id: string; name: string; kind: string };

/**
 * タグのインライン作成つき入力欄。
 * 既存タグをインクリメンタル候補表示し、一致がなければ種類を選んで新規作成する
 */
export function TagInput({
  noteId,
  allTags,
  attachedTagIds,
  onAttached,
}: {
  noteId: string;
  allTags: Tag[];
  attachedTagIds: string[];
  onAttached: (tag: AttachedTag) => void;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = value.trim();
  const candidates = allTags.filter(
    (tag) =>
      !attachedTagIds.includes(tag.id) &&
      (trimmed === "" || tag.name.toLowerCase().includes(trimmed.toLowerCase())),
  );
  const exactMatch = allTags.some((tag) => tag.name === trimmed);

  async function attach(name: string, kind: TagKind) {
    setPending(true);
    try {
      const result = await attachTag(noteId, { name, kind });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (result.data) onAttached(result.data);
      setValue("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative min-w-40 flex-1">
      <Input
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => {
          if (blurTimeout.current) clearTimeout(blurTimeout.current);
          setOpen(true);
        }}
        onBlur={() => {
          // 候補クリック（mousedown）を先に処理させてから閉じる
          blurTimeout.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder="タグを追加…"
        aria-label="タグを追加"
        className="h-7 text-sm"
      />
      {open && (candidates.length > 0 || (trimmed !== "" && !exactMatch)) && (
        <ul className="absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
          {candidates.map((tag) => (
            <li key={tag.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => attach(tag.name, tag.kind as TagKind)}
              >
                <span>{tag.kind === "working_title" ? `《${tag.name}》` : tag.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {tag.kind === "working_title" ? "仮タイトル" : "カテゴリ"}
                </span>
              </button>
            </li>
          ))}
          {trimmed !== "" && !exactMatch && (
            <>
              <li>
                <button
                  type="button"
                  className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-muted"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => attach(trimmed, "category")}
                >
                  「{trimmed}」をカテゴリとして作成
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-muted"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => attach(trimmed, "working_title")}
                >
                  「{trimmed}」を仮タイトルとして作成
                </button>
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  );
}
