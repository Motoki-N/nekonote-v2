"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import {
  BOUNDARY_ANCHOR_BY_PART,
  PART_DESCRIPTION,
  PART_LABEL,
  type SceneRecord,
} from "@/lib/board";
import type { ScenePart } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import { AnchorSlot } from "@/components/board/anchor-slot";
import { SortableSceneCard } from "@/components/board/scene-card";

/**
 * 4部構成のレーン（SPEC-beat-board §3.2）。
 * 通常カードの並び → 「＋シーンを追加」 → 境界アンカーの固定スロット、の順で描画する
 */
export function Lane({
  part,
  scenes,
  boundaryScene,
  adding,
  onAdd,
  onEdit,
}: {
  part: ScenePart;
  /** このレーンの通常カード（境界アンカー付きを除く・構成順） */
  scenes: SceneRecord[];
  /** レーン末尾スロットに固定する境界アンカー付きシーン */
  boundaryScene: SceneRecord | undefined;
  adding: boolean;
  onAdd: (part: ScenePart) => void;
  onEdit: (scene: SceneRecord) => void;
}) {
  // レーン自体もドロップ先にする（空レーンや末尾へのドロップ用。id = part 名）
  const { setNodeRef } = useDroppable({ id: part });
  const boundary = BOUNDARY_ANCHOR_BY_PART[part];

  return (
    <section
      aria-label={`${PART_LABEL[part]}レーン`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2"
    >
      <header className="px-1">
        <h2 className="text-sm font-semibold text-foreground">{PART_LABEL[part]}</h2>
        <p className="text-xs text-muted-foreground">{PART_DESCRIPTION[part]}</p>
      </header>

      <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
          {scenes.map((scene) => (
            <SortableSceneCard key={scene.id} scene={scene} onEdit={onEdit} />
          ))}
        </div>
      </SortableContext>

      <Button
        variant="ghost"
        size="sm"
        className="justify-start text-muted-foreground"
        disabled={adding}
        onClick={() => onAdd(part)}
      >
        <Plus data-icon="inline-start" />
        シーンを追加
      </Button>

      {boundary && <AnchorSlot anchor={boundary} scene={boundaryScene} onEdit={onEdit} />}
    </section>
  );
}
