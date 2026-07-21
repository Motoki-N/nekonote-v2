"use client";

import { Pin } from "lucide-react";

import { ANCHOR_LABEL, type BoundaryAnchor, type SceneRecord } from "@/lib/board";
import { SceneCardContent } from "@/components/board/scene-card";

/**
 * 境界アンカー（PP1・ミッドポイント・PP2）の固定スロット（SPEC-beat-board §3.2）。
 * レーン末尾に常時表示し、未設定時はプレースホルダーで「まだ決まっていない転換点」を可視化する。
 * アンカー付きシーンはドラッグ不可（外すには編集ダイアログでアンカーを解除する）
 */
export function AnchorSlot({
  anchor,
  scene,
  noteCount,
  onEdit,
}: {
  anchor: BoundaryAnchor;
  scene: SceneRecord | undefined;
  noteCount?: number;
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
        <SceneCardContent scene={scene} noteCount={noteCount} onClick={() => onEdit(scene)} />
      )}
    </div>
  );
}
