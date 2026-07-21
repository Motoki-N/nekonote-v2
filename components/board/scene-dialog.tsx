"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, MessageSquareText, Trash2 } from "lucide-react";

import { getManuscriptTree, type ManuscriptTreeData } from "@/lib/actions/manuscripts";
import type { LinkedNote } from "@/lib/actions/projects";
import {
  ANCHOR_LABEL,
  ANCHOR_TO_PART,
  PART_LABEL,
  isBoundaryAnchor,
  type SceneRecord,
} from "@/lib/board";
import { LinkedNoteChips } from "@/components/notes/linked-note-chips";
import { sceneAnchors, sceneParts } from "@/lib/schemas/enums";
import type { Emotion, SceneAnchor, ScenePart } from "@/lib/schemas/enums";
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

const CONTENT_PLACEHOLDER = [
  "4観点を目安に自由に:",
  "・シチュエーション（場所・時刻）",
  "・起きること",
  "・感情の変化",
  "・葛藤",
].join("\n");

const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function EmotionToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Emotion | null;
  onChange: (next: Emotion | null) => void;
}) {
  const options: { value: Emotion | null; label: string }[] = [
    { value: null, label: "未設定" },
    { value: "plus", label: "＋ プラス" },
    { value: "minus", label: "− マイナス" },
  ];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs text-muted-foreground">{label}</legend>
      <div className="flex gap-1" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={option.label}
            type="button"
            size="xs"
            variant={value === option.value ? "secondary" : "outline"}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * シーン編集ダイアログ（SPEC-beat-board §3.3）。
 * 保存ボタンで確定（自動保存はしない）。削除は確認ダイアログを挟んで物理削除
 */
export function SceneDialog({
  scene,
  allScenes,
  linkedNotes,
  onAttachNote,
  onDetachNote,
  onSave,
  onDelete,
  onReview,
  onClose,
}: {
  scene: SceneRecord;
  /** アンカー付け替えの注意書き表示用（1転換点1シーン） */
  allScenes: SceneRecord[];
  /** このシーンの紐づけノート（Issue #56。attach/detach は保存ボタンと独立に即時反映） */
  linkedNotes: LinkedNote[];
  onAttachNote: (note: LinkedNote) => Promise<void>;
  onDetachNote: (noteId: string) => Promise<void>;
  onSave: (sceneId: string, edit: SceneEdit) => Promise<boolean>;
  onDelete: (sceneId: string) => Promise<boolean>;
  onReview: (scene: SceneRecord) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(scene.title);
  const [content, setContent] = useState(scene.content);
  const [part, setPart] = useState<ScenePart>(scene.part);
  const [anchor, setAnchor] = useState<SceneAnchor | null>(scene.anchor);
  const [emotionStart, setEmotionStart] = useState<Emotion | null>(scene.emotion_start);
  const [emotionEnd, setEmotionEnd] = useState<Emotion | null>(scene.emotion_end);
  const [manuscriptPath, setManuscriptPath] = useState<string | null>(scene.manuscript_path);
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

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await onSave(scene.id, {
        title,
        content,
        part,
        anchor,
        emotion_start: emotionStart,
        emotion_end: emotionEnd,
        manuscript_path: manuscriptPath,
      });
      if (ok) onClose();
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
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
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={CONTENT_PLACEHOLDER}
              className="min-h-32 text-sm text-foreground"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EmotionToggle label="感情の起点" value={emotionStart} onChange={setEmotionStart} />
            <EmotionToggle label="感情の終点" value={emotionEnd} onChange={setEmotionEnd} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              パート
              <select
                className={selectClass}
                value={part}
                onChange={(e) => handlePartChange(e.target.value as ScenePart)}
              >
                {sceneParts.map((p) => (
                  <option key={p} value={p}>
                    {PART_LABEL[p]}
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
                」に付いています。保存するとこのシーンに付け替えます
              </p>
            )}
            {anchor !== null && isBoundaryAnchor(anchor) && (
              <p>境界の転換点が付いたシーンはレーン末尾の定位置に固定されます</p>
            )}
          </div>

          {/* 紐づけ（Issue #56）。ノートは即時反映、原稿ファイルは保存ボタンで確定 */}
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
                  {/* 保存済みパスがツリーから消えていても（改名・削除）現在値は選択肢に残す */}
                  {manuscriptPath !== null && !tree.files.includes(manuscriptPath) && (
                    <option value={manuscriptPath}>{manuscriptPath}（見つかりません）</option>
                  )}
                  {tree.files.map((file) => (
                    <option key={file} value={file}>
                      {file}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {manuscriptPath !== null && (
              <Link
                href={`/projects/${scene.project_id}/editor?file=${encodeURIComponent(manuscriptPath)}`}
                className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                エディタで開く
              </Link>
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
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onReview(scene)}>
              <MessageSquareText data-icon="inline-start" />
              シーンレビュー
            </Button>
          </div>
          <Button onClick={() => void handleSave()} disabled={busy}>
            保存する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
