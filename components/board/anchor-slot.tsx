"use client";

import { Pin } from "lucide-react";

import { ANCHOR_LABEL, type SceneRecord } from "@/lib/board";
import type { SceneAnchor } from "@/lib/schemas/enums";
import { SceneCardContent } from "@/components/board/scene-card";

/**
 * 境界アンカー（PP1・ミッドポイント等、テンプレートの【アンカー】転換点）の固定スロット
 * （SPEC-beat-board §3.2・SPEC-structure-templates §3）。
 * レーン末尾に常時表示し、未設定時はプレースホルダーで「まだ決まっていない転換点」を可視化する。
 * アンカー付きシーンはドラッグ不可（外すには編集ダイアログでアンカーを解除する）
 */
export function AnchorSlot({
  anchor,
  scene,
  noteCount,
  emotionClamped,
  onEdit,
}: {
  anchor: SceneAnchor;
  scene: SceneRecord | undefined;
  noteCount?: number;
  /** 感情の起伏が上下限に達し、変化量を反映しきれない（Issue #205） */
  emotionClamped?: boolean;
  onEdit: (scene: SceneRecord) => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-border p-1.5">
      <span className="flex items-center gap-1 px-0.5 text-xs text-muted-foreground">
        <Pin className="size-3" aria-hidden />
        {ANCHOR_LABEL[anchor]}
        {!scene && "（未設定）"}
      </span>
      {scene && (
        <SceneCardContent
          scene={scene}
          noteCount={noteCount}
          emotionClamped={emotionClamped}
          onClick={() => onEdit(scene)}
        />
      )}
    </div>
  );
}
