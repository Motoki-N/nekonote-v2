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
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  ClipboardCheck,
  FilePlus,
  ListPlus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import type { GenerateManuscriptsResult } from "@/lib/actions/manuscript-generate";
import { approveBoardReview } from "@/lib/actions/review";
import {
  applyOutlineTemplate,
  createScene,
  deleteScene,
  reorderScenes,
  updateScene,
} from "@/lib/actions/scenes";
import { toCanonicalOrder, type SceneRecord } from "@/lib/board";
import {
  OUTLINE_TEMPLATE,
  outlineTemplateKeys,
  type OutlineTemplateKey,
} from "@/lib/constants/outline-template";
import type { ApprovalStatus } from "@/lib/schemas/enums";
import type { SceneEdit } from "@/lib/schemas/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChapterCardContent,
  SortableChapterCard,
} from "@/components/board/chapter-card";
import { ChapterDialog } from "@/components/board/chapter-dialog";
import { GenerateManuscriptsDialog } from "@/components/board/generate-manuscripts-dialog";
import { ReviewPanel } from "@/components/review/review-panel";

/** 2つの並びが同じか（id・part の列として比較。差がなければ保存しない） */
function sameOrder(a: SceneRecord[], b: SceneRecord[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.id === b[i].id && s.part === b[i].part)
  );
}

/**
 * 目次ボード（SPEC-outline-board §3.2）。非小説ジャンル（技術書・その他）の構成設計。
 * 章（kind='chapter'）を1列に並べるシンプルな目次作成機能。
 * state にはプロジェクトの全 scenes を保持し（描画は章のみ）、並べ替え保存は
 * 全件送信する——これで小説シーンが混在していても reorderScenes の完全一致検証を通り、
 * 相手ビューのカードが保全される（SPEC-outline-board §4）
 */
export function OutlineBoard({
  projectId,
  initialScenes,
  structureStatus,
}: {
  projectId: string;
  initialScenes: SceneRecord[];
  /** 構成レビューのゲート状態（projects.structure_status。ビートボードと共通） */
  structureStatus: ApprovalStatus;
}) {
  const router = useRouter();
  const [scenes, setScenes] = useState<SceneRecord[]>(() =>
    toCanonicalOrder(initialScenes),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SceneRecord | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [structureApproved, setStructureApproved] = useState(
    structureStatus === "approved",
  );
  const [approving, setApproving] = useState(false);
  // 原稿ファイル生成ダイアログ（Issue #223）。null = 非表示、[] = 未紐づけ全件、[id] = 単体
  const [generating, setGenerating] = useState<string[] | null>(null);
  // ドラッグ開始時点の状態（キャンセル・保存失敗時のロールバック先）
  const snapshotRef = useRef<SceneRecord[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 目次ボードに描画する章のみ（小説シーンは state に保持しつつ非表示）。
  // kind で絞ることで、ビートボードで作った章マーカーもそのまま目次に並ぶ
  // （ジャンルを小説から切り替えたプロジェクト。SPEC-board-chapters §5.2）
  const chapters = useMemo(
    () => scenes.filter((s) => s.kind === "chapter"),
    [scenes],
  );
  const activeScene = useMemo(
    () => (activeId ? chapters.find((s) => s.id === activeId) : undefined),
    [activeId, chapters],
  );

  // 原稿ファイルの紐づき状況（ヘッダ集計とCTAバー。SPEC-manuscript-bridge §4.1。
  // 件数はDBの manuscript_path から数えるだけで、GitHub API 呼び出しは増えない）
  const linkedCount = useMemo(
    () => chapters.filter((s) => s.manuscript_path !== null).length,
    [chapters],
  );
  // CTAバーの件数は「一括生成が実際に対象にする行」＝プロジェクトの全未紐づけ行で数える
  // （小説シーンが同居しているとき、描画分の章だけで数えると実際の件数とずれる）
  const unlinkedCount = useMemo(
    () => scenes.filter((s) => s.manuscript_path === null).length,
    [scenes],
  );

  function handleDragStart(event: DragStartEvent) {
    snapshotRef.current = scenes;
    setActiveId(String(event.active.id));
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
      // 同一レーン内でのみ入れ替える。正準順序では同じ part のカードが連続しているため
      // arrayMove が成立する（純粋な目次プロジェクトは全件 part='chapter' なので現状と同挙動。
      // 小説レーンの章マーカーが混ざったときだけ効く安全弁。SPEC-board-chapters §5.2）
      if (from !== -1 && to !== -1 && scenes[from].part === scenes[to].part) {
        next = toCanonicalOrder(arrayMove(scenes, from, to));
        setScenes(next);
      }
    }

    if (!before || sameOrder(before, next)) return;
    void reorderScenes(
      projectId,
      next.map((s) => ({ id: s.id, part: s.part })),
    ).then((result) => {
      if (!result.ok) {
        setScenes(before); // ロールバック
        toast.error(result.error.message);
      }
    });
  }

  function handleDragCancel() {
    if (snapshotRef.current) setScenes(snapshotRef.current);
    snapshotRef.current = null;
    setActiveId(null);
  }

  async function handleAdd() {
    if (adding) return;
    setAdding(true);
    try {
      const result = await createScene(projectId, "chapter", "chapter");
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "章の追加に失敗しました" : result.error.message,
        );
        return;
      }
      setScenes(result.data.scenes);
      const created = result.data.scenes.find(
        (s) => s.id === result.data?.createdId,
      );
      if (created) setEditing(created); // 追加したらすぐ編集ダイアログを開く
    } finally {
      setAdding(false);
    }
  }

  /** 定番構成テンプレの一括追加（末尾に追加。SPEC-outline-board §3.4） */
  async function handleApplyTemplate(key: OutlineTemplateKey) {
    if (adding) return;
    setAdding(true);
    try {
      const result = await applyOutlineTemplate(projectId, key);
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "テンプレの適用に失敗しました" : result.error.message,
        );
        return;
      }
      setScenes(result.data.scenes);
      toast(`「${OUTLINE_TEMPLATE[key].label}」の章を追加しました`);
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(
    sceneId: string,
    edit: SceneEdit,
  ): Promise<boolean> {
    const result = await updateScene(sceneId, edit);
    if (!result.ok || !result.data) {
      toast.error(result.ok ? "章の保存に失敗しました" : result.error.message);
      return false;
    }
    setScenes(result.data.scenes);
    return true;
  }

  async function handleDelete(sceneId: string): Promise<boolean> {
    const result = await deleteScene(sceneId);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    setScenes((prev) => prev.filter((s) => s.id !== sceneId));
    toast("章を削除しました");
    return true;
  }

  /** 原稿ファイル生成の完了（Issue #223）。紐づけはサーバー側で保存済み */
  function handleGenerated(result: GenerateManuscriptsResult) {
    setScenes(toCanonicalOrder(result.scenes));
    const first = result.created[0];
    toast(`${result.created.length}件の原稿ファイルを作成しました`, {
      action: first
        ? {
            label: "エディタで開く",
            onClick: () =>
              router.push(
                `/projects/${projectId}/editor?file=${encodeURIComponent(first.path)}`,
              ),
          }
        : undefined,
    });
    // 追記しない指定（skipped）は正常。失敗したときだけ案内する
    if (result.entryStatus === "failed") {
      // entry 追記はベストエフォート。失敗しても章一覧の末尾に印つきで出るため開ける
      toast("book.config.js の entry には追記できませんでした（entry 未登録）");
    }
  }

  /** 「通す」確定（ビートボードの構成承認と同じゲート。approveBoardReview 共用） */
  async function handleApprove(sessionId: string) {
    if (approving) return;
    setApproving(true);
    try {
      const result = await approveBoardReview(sessionId);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setStructureApproved(true);
      // 承認の瞬間に「クリックできる先」を出す（SPEC-manuscript-bridge §4.1）
      toast(
        "構成が通りました！執筆に進みましょう",
        unlinkedCount > 0
          ? {
              action: {
                label: "原稿ファイルを作る",
                onClick: () => setGenerating([]),
              },
            }
          : undefined,
      );
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            章 {chapters.length}枚
            {linkedCount > 0 && ` / 原稿 ${linkedCount}件`}
          </span>
          {structureApproved && (
            <Badge variant="secondary">
              <BadgeCheck data-icon="inline-start" />
              構成承認済み
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" disabled={adding}>
                    <ListPlus data-icon="inline-start" />
                    定番構成から追加
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {outlineTemplateKeys.map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => void handleApplyTemplate(key)}
                  >
                    <span className="flex flex-col">
                      <span>{OUTLINE_TEMPLATE[key].label}</span>
                      <span className="text-xs text-muted-foreground">
                        {OUTLINE_TEMPLATE[key].description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant={reviewOpen ? "secondary" : "outline"}
              size="sm"
              aria-pressed={reviewOpen}
              onClick={() => setReviewOpen((prev) => !prev)}
            >
              <ClipboardCheck data-icon="inline-start" />
              構成レビュー
            </Button>
          </div>
        </div>

        {/* 構成承認後の恒久CTA（SPEC-manuscript-bridge §4.1） */}
        {structureApproved && unlinkedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
            <p className="text-sm text-card-foreground">
              構成が通りました。まだ原稿ファイルのない章・シーンが{" "}
              {unlinkedCount} 件あります
            </p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => setGenerating([])}
            >
              <FilePlus data-icon="inline-start" />
              まとめて作成
            </Button>
          </div>
        )}

        {chapters.length === 0 ? (
          // 空ボード: 定番構成テンプレを目立つ形で提示（SPEC-outline-board §3.4）
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              章カードを並べて目次を組み立てましょう。定番の構成から始めるか、白紙から章を追加できます
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {outlineTemplateKeys.map((key) => (
                <div
                  key={key}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-card-foreground">
                      {OUTLINE_TEMPLATE[key].label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {OUTLINE_TEMPLATE[key].description}
                    </span>
                  </div>
                  <ol className="list-inside list-decimal text-xs text-muted-foreground">
                    {OUTLINE_TEMPLATE[key].chapters.map((chapter) => (
                      <li key={chapter}>{chapter}</li>
                    ))}
                  </ol>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-auto"
                    disabled={adding}
                    onClick={() => void handleApplyTemplate(key)}
                  >
                    この構成で始める
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              disabled={adding}
              onClick={() => void handleAdd()}
            >
              <Plus data-icon="inline-start" />
              白紙から章を追加
            </Button>
          </div>
        ) : (
          <DndContext
            id="outline-board-dnd" // SSRとクライアントで一致させる（beat-board と同じ hydration 対策）
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
              <SortableContext
                items={chapters.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {chapters.map((chapter) => (
                  <SortableChapterCard
                    key={chapter.id}
                    chapter={chapter}
                    chapterNumber={undefined}
                    onEdit={setEditing}
                  />
                ))}
              </SortableContext>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                disabled={adding}
                onClick={() => void handleAdd()}
              >
                <Plus data-icon="inline-start" />
                章を追加
              </Button>
            </div>
            <DragOverlay>
              {activeScene ? (
                <ChapterCardContent chapter={activeScene} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {reviewOpen && (
        <ReviewPanel
          key={`review-structure-${projectId}`}
          kind="structure"
          targetId={projectId}
          title="構成レビュー"
          emptyText="章立ての流れ・前提知識の積み上がりの観点で、編集者が目次全体（章構成と企画書）を見ます。承認が出るまで、指摘 → 改稿 → 再レビューを繰り返します。"
          showVerdict
          enableCopyToNote
          onClose={() => setReviewOpen(false)}
          renderFooter={({ latestVerdict, busy, sessionId }) => {
            if (
              latestVerdict === "approved" &&
              !structureApproved &&
              !busy &&
              sessionId !== null
            ) {
              return (
                <Button
                  onClick={() => void handleApprove(sessionId)}
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

      {editing && (
        <ChapterDialog
          key={`dialog-${editing.id}`}
          chapter={editing}
          onSave={handleSave}
          onDelete={handleDelete}
          onGenerateManuscript={handleGenerated}
          onClose={() => setEditing(null)}
        />
      )}

      {/* 一括生成（CTAバー・承認トーストから。単体作成は章ダイアログ側で開く） */}
      {generating !== null && (
        <GenerateManuscriptsDialog
          projectId={projectId}
          targetIds={generating}
          onGenerated={handleGenerated}
          onClose={() => setGenerating(null)}
        />
      )}
    </div>
  );
}
