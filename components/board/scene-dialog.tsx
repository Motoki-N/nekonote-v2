"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, MessageSquareText, Minus, Plus, Trash2 } from "lucide-react";

import { getManuscriptTree, type ManuscriptTreeData } from "@/lib/actions/manuscripts";
import type { LinkedNote } from "@/lib/actions/projects";
import {
  ANCHOR_LABEL,
  ANCHOR_TO_PART,
  formatEmotion,
  isBoundaryAnchor,
  SCENE_CONTENT_TEMPLATE,
  type SceneRecord,
} from "@/lib/board";
import { BOARD_TEMPLATES } from "@/lib/board-templates";
import { LinkedNoteChips } from "@/components/notes/linked-note-chips";
import { EMOTION_MAX, EMOTION_MIN, sceneAnchors } from "@/lib/schemas/enums";
import type { Emotion, SceneAnchor, ScenePart, StructureTemplate } from "@/lib/schemas/enums";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function EmotionStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Emotion | null;
  onChange: (next: Emotion | null) => void;
}) {
  function step(delta: number) {
    const base = value ?? 0;
    onChange(Math.min(EMOTION_MAX, Math.max(EMOTION_MIN, base + delta)));
  }
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs text-muted-foreground">{label}</legend>
      <div className="flex items-center gap-1.5" role="group" aria-label={label}>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => step(-1)}
          disabled={value === EMOTION_MIN}
          aria-label="1段階マイナス"
        >
          <Minus />
        </Button>
        <span className="w-9 text-center text-sm text-foreground tabular-nums">
          {formatEmotion(value)}
        </span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => step(1)}
          disabled={value === EMOTION_MAX}
          aria-label="1段階プラス"
        >
          <Plus />
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onChange(null)}
          disabled={value === null}
        >
          未設定に戻す
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * シーン編集ダイアログ（SPEC-beat-board §3.3）。
 * 保存ボタンは置かず、閉じる操作（×・ESC・外側クリック）で変更があれば保存してから閉じる（Issue #169）。
 * 保存失敗時はダイアログを開いたままにして編集内容を守る。削除は確認ダイアログを挟んで物理削除
 */
export function SceneDialog({
  scene,
  structureTemplate,
  allScenes,
  linkedNotes,
  onAttachNote,
  onDetachNote,
  onSave,
  onDuplicate,
  onDelete,
  onReview,
  onClose,
}: {
  scene: SceneRecord;
  /** パート選択肢の出典（現テンプレートのレーンのみ出す。Issue #54） */
  structureTemplate: StructureTemplate;
  /** アンカー付け替えの注意書き表示用（1転換点1シーン） */
  allScenes: SceneRecord[];
  /** このシーンの紐づけノート（Issue #56。attach/detach はシーン本体の保存と独立に即時反映） */
  linkedNotes: LinkedNote[];
  onAttachNote: (note: LinkedNote) => Promise<void>;
  onDetachNote: (noteId: string) => Promise<void>;
  onSave: (sceneId: string, edit: SceneEdit) => Promise<boolean>;
  /** 複製（Issue #154）。未保存の変更を保存してから複製する（Issue #169） */
  onDuplicate: (sceneId: string) => Promise<boolean>;
  onDelete: (sceneId: string) => Promise<boolean>;
  onReview: (scene: SceneRecord) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const templateLanes = BOARD_TEMPLATES[structureTemplate].lanes;
  // 現テンプレートのレーンでないパート（章カード等）はビートボードから開かれない防御的フォールバック
  const initialPart: ScenePart = templateLanes.some((lane) => lane.id === scene.part)
    ? (scene.part as ScenePart)
    : templateLanes[0].id;
  const [title, setTitle] = useState(scene.title);
  const [content, setContent] = useState(scene.content);
  const [part, setPart] = useState<ScenePart>(initialPart);
  const [anchor, setAnchor] = useState<SceneAnchor | null>(scene.anchor);
  const [emotionStart, setEmotionStart] = useState<Emotion | null>(scene.emotion_start);
  const [emotionEnd, setEmotionEnd] = useState<Emotion | null>(scene.emotion_end);
  const [manuscriptPath, setManuscriptPath] = useState<string | null>(scene.manuscript_path);
  // 最後に保存した内容。差分がないときは閉じる・複製・レビュー時に保存しない
  // （scene prop はダイアログ表示中に更新されないため、保存のたびにここへ写す）
  const savedRef = useRef<SceneEdit>({
    title: scene.title,
    content: scene.content,
    part: initialPart,
    anchor: scene.anchor,
    emotion_start: scene.emotion_start,
    emotion_end: scene.emotion_end,
    manuscript_path: scene.manuscript_path,
  });
  // 原稿ファイルの選択肢（Issue #56）。ダイアログを開いたときに遅延取得。null = 読み込み中
  const [tree, setTree] = useState<ManuscriptTreeData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getManuscriptTree(scene.project_id).then((result) => {
      if (cancelled) return;
      // 取得失敗は repo 未設定と同じ誘導文でよい（紐づけ以外の編集は妨げない）
      setTree(result.ok && result.data ? result.data : { gate: "no_repo" });
    });
    return () => {
      cancelled = true;
    };
  }, [scene.project_id]);

  // 現在のパートに応じたアンカー選択肢のみ出す（解決レーンはなし）
  const anchorOptions = sceneAnchors.filter((a) => ANCHOR_TO_PART[a] === part);
  // 選択肢はエディタが開ける章のみ（base_path/manuscripts/*.md。editor.ts の listChapters と同じ規則）。
  // ツリー全部を出すと、エディタ側で選択されない「開けない紐づけ」が作れてしまう
  const chapterFiles = (() => {
    if (tree === null || tree.gate !== "ok") return [];
    const base = tree.basePath.replace(/\/$/, "");
    const prefix = base === "" ? "" : `${base}/`;
    return tree.files.filter((f) => f.startsWith(`${prefix}manuscripts/`) && f.endsWith(".md"));
  })();
  // 付け替えの対象（すでに他のシーンに付いている同アンカー）
  const holder =
    anchor !== null
      ? allScenes.find((s) => s.id !== scene.id && s.anchor === anchor)
      : undefined;

  function handlePartChange(nextPart: ScenePart) {
    setPart(nextPart);
    // パート変更で整合しなくなったアンカーは自動解除（SPEC §3.3）
    if (anchor !== null && ANCHOR_TO_PART[anchor] !== nextPart) setAnchor(null);
  }

  /** 未保存の変更があれば保存する。差分なし・保存成功で true、失敗で false（失敗トーストは親が出す） */
  async function flush(): Promise<boolean> {
    const edit: SceneEdit = {
      title,
      content,
      part,
      anchor,
      emotion_start: emotionStart,
      emotion_end: emotionEnd,
      manuscript_path: manuscriptPath,
    };
    const saved = savedRef.current;
    const dirty = (Object.keys(edit) as (keyof SceneEdit)[]).some((k) => edit[k] !== saved[k]);
    if (!dirty) return true;
    const ok = await onSave(scene.id, edit);
    if (ok) savedRef.current = edit;
    return ok;
  }

  /** 閉じる操作（×・ESC・外側クリック）。変更があれば保存し、失敗時は閉じずに編集内容を守る（Issue #169） */
  async function handleClose() {
    if (busy) return;
    setBusy(true);
    try {
      if (await flush()) onClose();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await onDelete(scene.id);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  }

  /** 複製（Issue #154）。編集中の内容も複製されるよう保存してから複製する。ダイアログは閉じない */
  async function handleDuplicate() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      await onDuplicate(scene.id);
    } finally {
      setBusy(false);
    }
  }

  /** シーンレビュー起動。パネルは保存済みの内容を対象にするため、先に保存する（Issue #169）。
   * scene prop は開いた時点のスナップショットなので、パネルの見出し等がずれないよう保存後の値を重ねて渡す */
  async function handleReview() {
    if (busy) return;
    setBusy(true);
    try {
      if (await flush()) onReview({ ...scene, ...savedRef.current });
    } finally {
      setBusy(false);
    }
  }

  /** 「エディタで開く」。遷移でダイアログごとアンマウントされるため、未保存の変更を保存してから遷移する（Issue #169） */
  async function handleOpenEditor(href: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (await flush()) router.push(href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void handleClose()}>
      {/* 低い画面でもフッターの操作に届くよう、ダイアログ全体を画面内に収めてスクロール（Issue #151） */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>シーンを編集</DialogTitle>
          <DialogDescription className="sr-only">
            シーンのタイトル・本文・感情・パート・転換点マークを編集します
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            タイトル
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 主人公、手紙を見つける"
              className="text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            本文
            {/* max-h で自動拡張を止め、以降は入力欄内スクロール（Issue #151: フッターの見切れ防止） */}
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={SCENE_CONTENT_TEMPLATE}
              className="max-h-64 min-h-32 text-sm text-foreground"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EmotionStepper label="感情の起点" value={emotionStart} onChange={setEmotionStart} />
            <EmotionStepper label="感情の終点" value={emotionEnd} onChange={setEmotionEnd} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              パート
              <select
                className={selectClass}
                value={part}
                onChange={(e) => handlePartChange(e.target.value as ScenePart)}
              >
                {templateLanes.map((lane) => (
                  <option key={lane.id} value={lane.id}>
                    {lane.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              転換点マーク
              <select
                className={cn(selectClass, anchorOptions.length === 0 && "opacity-50")}
                value={anchor ?? ""}
                onChange={(e) => setAnchor(e.target.value === "" ? null : (e.target.value as SceneAnchor))}
                disabled={anchorOptions.length === 0}
              >
                <option value="">なし</option>
                {anchorOptions.map((a) => (
                  <option key={a} value={a}>
                    {ANCHOR_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {scene.anchor !== null && (
              <p>パートを変えると、転換点マークは自動で外れます</p>
            )}
            {holder && (
              <p>
                「{ANCHOR_LABEL[anchor as SceneAnchor]}」は「{holder.title || "（無題）"}
                」に付いています。ダイアログを閉じるとこのシーンに付け替えます
              </p>
            )}
            {anchor !== null && isBoundaryAnchor(anchor) && (
              <p>境界の転換点が付いたシーンはレーン末尾の定位置に固定されます</p>
            )}
          </div>

          {/* 紐づけ（Issue #56）。ノートは即時反映、原稿ファイルは閉じるときに保存（Issue #169） */}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">紐づけノート:</span>
              <LinkedNoteChips
                notes={linkedNotes}
                onAttach={onAttachNote}
                onDetach={onDetachNote}
              />
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              原稿ファイル
              {tree === null ? (
                <span>読み込み中…</span>
              ) : tree.gate !== "ok" ? (
                <span>
                  {tree.gate === "no_repo"
                    ? "原稿の紐づけにはリポジトリの設定が必要です（プロジェクト設定）"
                    : "原稿の紐づけにはGitHub PATの登録が必要です（設定画面）"}
                </span>
              ) : (
                <select
                  className={selectClass}
                  value={manuscriptPath ?? ""}
                  onChange={(e) => setManuscriptPath(e.target.value === "" ? null : e.target.value)}
                >
                  <option value="">なし</option>
                  {/* 保存済みパスが章一覧から消えていても（改名・削除）現在値は選択肢に残す */}
                  {manuscriptPath !== null && !chapterFiles.includes(manuscriptPath) && (
                    <option value={manuscriptPath}>{manuscriptPath}（見つかりません）</option>
                  )}
                  {chapterFiles.map((file) => (
                    <option key={file} value={file}>
                      {file}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {manuscriptPath !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void handleOpenEditor(
                    `/projects/${scene.project_id}/editor?file=${encodeURIComponent(manuscriptPath)}`,
                  )
                }
                className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                エディタで開く
              </button>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="ghost" size="sm" className="text-destructive" disabled={busy}>
                    <Trash2 data-icon="inline-start" />
                    削除
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>このシーンを削除しますか？</AlertDialogTitle>
                  <AlertDialogDescription>
                    「{scene.title || "（無題）"}」を完全に削除します。このシーンのレビュー履歴も一緒に消えます。元に戻せません
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                    削除する
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleDuplicate()}
            >
              <Copy data-icon="inline-start" />
              複製
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleReview()}>
              <MessageSquareText data-icon="inline-start" />
              シーンレビュー
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
