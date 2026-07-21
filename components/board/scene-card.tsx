"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BadgeCheck, Minus, MoveRight, Plus } from "lucide-react";

import { ANCHOR_BADGE, EMOTION_LABEL, type SceneRecord } from "@/lib/board";
import type { Emotion } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function EmotionIcon({ emotion }: { emotion: Emotion | null }) {
  if (emotion === "plus") return <Plus className="size-3 text-primary" aria-label={EMOTION_LABEL.plus} />;
  if (emotion === "minus")
    return <Minus className="size-3 text-muted-foreground" aria-label={EMOTION_LABEL.minus} />;
  return (
    <span className="text-[10px] leading-none text-muted-foreground" aria-label="未設定">
      ・
    </span>
  );
}

/** 感情バッジ（起点 → 終点。色ではなく ＋/− アイコンで表現し、色はテーマ変数のみ） */
function EmotionBadge({ scene }: { scene: SceneRecord }) {
  if (scene.emotion_start === null && scene.emotion_end === null) return null;
  return (
    <Badge variant="outline" className="gap-0.5" aria-label="感情の起伏">
      <EmotionIcon emotion={scene.emotion_start} />
      <MoveRight className="size-3 text-muted-foreground" aria-hidden />
      <EmotionIcon emotion={scene.emotion_end} />
    </Badge>
  );
}

/** シーンカードの見た目（通常カード・境界スロット内・DragOverlay で共用） */
export function SceneCardContent({
  scene,
  onClick,
}: {
  scene: SceneRecord;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`シーンを編集: ${scene.title || "無題"}`}
      className="flex w-full flex-col gap-1 rounded-md border border-border bg-card p-2 text-left shadow-xs transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="text-sm font-medium text-card-foreground">{scene.title || "（無題）"}</span>
      {scene.content !== "" && (
        <p className="line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {scene.content}
        </p>
      )}
      {(scene.anchor !== null ||
        scene.emotion_start !== null ||
        scene.emotion_end !== null ||
        scene.status === "approved") && (
        <span className="flex flex-wrap gap-1">
          {scene.anchor !== null && <Badge variant="secondary">{ANCHOR_BADGE[scene.anchor]}</Badge>}
          <EmotionBadge scene={scene} />
          {/* シーンレビューのゲート状態（Issue #57） */}
          {scene.status === "approved" && (
            <Badge variant="outline" aria-label="シーンレビュー承認済み">
              <BadgeCheck data-icon="inline-start" />
              承認済み
            </Badge>
          )}
        </span>
      )}
    </button>
  );
}

/** レーン内でドラッグできるシーンカード（境界アンカー付きはスロット側で固定表示する） */
export function SortableSceneCard({
  scene,
  onEdit,
}: {
  scene: SceneRecord;
  onEdit: (scene: SceneRecord) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("touch-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <SceneCardContent scene={scene} onClick={() => onEdit(scene)} />
    </div>
  );
}
