"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  attachProposalNote,
  detachProposalNote,
  type LinkedNote,
} from "@/lib/actions/projects";
import { LinkedNoteChips } from "@/components/notes/linked-note-chips";

/**
 * 企画書の紐づけノート（SPEC-proposal-review §3.2）。
 * チップUIは LinkedNoteChips（シーンカードと共用。Issue #56 で抽出）。ごみ箱中のノートはサーバー側で除外済み
 */
export function LinkedNotes({
  proposalId,
  initialNotes,
}: {
  proposalId: string;
  initialNotes: LinkedNote[];
}) {
  const [notes, setNotes] = useState<LinkedNote[]>(initialNotes);

  async function handleAttach(note: LinkedNote) {
    const result = await attachProposalNote(proposalId, note.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setNotes((prev) =>
      prev.some((n) => n.id === note.id) ? prev : [...prev, note],
    );
  }

  async function handleDetach(noteId: string) {
    const result = await detachProposalNote(proposalId, noteId);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">紐づけノート:</span>
      <LinkedNoteChips
        notes={notes}
        onAttach={handleAttach}
        onDetach={handleDetach}
      />
    </div>
  );
}
