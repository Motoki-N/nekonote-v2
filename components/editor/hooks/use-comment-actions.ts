"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import type { ManuscriptComment } from "@/lib/editor/comments";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * コメント一覧からの操作（SPEC-vertical-editor-phase3 §3・Issue #19）。
 * ジャンプと削除。一覧はデバウンス更新のため、位置ずれの検証を挟む
 */
export function useCommentActions({
  editorViewRef,
  recount,
}: {
  editorViewRef: React.RefObject<EditorView | null>;
  /** 削除後（および位置ずれ検出時）の字数・一覧の再計算 */
  recount: () => void;
}) {
  /** コメント一覧から該当箇所へジャンプ（選択で一時的に目立たせる） */
  const jumpToComment = useCallback(
    (comment: ManuscriptComment) => {
      const view = editorViewRef.current;
      if (!view) return;
      // 一覧はデバウンス更新のため、直後の編集でオフセットが範囲外になり得る
      const docLength = view.state.doc.length;
      const from = Math.min(comment.from, docLength);
      const to = Math.min(comment.to, docLength);
      view.dispatch({
        selection: EditorSelection.range(from, to),
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
      view.focus();
    },
    [editorViewRef],
  );

  /** コメント一覧から該当コメントを本文から削除する（Cmd/Ctrl+Z で取り消せる通常の編集） */
  const deleteComment = useCallback(
    (comment: ManuscriptComment) => {
      const view = editorViewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      // 一覧はデバウンス更新のため、直後の編集で位置がずれ得る。今も単一のコメント本体
      // （途中に終端記号がない）を指しているか検証してから消す
      const target =
        comment.to <= doc.length
          ? doc.sliceString(comment.from, comment.to)
          : "";
      if (
        !target.startsWith("<!--") ||
        target.indexOf("-->") !== target.length - 3
      ) {
        recount();
        toast.error(
          "本文が変更されたため削除を中止しました。一覧を更新したのでやり直してください",
        );
        return;
      }
      // コメントだけの行なら行ごと（末尾の改行含む）削除して空行を残さない
      const startLine = doc.lineAt(comment.from);
      const endLine = doc.lineAt(comment.to);
      const standalone =
        doc.sliceString(startLine.from, comment.from).trim() === "" &&
        doc.sliceString(comment.to, endLine.to).trim() === "";
      view.dispatch({
        changes: standalone
          ? { from: startLine.from, to: Math.min(endLine.to + 1, doc.length) }
          : { from: comment.from, to: comment.to },
        userEvent: "delete",
      });
      recount();
    },
    [recount, editorViewRef],
  );

  return { jumpToComment, deleteComment };
}
