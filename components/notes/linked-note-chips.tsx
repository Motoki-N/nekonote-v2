"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { searchNotesForLink, type LinkedNote } from "@/lib/actions/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * ノート紐づけチップの共通UI（企画書・シーンカードで共用。Issue #56 で LinkedNotes から抽出）。
 * チップ→ノートへのリンク、検索して個別追加、解除。表示するノート一覧は呼び出し側が管理する
 * （attach/detach のサーバー保存・状態更新・エラートーストも呼び出し側の責務）
 */
export function LinkedNoteChips({
  notes,
  onAttach,
  onDetach,
}: {
  notes: LinkedNote[];
  onAttach: (note: LinkedNote) => Promise<void> | void;
  onDetach: (noteId: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkedNote[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const result = await searchNotesForLink(q);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setResults(result.data ?? []);
    } finally {
      setSearching(false);
    }
  }

  const linkedIds = new Set(notes.map((n) => n.id));

  return (
    <>
      {notes.map((note) => (
        <Badge key={note.id} variant="outline" className="gap-0.5 pr-1">
          <Link href={`/notes/${note.id}`} className="hover:underline">
            {note.title || "無題"}
          </Link>
          <button
            type="button"
            aria-label={`ノート「${note.title || "無題"}」の紐づけを解除`}
            className="rounded-full p-0.5 hover:bg-muted-foreground/20"
            onClick={() => void onDetach(note.id)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setResults(null);
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button variant="ghost" size="xs" className="text-muted-foreground">
              <Plus data-icon="inline-start" />
              追加
            </Button>
          }
        />
        <PopoverContent className="w-72 p-2" align="start">
          <form onSubmit={handleSearch} className="flex items-center gap-1.5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ノートをタイトルで検索"
              aria-label="ノート検索"
              autoFocus
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={searching || !query.trim()}
            >
              {searching ? <Loader2 className="animate-spin" /> : "検索"}
            </Button>
          </form>
          {results !== null && (
            <ul className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
              {results.length === 0 ? (
                <li className="p-2 text-xs text-muted-foreground">
                  見つかりませんでした
                </li>
              ) : (
                results.map((note) => (
                  <li key={note.id}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      disabled={linkedIds.has(note.id)}
                      onClick={() => void onAttach(note)}
                    >
                      {note.title || "無題"}
                      {linkedIds.has(note.id) && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          紐づけ済み
                        </span>
                      )}
                    </Button>
                  </li>
                ))
              )}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
