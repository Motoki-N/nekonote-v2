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

import type { LinkedNote } from "@/lib/actions/projects";
import { approveBoardReview } from "@/lib/actions/review";
import {
  attachSceneNote,
  createScene,
  deleteScene,
  detachSceneNote,
  duplicateScene,
  reorderScenes,
  switchStructureTemplate,
  updateScene,
} from "@/lib/actions/scenes";
import {
  BOUNDARY_ANCHOR_BY_PART,
  findTurningPointOrderViolation,
  isBoundaryAnchor,
  normalizeAnchor,
  toCanonicalOrder,
  turningPointOrderMessage,
  type SceneRecord,
} from "@/lib/board";
import { BOARD_TEMPLATES, boardTemplateList } from "@/lib/board-templates";
import type { ApprovalStatus, ScenePart, StructureTemplate } from "@/lib/schemas/enums";
import type { SceneEdit } from "@/lib/schemas/projects";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  initialLinkedNotes,
  structureStatus,
  structureTemplate,
}: {
  projectId: string;
  initialScenes: SceneRecord[];
  /** シーンごとの紐づけノート（Issue #56。ごみ箱中はサーバー側で除外済み） */
  initialLinkedNotes: Record<string, LinkedNote[]>;
  /** 構成レビューのゲート状態（projects.structure_status。Issue #57） */
  structureStatus: ApprovalStatus;
  /** 構成テンプレート（projects.structure_template。Issue #54） */
  structureTemplate: StructureTemplate;
}) {
  const router = useRouter();
  const [scenes, setScenes] = useState<SceneRecord[]>(() => toCanonicalOrder(initialScenes));
  // 切替確定の楽観的反映（structureApproved と同じ理由で props と別に持つ）
  const [template, setTemplate] = useState<StructureTemplate>(structureTemplate);
  // セレクトで選ばれた切替先（確認ダイアログ表示中。null = ダイアログ非表示）
  const [pendingTemplate, setPendingTemplate] = useState<StructureTemplate | null>(null);
  const [switching, setSwitching] = useState(false);
  const templateDef = BOARD_TEMPLATES[template];
  const [notesMap, setNotesMap] = useState<Record<string, LinkedNote[]>>(initialLinkedNotes);
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

  // ビートボードに描画する小説シーンのみ（chapter=目次ボードの章カードは枚数・感情線に含めない。
  // state には全件を保持し、並べ替え保存の全件送信で章カードを保全する。SPEC-outline-board §4）
  const novelScenes = useMemo(() => scenes.filter((s) => s.part !== "chapter"), [scenes]);

  const noteCounts = useMemo(
    () =>
      Object.fromEntries(Object.entries(notesMap).map(([sceneId, notes]) => [sceneId, notes.length])),
    [notesMap],
  );

  /** over 先のレーンを解決する（レーン id か、レーン内カードの id）。
   * chapter カード（目次ボード）はビートボードに描画されないため実際には到達しない */
  function resolveLane(overId: string): ScenePart | null {
    if (templateDef.lanes.some((lane) => lane.id === overId)) return overId as ScenePart;
    const part = scenes.find((s) => s.id === overId)?.part;
    return part && part !== "chapter" ? part : null;
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

    // 転換点の並び順制約（SPEC-structure-templates §5）: 違反ドロップはロールバックして保存しない
    const violation = findTurningPointOrderViolation(next, template);
    if (violation) {
      if (before) setScenes(before);
      toast.error(turningPointOrderMessage(violation));
      return;
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

  /** テンプレート切替の確定（Issue #54）。確認ダイアログの「切り替える」から呼ばれる */
  async function handleSwitchTemplate(next: StructureTemplate) {
    if (switching) return;
    setSwitching(true);
    try {
      const result = await switchStructureTemplate(projectId, next);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "テンプレートの切替に失敗しました" : result.error.message);
        return;
      }
      setScenes(result.data.scenes);
      setTemplate(next);
      // 構成が丸ごと変わるため承認はサーバー側で draft に戻している（ローカルも同期）
      setStructureApproved(false);
      setPendingTemplate(null);
      toast(`構成テンプレートを「${BOARD_TEMPLATES[next].label}」に切り替えました`);
      router.refresh();
    } finally {
      setSwitching(false);
    }
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

  /** ノート紐づけ（Issue #56）。シーン本体の保存とは独立に即時保存する */
  async function handleAttachNote(sceneId: string, note: LinkedNote) {
    const result = await attachSceneNote(sceneId, note.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setNotesMap((prev) => {
      const current = prev[sceneId] ?? [];
      if (current.some((n) => n.id === note.id)) return prev;
      return { ...prev, [sceneId]: [...current, note] };
    });
  }

  async function handleDetachNote(sceneId: string, noteId: string) {
    const result = await detachSceneNote(sceneId, noteId);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setNotesMap((prev) => ({
      ...prev,
      [sceneId]: (prev[sceneId] ?? []).filter((n) => n.id !== noteId),
    }));
  }

  /** 複製（Issue #154）。サーバーで元シーンの直後に複製し、正準順序の全件で置き換える */
  async function handleDuplicate(sceneId: string): Promise<boolean> {
    const result = await duplicateScene(sceneId);
    if (!result.ok || !result.data) {
      toast.error(result.ok ? "シーンの複製に失敗しました" : result.error.message);
      return false;
    }
    setScenes(result.data.scenes);
    toast("シーンを複製しました");
    return true;
  }

  /** 前後シーン移動（Issue #171）。クリック時点のボード表示順（章カード除く）で隣のシーンを開く。
   * ダイアログ側で保存(await)してから呼ばれるが、保存で並びが変わっても「ユーザーが見ていた並び」
   * での隣に移動するのが自然なため、クリック時レンダーの novelScenes をそのまま使う */
  function handleNavigate(direction: "prev" | "next") {
    if (!editing) return;
    const index = novelScenes.findIndex((s) => s.id === editing.id);
    if (index === -1) return;
    const target = novelScenes[direction === "prev" ? index - 1 : index + 1];
    if (target) setEditing(target);
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

  // 編集中シーンのボード表示順での位置（前後シーン移動ボタンの活性判定。Issue #171）
  const editingIndex = editing ? novelScenes.findIndex((s) => s.id === editing.id) : -1;

  return (
    <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            構成テンプレート
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={template}
              disabled={switching}
              onChange={(e) => {
                const next = e.target.value as StructureTemplate;
                if (next !== template) setPendingTemplate(next);
              }}
            >
              {boardTemplateList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-muted-foreground">シーン {novelScenes.length}枚</span>
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
            構成レビュー
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
            {templateDef.lanes.map((lane) => {
              const part = lane.id;
              const boundary = BOUNDARY_ANCHOR_BY_PART[part];
              const laneScenes = scenes.filter((s) => s.part === part);
              return (
                <Lane
                  key={part}
                  part={part}
                  scenes={laneScenes.filter((s) => !(boundary && s.anchor === boundary))}
                  boundaryScene={boundary ? laneScenes.find((s) => s.anchor === boundary) : undefined}
                  noteCounts={noteCounts}
                  adding={adding}
                  onAdd={(p) => void handleAdd(p)}
                  onEdit={setEditing}
                />
              );
            })}
          </div>
          <DragOverlay>
            {activeScene && !isBoundaryAnchor(activeScene.anchor) ? (
              <SceneCardContent scene={activeScene} noteCount={noteCounts[activeScene.id]} />
            ) : null}
          </DragOverlay>
        </DndContext>

        <EmotionLine scenes={novelScenes} />
      </main>

      {/* key は兄弟間（パネル2種＋ダイアログ）で衝突しないようプレフィックスを付ける
          （editing.id と review.scene.id が同一シーンだと key 重複で React の差分計算が壊れる） */}
      {review?.kind === "structure" && (
        <ReviewPanel
          key={`review-structure-${projectId}`}
          kind="structure"
          targetId={projectId}
          title="構成レビュー"
          emptyText={`「${templateDef.label}」の観点で、担当編集がボード全体（シーン構成と企画書）を見ます。承認が出るまで、指摘 → 改稿 → 再レビューを繰り返します。`}
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

      {/* テンプレート切替の確認（Issue #54。破壊的変更のため必ず確認を挟む） */}
      <AlertDialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => !open && setPendingTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              構成テンプレートを「
              {pendingTemplate ? BOARD_TEMPLATES[pendingTemplate].label : ""}」に切り替えますか？
            </AlertDialogTitle>
            <AlertDialogDescription>
              全シーンは新テンプレートの先頭レーン「
              {pendingTemplate ? BOARD_TEMPLATES[pendingTemplate].lanes[0].label : ""}
              」に移動し、転換点マークはすべて解除されます。構成の承認状態もリセットされます。
              シーンのタイトル・本文・感情・ノート紐づけは保持されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={switching}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={switching}
              onClick={(e) => {
                // 確定はサーバー保存の完了を待ってから閉じる（失敗時はダイアログを残す）
                e.preventDefault();
                if (pendingTemplate) void handleSwitchTemplate(pendingTemplate);
              }}
            >
              切り替える
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        <SceneDialog
          key={`dialog-${editing.id}`}
          scene={editing}
          structureTemplate={template}
          allScenes={scenes}
          linkedNotes={notesMap[editing.id] ?? []}
          onAttachNote={(note) => handleAttachNote(editing.id, note)}
          onDetachNote={(noteId) => handleDetachNote(editing.id, noteId)}
          onSave={handleSave}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          hasPrev={editingIndex > 0}
          hasNext={editingIndex !== -1 && editingIndex < novelScenes.length - 1}
          onNavigate={handleNavigate}
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
