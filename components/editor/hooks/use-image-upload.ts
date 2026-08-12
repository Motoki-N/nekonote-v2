"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { uploadImage } from "@/lib/actions/editor";
import {
  fileToBase64,
  illustNotation,
  sanitizeImageFileName,
} from "@/lib/editor/image";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { IllustKind } from "@/components/editor/image-upload-dialog";
import type { OkWorkspace } from "@/components/editor/hooks/use-branch-state";

/**
 * 画像アップロード（SPEC-vertical-editor-phase3 §6・論点C）。
 * images/ へ即コミット → カーソル位置に挿入記法を追記（本文は通常の保存フロー）
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
  /** 画像アップロードの対象（D&D またはツールバーから。SPEC-phase3 §6） */
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const confirmImageUpload = useCallback(
    async ({ kind, caption }: { kind: IllustKind; caption: string }) => {
      const file = pendingImage;
      if (!file) return;
      setUploadingImage(true);
      try {
        const base64 = await fileToBase64(file);
        const result = await uploadImage(
          projectId,
          sanitizeImageFileName(file.name),
          base64,
          okRef.current?.branch,
        );
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
          const insert = `\n\n${illustNotation(result.data.fileName, kind, caption)}\n\n`;
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
