"use client";

import { useState } from "react";

import type { LinkedNote } from "@/lib/actions/projects";
import { ReviewPanel } from "@/components/review/review-panel";

/**
 * 企画書画面のキャラクターレビューパネル（SPEC-character-review §3.1 / Issue #47）。
 * 対象セレクタで「全体（企画書＋紐づけノート全部）」と「特定ノート1枚」を切り替える。
 * スコープ切り替え＝別セッション系列なので、key で ReviewPanel を丸ごと再マウントする
 */
export function CharacterReviewPanel({
  proposalId,
  linkedNotes,
  flushSave,
  onClose,
}: {
  proposalId: string;
  linkedNotes: LinkedNote[];
  flushSave: () => Promise<void>;
  onClose: () => void;
}) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const selected = linkedNotes.find((note) => note.id === noteId) ?? null;

  return (
    <ReviewPanel
      key={noteId ?? "all"}
      kind="character"
      targetId={proposalId}
      noteId={noteId ?? undefined}
      title="キャラクターレビュー"
      subtitle={selected ? selected.title || "（無題）" : undefined}
      emptyText={
        selected
          ? `「${selected.title || "（無題）"}」1枚を主対象に、5つの問い（誰が・何を・なぜ・失敗の代償・どう変わるか）で見てもらいましょう。`
          : "5つの問い（誰が・何を・なぜ・失敗の代償・どう変わるか）でキャラクター設計を見てもらいましょう。キャラクターノートを企画書に紐づけると、レビューの材料になります。"
      }
      showVerdict={false}
      flushSave={flushSave}
      onClose={onClose}
      headerExtra={
        linkedNotes.length > 0 ? (
          <select
            aria-label="レビュー対象"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={noteId ?? ""}
            onChange={(e) => setNoteId(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">対象: 全体（企画書＋紐づけノート全部）</option>
            {linkedNotes.map((note) => (
              <option key={note.id} value={note.id}>
                対象: {note.title || "（無題）"}
              </option>
            ))}
          </select>
        ) : undefined
      }
    />
  );
}
