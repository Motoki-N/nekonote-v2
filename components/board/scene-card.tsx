"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  FileText,
  Minus,
  StickyNote,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { ANCHOR_BADGE, formatEmotion, type SceneRecord } from "@/lib/board";
import type { Emotion } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 感情の変化バッジ（Issue #205。そのシーンでの増減を単一値で表す）。
 * 色はテーマ変数のみ。起伏の上下限に達して変化を反映しきれない場合は警告色にする
 */
function EmotionBadge({
  emotion,
  clamped,
}: {
  emotion: Emotion | null;
  clamped: boolean;
}) {
  if (emotion === null) return null;
  const text = formatEmotion(emotion);
  // 増減の向きは色に頼らずアイコンでも示す（テーマ非依存のアクセシビリティ配慮）
  const Icon = emotion > 0 ? TrendingUp : emotion < 0 ? TrendingDown : Minus;
  return (
    <Badge
      variant="outline"
      className={cn("gap-0.5", clamped && "border-destructive")}
      aria-label={
        clamped
          ? `感情の変化 ${text}（感情の起伏が上下限に達しているため反映されません）`
          : `感情の変化 ${text}`
      }
      title={
        clamped
          ? "感情の起伏が上下限に達しているため、この変化は反映されません"
          : undefined
      }
    >
      <Icon className="size-3 text-muted-foreground" aria-hidden />
      <span
        className={cn(
          "text-[11px] leading-none font-medium tabular-nums",
          clamped
            ? "text-destructive"
            : emotion > 0
              ? "text-primary"
              : "text-muted-foreground",
        )}
      >
        {text}
      </span>
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
  sceneNumber,
  noteCount = 0,
  emotionClamped = false,
  onClick,
}: {
  scene: SceneRecord;
  /**
   * ボード表示順の通し番号（1始まり。Issue #213）。
   * シーン自身の属性ではなく並び順から算出する値のため、省略時は表示しない（目次ボード・DragOverlay）
   */
  sceneNumber?: number;
  /** 紐づけノート件数（Issue #56） */
  noteCount?: number;
  /** 感情の起伏が上下限に達し、このシーンの変化量を反映しきれない（Issue #205） */
  emotionClamped?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        sceneNumber === undefined
          ? `シーンを編集: ${scene.title || "無題"}`
          : `シーンを編集: ${sceneNumber}番目 ${scene.title || "無題"}`
      }
      className="flex w-full flex-col gap-1 rounded-md border border-border bg-card p-2 text-left shadow-xs transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex items-baseline gap-1.5">
        {sceneNumber !== undefined && (
          <span
            className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground"
            aria-hidden
          >
            {sceneNumber}
          </span>
        )}
        <span className="text-sm font-medium text-card-foreground">
          {scene.title || "（無題）"}
        </span>
      </span>
      {scene.content !== "" && (
        <p className="line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {scene.content}
        </p>
      )}
      {(scene.anchor !== null ||
        scene.emotion_delta !== null ||
        scene.status === "approved" ||
        scene.manuscript_path !== null ||
        noteCount > 0) && (
        <span className="flex flex-wrap gap-1">
          {scene.anchor !== null && (
            <Badge variant="secondary">{ANCHOR_BADGE[scene.anchor]}</Badge>
          )}
          <EmotionBadge
            emotion={scene.emotion_delta}
            clamped={emotionClamped}
          />
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
  sceneNumber,
  noteCount,
  emotionClamped,
  onEdit,
}: {
  scene: SceneRecord;
  /** ボード表示順の通し番号（1始まり。Issue #213） */
  sceneNumber?: number;
  noteCount?: number;
  emotionClamped?: boolean;
  onEdit: (scene: SceneRecord) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
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
      <SceneCardContent
        scene={scene}
        sceneNumber={sceneNumber}
        noteCount={noteCount}
        emotionClamped={emotionClamped}
        onClick={() => onEdit(scene)}
      />
    </div>
  );
}
