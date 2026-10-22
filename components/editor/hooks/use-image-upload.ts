"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { placeIllustration, uploadImage } from "@/lib/actions/editor";
import {
  fileToBase64,
  illustNotation,
  sanitizeImageFileName,
  type IllustPosition,
} from "@/lib/editor/image";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type {
  IllustKind,
  ImageTarget,
} from "@/components/editor/image-upload-dialog";
import type { OkWorkspace } from "@/components/editor/hooks/use-branch-state";

/**
 * 画像アップロード（SPEC-vertical-editor-phase3 §6・論点C）。
 * images/ へ即コミット → カーソル位置に挿入記法を追記（本文は通常の保存フロー）。
 * アトリエのイラスト（SPEC-illustrator §11）はサーバーが Storage からコピーコミットする
 */
export function useImageUpload({
  projectId,
  okRef,
  editorViewRef,
}: {
  projectId: string;
  okRef: React.RefObject<OkWorkspace | null>;
  editorViewRef: React.RefObject<EditorView | null>;
}) {
  /** 挿入する画像（D&D・ツールバーのファイル、またはアトリエのイラスト） */
  const [pendingImage, setPendingImage] = useState<ImageTarget | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const confirmImageUpload = useCallback(
    async ({
      kind,
      position,
      caption,
    }: {
      kind: IllustKind;
      position: IllustPosition;
      caption: string;
    }) => {
      const target = pendingImage;
      if (!target) return;
      setUploadingImage(true);
      try {
        const branch = okRef.current?.branch;
        const result =
          target.type === "file"
            ? await uploadImage(
                projectId,
                sanitizeImageFileName(target.file.name),
                { base64Content: await fileToBase64(target.file) },
                branch,
              )
            : await placeIllustration(projectId, target.item.id, branch);
        if (!result.ok || !result.data) {
          toast.error(
            result.ok
              ? "画像のアップロードに失敗しました"
              : result.error.message,
          );
          return;
        }
        const view = editorViewRef.current;
        if (view) {
          const pos = view.state.selection.main.from;
          // 挿絵は独立した段落として前後を空行で区切る
          const insert = `\n\n${illustNotation(result.data.fileName, kind, caption, position)}\n\n`;
          view.dispatch({
            changes: { from: pos, insert },
            selection: EditorSelection.cursor(pos + insert.length),
            scrollIntoView: true,
            userEvent: "input",
          });
          view.focus();
        }
        setPendingImage(null);
        toast.success(`画像 ${result.data.fileName} をコミットしました`);
        // 配置の記録（⛳）に失敗しても挿入は成立している。アトリエの走査で補正できる
        if ("recorded" in result.data && !result.data.recorded) {
          toast.warning(
            "アトリエへの配置の記録に失敗しました。ギャラリーの「原稿の配置状況を更新」で補正できます",
          );
        }
      } catch {
        toast.error("画像の読み込みに失敗しました");
      } finally {
        setUploadingImage(false);
      }
    },
    [pendingImage, projectId, okRef, editorViewRef],
  );

  return {
    pendingImage,
    setPendingImage,
    uploadingImage,
    confirmImageUpload,
    imageInputRef,
  };
}
