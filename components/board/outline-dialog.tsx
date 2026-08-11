"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Trash2 } from "lucide-react";

import {
  getManuscriptFiles,
  type ManuscriptTreeData,
} from "@/lib/actions/manuscripts";
import type { SceneRecord } from "@/lib/board";
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

const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * 章カードの編集ダイアログ（SPEC-outline-board §3.3）。
 * シーンダイアログの縮退版: タイトル・内容メモ・原稿ファイル紐づけ・削除のみ。
 * パート・アンカー・感情・ノート紐づけ・シーンレビューは持たない（小説理論の項目のため）
 */
export function OutlineDialog({
  scene,
  onSave,
  onDelete,
  onClose,
}: {
  scene: SceneRecord;
  onSave: (sceneId: string, edit: SceneEdit) => Promise<boolean>;
  onDelete: (sceneId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(scene.title);
  const [content, setContent] = useState(scene.content);
  const [manuscriptPath, setManuscriptPath] = useState<string | null>(
    scene.manuscript_path,
  );
  // 原稿ファイルの選択肢（scene-dialog と同じ遅延取得。null = 読み込み中）
  const [tree, setTree] = useState<ManuscriptTreeData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getManuscriptFiles(scene.project_id).then((result) => {
      if (cancelled) return;
      // 取得失敗は repo 未設定と同じ誘導文でよい（紐づけ以外の編集は妨げない）
      setTree(result.ok && result.data ? result.data : { gate: "no_repo" });
    });
    return () => {
      cancelled = true;
    };
  }, [scene.project_id]);

  // 選択肢はエディタが開ける章のみ（scene-dialog と同じ規則）
  const chapterFiles = (() => {
    if (tree === null || tree.gate !== "ok") return [];
    const base = tree.basePath.replace(/\/$/, "");
    const prefix = base === "" ? "" : `${base}/`;
    return tree.files.filter(
      (f) => f.startsWith(`${prefix}manuscripts/`) && f.endsWith(".md"),
    );
  })();

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await onSave(scene.id, {
        title,
        content,
        // 章カードの固定値（アンカー・感情は目次ボードでは使わない。SPEC-outline-board §4）
        part: "chapter",
        anchor: null,
        emotion_start: null,
        emotion_end: null,
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
      {/* 低い画面でも保存ボタンに届くよう、ダイアログ全体を画面内に収めてスクロール（Issue #153） */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>章を編集</DialogTitle>
          <DialogDescription className="sr-only">
            章のタイトル・内容メモ・原稿ファイル紐づけを編集します
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            章タイトル
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 環境構築"
              className="text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            内容メモ
            {/* max-h で自動拡張を止め、以降は入力欄内スクロール（Issue #153: 保存ボタンの見切れ防止） */}
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="この章で扱う内容を簡単にメモしましょう"
              className="max-h-64 min-h-32 text-sm text-foreground"
            />
          </label>

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
                onChange={(e) =>
                  setManuscriptPath(
                    e.target.value === "" ? null : e.target.value,
                  )
                }
              >
                <option value="">なし</option>
                {/* 保存済みパスが章一覧から消えていても（改名・削除）現在値は選択肢に残す */}
                {manuscriptPath !== null &&
                  !chapterFiles.includes(manuscriptPath) && (
                    <option value={manuscriptPath}>
                      {manuscriptPath}（見つかりません）
                    </option>
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
            <Link
              href={`/projects/${scene.project_id}/editor?file=${encodeURIComponent(manuscriptPath)}`}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <ExternalLink className="size-3" aria-hidden />
              エディタで開く
            </Link>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={busy}
                >
                  <Trash2 data-icon="inline-start" />
                  削除
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>この章を削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  「{scene.title || "（無題）"}
                  」を完全に削除します。元に戻せません
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleDelete()}
                >
                  削除する
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={() => void handleSave()} disabled={busy}>
            保存する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
