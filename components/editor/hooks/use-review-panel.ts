"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  openManuscriptFile,
  updateSuggestionStatus,
  type ManuscriptFileData,
} from "@/lib/actions/manuscripts";
import type { SuggestionStatus } from "@/lib/schemas/enums";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { getSelectedText } from "@/components/editor/codemirror";
import type { CurrentChapter } from "@/components/editor/editor-state";
import type { OkWorkspace } from "@/components/editor/hooks/use-branch-state";

/**
 * エディタ内レビューパネル（Issue #18。校正は開いている章、講評は作品全体が対象）。
 * lg以上ではプレビューと入れ替えて表示し、閉じたら元の表示状態へ戻す。
 * 「未保存編集ありで校正 → 保存後に自動で開く」予約（pendingProofreadRef）は
 * 保存フロー（confirmSave）側が消費する
 */
export function useReviewPanel({
  projectId,
  currentRef,
  contentRef,
  okRef,
  editorViewRef,
  previewOpen,
  setPreviewOpen,
  requestSave,
  openChapterFlow,
}: {
  projectId: string;
  currentRef: React.RefObject<CurrentChapter | null>;
  contentRef: React.RefObject<string>;
  okRef: React.RefObject<OkWorkspace | null>;
  editorViewRef: React.RefObject<EditorView | null>;
  previewOpen: boolean;
  setPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  requestSave: () => void;
  openChapterFlow: (path: string) => Promise<void>;
}) {
  const [reviewOpen, setReviewOpen] = useState<"proofread" | "critique" | null>(
    null,
  );
  /** 校正パネルに渡す原稿情報（openManuscriptFile の結果。コミット済み内容が正） */
  const [reviewFile, setReviewFile] = useState<ManuscriptFileData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  /** エディタの主選択テキスト（選択範囲の校正。SPEC-proofread-selection §3。
   * 通常の打鍵・選択で再レンダーさせないため、校正パネル表示中のみ追跡する */
  const [proofreadSelection, setProofreadSelection] = useState("");

  /** 未保存編集ありで校正を押した場合の「保存後に校正パネルを開く」予約 */
  const pendingProofreadRef = useRef(false);
  /** レビューパネルを閉じたときに戻すプレビュー表示状態（開く前の値を覚える） */
  const prevPreviewOpenRef = useRef(true);

  /** レビューパネルを開く（lg以上ではプレビューと入れ替え、閉じたら元の表示状態へ戻す） */
  const openReviewPanel = useCallback(
    (panel: "proofread" | "critique") => {
      if (reviewOpen === null) prevPreviewOpenRef.current = previewOpen;
      setReviewOpen(panel);
      setPreviewOpen(false);
    },
    [reviewOpen, previewOpen, setPreviewOpen],
  );

  const closeReviewPanel = useCallback(() => {
    setReviewOpen(null);
    setReviewFile(null);
    setReviewError(null);
    setProofreadSelection("");
    // パネル表示中に明示操作（全体プレビュー等）で開き直していた場合は上書きしない
    setPreviewOpen((open) => open || prevPreviewOpenRef.current);
  }, [setPreviewOpen]);

  /** エディタの選択変更（校正パネル表示中のみ state に反映。それ以外は無視して再レンダーを避ける） */
  const handleSelectionChange = useCallback(
    (text: string) => {
      if (reviewOpen !== "proofread") return;
      setProofreadSelection(text);
    },
    [reviewOpen],
  );

  /** 校正パネルを開く。校正はコミット済み内容が対象のため、未保存の編集は先に保存へ誘導する */
  const openProofread = useCallback(async () => {
    const current = currentRef.current;
    if (!current) return;
    if (contentRef.current !== current.remoteContent) {
      pendingProofreadRef.current = true;
      toast.info(
        "未保存の編集があります。保存（コミット）すると校正パネルを開きます",
      );
      requestSave();
      return;
    }
    // 校正はデフォルトブランチのコミット内容が対象のまま（SPEC-phase5 §3.4・論点G。注記のみ）
    const okNow = okRef.current;
    if (okNow && okNow.branch !== okNow.defaultBranch) {
      toast.info(
        `校正はデフォルトブランチ（${okNow.defaultBranch}）のコミット内容が対象です`,
      );
    }
    openReviewPanel("proofread");
    // パネルを開いた時点の選択を初期値にする（以後は onSelectionChange が追跡）
    setProofreadSelection(
      editorViewRef.current ? getSelectedText(editorViewRef.current) : "",
    );
    // 前回開いた章の原稿情報が残っていると、フェッチ完了まで別の章の提案を誤操作できてしまう
    setReviewFile(null);
    setReviewLoading(true);
    setReviewError(null);
    try {
      const result = await openManuscriptFile(projectId, current.path);
      if (!result.ok || !result.data) {
        setReviewFile(null);
        setReviewError(
          result.ok ? "原稿情報の読み込みに失敗しました" : result.error.message,
        );
        return;
      }
      setReviewFile(result.data);
    } finally {
      setReviewLoading(false);
    }
  }, [
    projectId,
    requestSave,
    openReviewPanel,
    currentRef,
    contentRef,
    okRef,
    editorViewRef,
  ]);

  /** 提案の受入/拒否/保留（原稿タブと同じ作法で、成功時はローカルの提案一覧のみ差し替える） */
  const handleUpdateSuggestion = useCallback(
    async (id: string, status: SuggestionStatus) => {
      const result = await updateSuggestionStatus(id, status);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setReviewFile((prev) =>
        prev
          ? {
              ...prev,
              suggestions: prev.suggestions.map((s) =>
                s.id === id ? { ...s, status } : s,
              ),
            }
          : prev,
      );
    },
    [],
  );

  /** 提案カードクリック → エディタの該当箇所を選択してスクロール */
  const locateInEditor = useCallback(
    (originalText: string) => {
      const view = editorViewRef.current;
      if (!view) return;
      const doc = view.state.doc.toString();
      const idx = originalText === "" ? -1 : doc.indexOf(originalText);
      if (idx === -1) {
        toast.error(
          "該当箇所がエディタ内に見つかりません（原稿が更新された可能性があります）",
        );
        return;
      }
      view.dispatch({
        selection: EditorSelection.range(idx, idx + originalText.length),
        effects: EditorView.scrollIntoView(idx, { y: "center" }),
      });
      view.focus();
    },
    [editorViewRef],
  );

  /**
   * 校正完了・コミット完了後の取り直し。「まとめてコミット」「保留の書き戻し」はGitHubに
   * コミットを作るため、エディタが未編集ならリモート最新を開き直して baseSha を進める
   * （追従しないと次の保存が必ず競合フローに入る）
   */
  const refreshReview = useCallback(async () => {
    const current = currentRef.current;
    if (!current) return;
    const result = await openManuscriptFile(projectId, current.path);
    // 取得待ちの間に章が切り替わっていたら、古い章の情報で上書きしない
    if (currentRef.current?.path !== current.path) return;
    if (!result.ok || !result.data) {
      toast.error(
        result.ok ? "原稿情報の再取得に失敗しました" : result.error.message,
      );
      return;
    }
    setReviewFile(result.data);
    if (result.data.content === current.remoteContent) return;
    if (contentRef.current !== current.remoteContent) {
      // パネルを開いたまま編集が進んでいた場合。次の保存で差分の取り込みフローに入る
      toast.warning(
        "校正の反映で原稿が更新されました。未保存の編集は保存時に差分の取り込みが必要になります",
      );
      return;
    }
    await openChapterFlow(current.path);
  }, [projectId, openChapterFlow, currentRef, contentRef]);

  return {
    reviewOpen,
    reviewFile,
    reviewLoading,
    reviewError,
    proofreadSelection,
    pendingProofreadRef,
    openReviewPanel,
    closeReviewPanel,
    handleSelectionChange,
    openProofread,
    handleUpdateSuggestion,
    locateInEditor,
    refreshReview,
  };
}
