"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { SceneRecord } from "@/lib/board";
import { Badge } from "@/components/ui/badge";
import { ManuscriptBadge } from "@/components/board/scene-card";
import { cn } from "@/lib/utils";

/**
 * 章マーカーカードの見た目（レーン内・DragOverlay で共用。SPEC-board-chapters §5.1）。
 * シーンカードと区別できるよう破線＋淡い地色にする（色はテーマ用CSS変数のみ）。
 * 章の位置＝章の始まり位置なので、シーンと同じ並びの中に区切り行として置く
 */
export function ChapterCardContent({
  chapter,
  chapterNumber,
  onClick,
}: {
  chapter: SceneRecord;
  /** 章番号（1始まり。章マーカーの出現順）。DragOverlay では省略する */
  chapterNumber?: number;
  onClick?: () => void;
}) {
  const label = chapterNumber === undefined ? "章" : `第${chapterNumber}章`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`章を編集: ${label} ${chapter.title || "無題"}`}
      className="flex w-full flex-col gap-1 rounded-md border border-dashed border-border bg-muted/50 p-2 text-left transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex items-center gap-1.5">
        <Badge variant="secondary">{label}</Badge>
        <span className="text-sm font-medium text-foreground">
          {chapter.title || "（無題）"}
        </span>
      </span>
      {chapter.content !== "" && (
        <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">
          {chapter.content}
        </p>
      )}
      {chapter.manuscript_path !== null && (
        <span className="flex flex-wrap gap-1">
          <ManuscriptBadge scene={chapter} />
        </span>
      )}
    </button>
  );
}

/** レーン内でドラッグできる章マーカーカード（シーンと同じ SortableContext に載せる） */
export function SortableChapterCard({
  chapter,
  chapterNumber,
  onEdit,
}: {
  chapter: SceneRecord;
  chapterNumber: number | undefined;
  onEdit: (chapter: SceneRecord) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("touch-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <ChapterCardContent
        chapter={chapter}
        chapterNumber={chapterNumber}
        onClick={() => onEdit(chapter)}
      />
    </div>
  );
}
