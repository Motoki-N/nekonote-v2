"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { BadgeCheck, FileText, MoveRight, StickyNote } from "lucide-react";

import { ANCHOR_BADGE, formatEmotion, type SceneRecord } from "@/lib/board";
import type { Emotion } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function EmotionIcon({ emotion }: { emotion: Emotion | null }) {
  if (emotion === null) {
    return (
      <span className="text-[10px] leading-none text-muted-foreground" aria-label="未設定">
        ・
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-[11px] leading-none font-medium tabular-nums",
        emotion > 0 ? "text-primary" : "text-muted-foreground",
      )}
      aria-label={`感情 ${formatEmotion(emotion)}`}
    >
      {formatEmotion(emotion)}
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

/**
 * 紐づけ原稿バッジ（Issue #56）。クリックでエディタの該当ファイルへ。
 * カード全体が <button>（<a> をネストできない）ため role="link" の span で実装する
 */
function ManuscriptBadge({ scene }: { scene: SceneRecord }) {
  const router = useRouter();
  if (scene.manuscript_path === null) return null;
  const href = `/projects/${scene.project_id}/editor?file=${encodeURIComponent(scene.manuscript_path)}`;
  const open = (e: React.SyntheticEvent) => {
    e.stopPropagation(); // カードの編集ダイアログを開かせない
    router.push(href);
  };
  return (
    <Badge
      variant="outline"
      role="link"
      tabIndex={0}
      aria-label={`原稿をエディタで開く: ${scene.manuscript_path}`}
      className="cursor-pointer hover:bg-accent hover:text-accent-foreground"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open(e);
      }}
    >
      <FileText data-icon="inline-start" />
      原稿
    </Badge>
  );
}

/** シーンカードの見た目（通常カード・境界スロット内・DragOverlay で共用） */
export function SceneCardContent({
  scene,
  noteCount = 0,
  onClick,
}: {
  scene: SceneRecord;
  /** 紐づけノート件数（Issue #56） */
  noteCount?: number;
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
        scene.status === "approved" ||
        scene.manuscript_path !== null ||
        noteCount > 0) && (
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
          {/* 紐づけ（Issue #56） */}
          <ManuscriptBadge scene={scene} />
          {noteCount > 0 && (
            <Badge variant="outline" aria-label={`紐づけノート ${noteCount}件`}>
              <StickyNote data-icon="inline-start" />
              {noteCount}
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
  noteCount,
  onEdit,
}: {
  scene: SceneRecord;
  noteCount?: number;
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
      <SceneCardContent scene={scene} noteCount={noteCount} onClick={() => onEdit(scene)} />
    </div>
  );
}
