"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { BookMarked, Plus } from "lucide-react";

import {
  BOUNDARY_ANCHOR_BY_PART,
  PART_DESCRIPTION,
  PART_LABEL,
  type SceneRecord,
} from "@/lib/board";
import type { SceneKind, ScenePart } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnchorSlot } from "@/components/board/anchor-slot";
import { SortableChapterCard } from "@/components/board/chapter-card";
import { SortableSceneCard } from "@/components/board/scene-card";

/**
 * 4部構成のレーン（SPEC-beat-board §3.2）。
 * 通常カードの並び → 「＋追加」 → 境界アンカーの固定スロット、の順で描画する。
 * カード列にはシーンと章マーカーが混在する（章の位置＝章の始まり位置。SPEC-board-chapters §5.1）
 */
export function Lane({
  part,
  scenes,
  boundaryScene,
  sceneNumbers,
  chapterNumbers,
  noteCounts,
  emotionClampedIds,
  adding,
  onAdd,
  onEdit,
}: {
  part: ScenePart;
  /** このレーンの通常カード（境界アンカー付きを除く・構成順。章マーカーを含む） */
  scenes: SceneRecord[];
  /** レーン末尾スロットに固定する境界アンカー付きシーン */
  boundaryScene: SceneRecord | undefined;
  /** シーンID→ボード表示順の通し番号（1始まり。Issue #213） */
  sceneNumbers: Record<string, number>;
  /** カードID→所属章番号（章に属さないカードは null。SPEC-board-chapters §4） */
  chapterNumbers: Record<string, number | null>;
  /** シーンごとの紐づけノート件数（Issue #56） */
  noteCounts: Record<string, number>;
  /** 感情の起伏が上下限に達し、変化量を反映しきれないシーンのid（Issue #205） */
  emotionClampedIds: ReadonlySet<string>;
  adding: boolean;
  onAdd: (part: ScenePart, kind: SceneKind) => void;
  onEdit: (scene: SceneRecord) => void;
}) {
  // レーン自体もドロップ先にする（空レーンや末尾へのドロップ用。id = part 名）
  const { setNodeRef } = useDroppable({ id: part });
  const boundary = BOUNDARY_ANCHOR_BY_PART[part];

  // 先頭カードが前のレーンで始まった章に属するなら「つづき」を示す
  // （章は部をまたげるため。SPEC-board-chapters §5.1。カードではないので D&D の対象外）
  const first = scenes[0];
  const continuedChapter =
    first !== undefined && first.kind !== "chapter"
      ? chapterNumbers[first.id]
      : null;

  return (
    <section
      aria-label={`${PART_LABEL[part]}レーン`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2"
    >
      <header className="px-1">
        <h2 className="text-sm font-semibold text-foreground">
          {PART_LABEL[part]}
        </h2>
        <p className="text-xs text-muted-foreground">
          {PART_DESCRIPTION[part]}
        </p>
      </header>

      {continuedChapter !== null && (
        <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
          <BookMarked className="size-3" aria-hidden />第{continuedChapter}
          章のつづき
        </p>
      )}

      <SortableContext
        items={scenes.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
          {scenes.map((scene) =>
            scene.kind === "chapter" ? (
              <SortableChapterCard
                key={scene.id}
                chapter={scene}
                chapterNumber={chapterNumbers[scene.id] ?? undefined}
                onEdit={onEdit}
              />
            ) : (
              <SortableSceneCard
                key={scene.id}
                scene={scene}
                sceneNumber={sceneNumbers[scene.id]}
                noteCount={noteCounts[scene.id]}
                emotionClamped={emotionClampedIds.has(scene.id)}
                onEdit={onEdit}
              />
            ),
          )}
        </div>
      </SortableContext>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-muted-foreground"
              disabled={adding}
            >
              <Plus data-icon="inline-start" />
              追加
            </Button>
          }
        />
        {/* トリガー（「追加」）が狭く、既定幅（min-w-32）だと項目名が折り返すため広げる */}
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuItem onClick={() => onAdd(part, "scene")}>
            シーンを追加
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAdd(part, "chapter")}>
            章の区切りを追加
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {boundary && (
        <AnchorSlot
          anchor={boundary}
          scene={boundaryScene}
          sceneNumber={
            boundaryScene ? sceneNumbers[boundaryScene.id] : undefined
          }
          noteCount={boundaryScene ? noteCounts[boundaryScene.id] : undefined}
          emotionClamped={
            boundaryScene ? emotionClampedIds.has(boundaryScene.id) : false
          }
          onEdit={onEdit}
        />
      )}
    </section>
  );
}
