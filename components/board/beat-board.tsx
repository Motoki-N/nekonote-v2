"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { BadgeCheck, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { approveBoardReview } from "@/lib/actions/review";
import { createScene, deleteScene, reorderScenes, updateScene } from "@/lib/actions/scenes";
import {
  BOUNDARY_ANCHOR_BY_PART,
  isBoundaryAnchor,
  normalizeAnchor,
  toCanonicalOrder,
  type SceneRecord,
} from "@/lib/board";
import { sceneParts, type ApprovalStatus, type ScenePart } from "@/lib/schemas/enums";
import type { SceneEdit } from "@/lib/schemas/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmotionLine } from "@/components/board/emotion-line";
import { Lane } from "@/components/board/lane";
import { SceneCardContent } from "@/components/board/scene-card";
import { SceneDialog } from "@/components/board/scene-dialog";
import { ReviewPanel } from "@/components/review/review-panel";

type ReviewTarget = { kind: "structure" } | { kind: "scene"; scene: SceneRecord };

/** 2つの並びが同じか（id・part の列として比較。差がなければ保存しない） */
function sameOrder(a: SceneRecord[], b: SceneRecord[]): boolean {
  return (
    a.length === b.length && a.every((s, i) => s.id === b[i].id && s.part === b[i].part)
  );
}

/**
 * ビートボード（SPEC-beat-board §3.2）。
 * 4レーン（設定・反応・攻撃・解決）のカンバン型ボード。scenes は常に正準順序
 * （パート順の通し番号・境界アンカーはレーン末尾）で保持する
 */
export function BeatBoard({
  projectId,
  initialScenes,
  structureStatus,
}: {
  projectId: string;
  initialScenes: SceneRecord[];
  /** 構成レビューのゲート状態（projects.structure_status。Issue #57） */
  structureStatus: ApprovalStatus;
}) {
  const router = useRouter();
  const [scenes, setScenes] = useState<SceneRecord[]>(() => toCanonicalOrder(initialScenes));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SceneRecord | null>(null);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const [adding, setAdding] = useState(false);
  // 「通す」確定の楽観的反映（サーバー確定後に setState。router.refresh は props に効かないため）
  const [structureApproved, setStructureApproved] = useState(structureStatus === "approved");
  const [approving, setApproving] = useState(false);
  // ドラッグ開始時点の状態（キャンセル・保存失敗時のロールバック先）
  const snapshotRef = useRef<SceneRecord[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeScene = useMemo(
    () => (activeId ? scenes.find((s) => s.id === activeId) : undefined),
    [activeId, scenes],
  );

  /** over 先のレーンを解決する（レーン id か、レーン内カードの id） */
  function resolveLane(overId: string): ScenePart | null {
    if ((sceneParts as readonly string[]).includes(overId)) return overId as ScenePart;
    return scenes.find((s) => s.id === overId)?.part ?? null;
  }

  function handleDragStart(event: DragStartEvent) {
    snapshotRef.current = scenes;
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeSceneId = String(active.id);
    const current = scenes.find((s) => s.id === activeSceneId);
    const overLane = resolveLane(String(over.id));
    if (!current || !overLane || current.part === overLane) return;

    // レーン間移動: over がカードならその位置へ、レーンなら末尾へ差し込む
    setScenes((prev) => {
      const moving = prev.find((s) => s.id === activeSceneId);
      if (!moving) return prev;
      const rest = prev.filter((s) => s.id !== activeSceneId);
      const moved: SceneRecord = {
        ...moving,
        part: overLane,
        // レーンをまたいだピンチ等のアンカーは外れる（サーバー側の正規化と同じ規則）
        anchor: normalizeAnchor(moving.anchor, overLane),
      };
      const overIndex = rest.findIndex((s) => s.id === String(over.id));
      const next =
        overIndex === -1
          ? [...rest, moved]
          : [...rest.slice(0, overIndex), moved, ...rest.slice(overIndex)];
      return toCanonicalOrder(next);
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    const before = snapshotRef.current;
    snapshotRef.current = null;

    let next = scenes;
    if (over && over.id !== active.id) {
      const from = scenes.findIndex((s) => s.id === String(active.id));
      const to = scenes.findIndex((s) => s.id === String(over.id));
      // 同一レーン内の並び替え（正準順序ではレーンのカードは連続しているため arrayMove が成立）
      if (from !== -1 && to !== -1 && scenes[from].part === scenes[to].part) {
        next = toCanonicalOrder(arrayMove(scenes, from, to));
        setScenes(next);
      }
    }

    // ドロップ確定: 楽観的更新は済んでいるので、差分があればサーバーへ一括保存
    if (!before || sameOrder(before, next)) return;
    void reorderScenes(
      projectId,
      next.map((s) => ({ id: s.id, part: s.part })),
    ).then((result) => {
      if (!result.ok) {
        setScenes(before); // ロールバック
        toast.error(result.error.message);
      }
      // 成功時は何もしない: クライアントも同じ正準化関数を通しているため保存結果と一致する
    });
  }

  function handleDragCancel() {
    if (snapshotRef.current) setScenes(snapshotRef.current);
    snapshotRef.current = null;
    setActiveId(null);
  }

  async function handleAdd(part: ScenePart) {
    if (adding) return;
    setAdding(true);
    try {
      const result = await createScene(projectId, part);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "シーンの追加に失敗しました" : result.error.message);
        return;
      }
      setScenes(result.data.scenes);
      const created = result.data.scenes.find((s) => s.id === result.data?.createdId);
      if (created) setEditing(created); // 追加したらすぐ編集ダイアログを開く
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(sceneId: string, edit: SceneEdit): Promise<boolean> {
    const result = await updateScene(sceneId, edit);
    if (!result.ok || !result.data) {
      toast.error(result.ok ? "シーンの保存に失敗しました" : result.error.message);
      return false;
    }
    setScenes(result.data.scenes);
    return true;
  }

  /** 「通す」確定（Issue #57）。サーバー検証成功後にゲート状態をローカルへ反映する */
  async function handleApprove(sessionId: string, target: ReviewTarget) {
    if (approving) return;
    setApproving(true);
    try {
      const result = await approveBoardReview(sessionId);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (target.kind === "structure") {
        setStructureApproved(true);
        toast("構成が通りました！シーンの執筆に進みましょう");
      } else {
        setScenes((prev) =>
          prev.map((s) => (s.id === target.scene.id ? { ...s, status: "approved" } : s)),
        );
        toast("シーンが通りました！");
      }
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  async function handleDelete(sceneId: string): Promise<boolean> {
    const result = await deleteScene(sceneId);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    setScenes((prev) => prev.filter((s) => s.id !== sceneId));
    // 削除したシーンのレビューパネルが開いていたら閉じる（セッションは履歴ごと削除済み）
    setReview((prev) => (prev?.kind === "scene" && prev.scene.id === sceneId ? null : prev));
    toast("シーンを削除しました");
    return true;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">シーン {scenes.length}枚</span>
          {structureApproved && (
            <Badge variant="secondary">
              <BadgeCheck data-icon="inline-start" />
              構成承認済み
            </Badge>
          )}
          <Button
            variant={review?.kind === "structure" ? "secondary" : "outline"}
            size="sm"
            className="ml-auto"
            aria-pressed={review?.kind === "structure"}
            onClick={() =>
              setReview((prev) => (prev?.kind === "structure" ? null : { kind: "structure" }))
            }
          >
            <ClipboardCheck data-icon="inline-start" />
            構成レビューを受ける
          </Button>
        </div>

        <DndContext
          id="beat-board-dnd" // SSRとクライアントで一致させる（未指定だと useId 由来の aria 属性が hydration ミスマッチになる）
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {sceneParts.map((part) => {
              const boundary = BOUNDARY_ANCHOR_BY_PART[part];
              const laneScenes = scenes.filter((s) => s.part === part);
              return (
                <Lane
                  key={part}
                  part={part}
                  scenes={laneScenes.filter((s) => !(boundary && s.anchor === boundary))}
                  boundaryScene={boundary ? laneScenes.find((s) => s.anchor === boundary) : undefined}
                  adding={adding}
                  onAdd={(p) => void handleAdd(p)}
                  onEdit={setEditing}
                />
              );
            })}
          </div>
          <DragOverlay>
            {activeScene && !isBoundaryAnchor(activeScene.anchor) ? (
              <SceneCardContent scene={activeScene} />
            ) : null}
          </DragOverlay>
        </DndContext>

        <EmotionLine scenes={scenes} />
      </main>

      {/* key は兄弟間（パネル2種＋ダイアログ）で衝突しないようプレフィックスを付ける
          （editing.id と review.scene.id が同一シーンだと key 重複で React の差分計算が壊れる） */}
      {review?.kind === "structure" && (
        <ReviewPanel
          key={`review-structure-${projectId}`}
          kind="structure"
          targetId={projectId}
          title="構成レビュー"
          emptyText="4部構成・5転換点の観点で、担当編集がボード全体（シーン構成と企画書）を見ます。承認が出るまで、指摘 → 改稿 → 再レビューを繰り返します。"
          showVerdict
          onClose={() => setReview(null)}
          renderFooter={({ latestVerdict, busy, sessionId }) => {
            if (latestVerdict === "approved" && !structureApproved && !busy && sessionId !== null) {
              return (
                <Button
                  onClick={() => void handleApprove(sessionId, { kind: "structure" })}
                  disabled={approving}
                >
                  <BadgeCheck data-icon="inline-start" />
                  構成を通す
                </Button>
              );
            }
            if (structureApproved) {
              return (
                <p className="text-center text-xs text-muted-foreground">
                  この構成は承認済みです。再審査したいときは、もう一度レビューを受けてください
                </p>
              );
            }
            return null;
          }}
        />
      )}
      {review?.kind === "scene" && (
        <ReviewPanel
          key={`review-scene-${review.scene.id}`}
          kind="scene"
          targetId={review.scene.id}
          title="シーンレビュー"
          subtitle={review.scene.title || "（無題）"}
          emptyText="対象シーンを4観点（シチュエーション・出来事・感情の変化・葛藤）で見ます。承認が出るまで、指摘 → 改稿 → 再レビューを繰り返します。"
          showVerdict
          onClose={() => setReview(null)}
          renderFooter={({ latestVerdict, busy, sessionId }) => {
            // review.scene は開いた時点のスナップショットなので、最新の承認状態は scenes から引く
            const target = review;
            const approved =
              scenes.find((s) => s.id === target.scene.id)?.status === "approved";
            if (latestVerdict === "approved" && !approved && !busy && sessionId !== null) {
              return (
                <Button
                  onClick={() => void handleApprove(sessionId, target)}
                  disabled={approving}
                >
                  <BadgeCheck data-icon="inline-start" />
                  シーンを通す
                </Button>
              );
            }
            if (approved) {
              return (
                <p className="text-center text-xs text-muted-foreground">
                  このシーンは承認済みです。再審査したいときは、もう一度レビューを受けてください
                </p>
              );
            }
            return null;
          }}
        />
      )}

      {editing && (
        <SceneDialog
          key={`dialog-${editing.id}`}
          scene={editing}
          allScenes={scenes}
          onSave={handleSave}
          onDelete={handleDelete}
          onReview={(scene) => {
            setEditing(null);
            setReview({ kind: "scene", scene });
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
