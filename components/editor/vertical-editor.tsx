"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  createChapter,
  getAllChapterContents,
  getEditorWorkspace,
  openChapter,
  saveChapter,
} from "@/lib/actions/editor";
import type { EditorChapter, EditorWorkspaceData } from "@/lib/actions/editor";
import { EditorView } from "@codemirror/view";

import { extractComments } from "@/lib/editor/comments";
import type { ManuscriptComment } from "@/lib/editor/comments";
import { deleteDraft, getDraft } from "@/lib/editor/draft-store";
import type { LinkedScene } from "@/lib/board";
import type { Draft } from "@/lib/editor/draft-store";
import { buildPreviewHtml } from "@/lib/editor/preview";
import {
  countManuscriptChars,
  extractKumiSettings,
} from "@/lib/editor/word-count";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CritiquePanel } from "@/components/manuscript/critique-panel";
import { ProofreadPanel } from "@/components/manuscript/proofread-panel";
import { AozoraExportDialog } from "@/components/editor/aozora-export-dialog";
import { BranchCreateDialog } from "@/components/editor/branch-create-dialog";
import { BuildDialog } from "@/components/editor/build-dialog";
import { EditorPane } from "@/components/editor/editor-pane";
import { PrCreateDialog } from "@/components/editor/pr-create-dialog";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { ImageUploadDialog } from "@/components/editor/image-upload-dialog";
import { MergePane } from "@/components/editor/merge-pane";
import { NewChapterDialog } from "@/components/editor/new-chapter-dialog";
import { PreviewPane } from "@/components/editor/preview-pane";
import { SaveDialog } from "@/components/editor/save-dialog";
import { SettingsDialog } from "@/components/editor/settings-dialog";
import type {
  CurrentChapter,
  MergeState,
} from "@/components/editor/editor-state";
import { useBranchState } from "@/components/editor/hooks/use-branch-state";
import type { OkWorkspace } from "@/components/editor/hooks/use-branch-state";
import { useDetachedPreview } from "@/components/editor/hooks/use-detached-preview";
import { useDraftStore } from "@/components/editor/hooks/use-draft-store";
import { usePaneLayout } from "@/components/editor/hooks/use-pane-layout";
import { useCommentActions } from "@/components/editor/hooks/use-comment-actions";
import { useImageUpload } from "@/components/editor/hooks/use-image-upload";
import { useReviewPanel } from "@/components/editor/hooks/use-review-panel";
import { EditorGuidance } from "@/components/editor/editor-guidance";
import { EditorSidebar } from "@/components/editor/editor-sidebar";
import { EditorTopBar } from "@/components/editor/editor-top-bar";

// プレビュー再組版のデバウンス（SPEC-vertical-editor-phase2 §5.1）
const PREVIEW_DEBOUNCE_MS = 3000;
// 字数カウントのデバウンス（SPEC-vertical-editor-phase3 §5）
const COUNT_DEBOUNCE_MS = 500;

/**
 * 縦書きエディタの本体（SPEC-vertical-editor-phase2 §3）。
 * 左=章一覧・中=入力ペイン（CodeMirror）・右=組版プレビュー（Vivliostyle。書字方向はテーマ追従）
 */
export function VerticalEditor({
  projectId,
  workspace,
  workspaceError,
  initialFile,
  linkedScenes,
}: {
  projectId: string;
  workspace: EditorWorkspaceData | null;
  workspaceError: string | null;
  /** ?file= での初期章選択（原稿タブからの相互リンク。章一覧に無いパスは無視する。SPEC-phase4 §3.1） */
  initialFile: string | null;
  /** 原稿パス → 紐づくシーン／章（逆引き。SPEC-manuscript-bridge §4.4） */
  linkedScenes: Record<string, LinkedScene[]>;
}) {
  // 設定フォームのコミット後にテーマ・章一覧を取り直すため state で持つ（初期値はサーバー）
  const [ws, setWs] = useState<EditorWorkspaceData | null>(workspace);
  const ok = ws && ws.gate === "ok" ? ws : null;

  const [chapters, setChapters] = useState<EditorChapter[]>(ok?.chapters ?? []);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);
  /** エディタの作り直し用（章切替・復元・マージ取り込みでインクリメント） */
  const [editorEpoch, setEditorEpoch] = useState(0);
  /** エディタ作り直し時の初期本文（以後の打鍵は contentRef が正） */
  const [editorDoc, setEditorDoc] = useState("");
  const [dirty, setDirty] = useState(false);
  const [restorePrompt, setRestorePrompt] = useState<Draft | null>(null);
  const [merge, setMerge] = useState<MergeState | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newChapterOpen, setNewChapterOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  /** 青空文庫形式の書き出し（SPEC-aozora-export）。source は開いた時点の編集中本文 */
  const [aozoraSource, setAozoraSource] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [typesetting, setTypesetting] = useState(false);
  const [fullPreview, setFullPreview] = useState(false);
  const [fullPreviewLoading, setFullPreviewLoading] = useState(false);
  /** 本文の字数（コメント・記法除外。SPEC-phase3 §5）。null は章未選択 */
  const [charCount, setCharCount] = useState<number | null>(null);
  /** Vivliostyle が組んだ実ページ数（編集で無効化→概算値へ戻す） */
  const [actualPages, setActualPages] = useState<number | null>(null);
  /** 編集中の章のコメント一覧（SPEC-phase3 §3） */
  const [comments, setComments] = useState<ManuscriptComment[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"chapters" | "comments">(
    "chapters",
  );

  const {
    sidebarOpen,
    setSidebarOpen,
    previewOpen,
    setPreviewOpen,
    focusMode,
    setFocusMode,
    ratio,
    dragging,
    splitRef,
    startDrag,
  } = usePaneLayout();

  const currentRef = useRef<CurrentChapter | null>(null);
  const contentRef = useRef("");
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** previewHtml と対になる表示名（組版時点で確定。章切替中に古いHTMLへ新タイトルが付くのを防ぐ） */
  const previewTitleRef = useRef("プレビュー");
  const editorViewRef = useRef<EditorView | null>(null);

  /** 版面（行数×字詰め）: テーマCSSから抽出。ページ数概算に使う */
  const kumi = useMemo(
    () => (ok ? extractKumiSettings(ok.theme.inlineCss) : null),
    [ok],
  );

  // compilePreview が設定コミット直後の新テーマを拾えるよう ref でも持つ
  const okRef = useRef(ok);
  useEffect(() => {
    okRef.current = ok;
  }, [ok]);

  const {
    draftPaths,
    keyFor,
    markDraft,
    persistDraft,
    flushDraft,
    scheduleDraft,
  } = useDraftStore({
    repo: ok?.repo ?? null,
    branch: ok?.branch ?? null,
    currentRef,
    contentRef,
  });

  /** リポジトリルートのパス → 画像プロキシURL（SPEC §5.3。base_path 起点の相対に直して渡す） */
  const assetUrl = useCallback(
    (repoPath: string) => {
      const basePath = ok?.basePath ?? "";
      const relative =
        basePath !== "" && repoPath.startsWith(`${basePath}/`)
          ? repoPath.slice(basePath.length + 1)
          : repoPath;
      // 非デフォルトブランチでは対象ブランチの画像を引く（SPEC-phase5 §3.4）
      const branchQuery =
        ok && ok.branch !== ok.defaultBranch
          ? `&branch=${encodeURIComponent(ok.branch)}`
          : "";
      return `${window.location.origin}/api/editor/asset?projectId=${projectId}&path=${encodeURIComponent(relative)}${branchQuery}`;
    },
    [ok, projectId],
  );

  const fileName = useCallback(
    (path: string) => path.split("/").pop() ?? path,
    [],
  );

  /** 部分プレビューの再組版（デバウンス済みの呼び出しのみ想定。SPEC §5.1） */
  const compilePreview = useCallback(() => {
    const current = currentRef.current;
    const okNow = okRef.current;
    if (!okNow || !current) return;
    const html = buildPreviewHtml({
      chapters: [{ path: current.path, content: contentRef.current }],
      theme: okNow.theme,
      title: fileName(current.path),
      origin: window.location.origin,
      assetUrl,
    });
    previewTitleRef.current = fileName(current.path);
    setPreviewHtml(html);
    setTypesetting(true);
    setFullPreview(false);
  }, [assetUrl, fileName]);

  /** 字数・コメント一覧を内容から再計算する（打鍵側はデバウンスして呼ぶ） */
  const refreshDerived = useCallback((content: string) => {
    setCharCount(countManuscriptChars(content));
    setComments(extractComments(content));
  }, []);
  const recount = useCallback(
    () => refreshDerived(contentRef.current),
    [refreshDerived],
  );

  const onDocChange = useCallback(
    (content: string) => {
      const current = currentRef.current;
      contentRef.current = content;
      if (!current) return;
      setDirty(content !== current.remoteContent);
      // 編集で実ページ数は古くなる → 概算値表示へ戻す（次の組版完了で再取得）
      setActualPages(null);
      scheduleDraft();
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewTimerRef.current = setTimeout(compilePreview, PREVIEW_DEBOUNCE_MS);
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
      countTimerRef.current = setTimeout(recount, COUNT_DEBOUNCE_MS);
    },
    [scheduleDraft, compilePreview, recount],
  );

  // アンマウント時: 組版・字数の予約を止める（待避の確定は useDraftStore 側が担う）
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
    };
  }, []);

  /** 章を開く（SPEC §7 復元フロー込み） */
  const openChapterFlow = useCallback(
    async (path: string) => {
      if (!ok) return;
      flushDraft();
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      setSelectedPath(path);
      setChapterLoading(true);
      setChapterError(null);
      setRestorePrompt(null);
      setMerge(null);
      setDirty(false);
      // 取得待ちの間にブランチが切り替わったら、旧ブランチの内容で状態を上書きしない
      // （SPEC-phase5。自己レビュー指摘: 切替後の待避を誤削除しうるレースの防止）
      const branchAtStart = ok.branch;
      try {
        const result = await openChapter(projectId, path, ok.branch);
        if (okRef.current?.branch !== branchAtStart) return;
        if (!result.ok || !result.data) {
          setChapterError(
            result.ok ? "章の読み込みに失敗しました" : result.error.message,
          );
          currentRef.current = null;
          return;
        }
        const data = result.data;
        currentRef.current = {
          path: data.path,
          baseSha: data.sha,
          remoteContent: data.content,
        };
        contentRef.current = data.content;
        refreshDerived(data.content);
        setActualPages(null);

        const draft = await getDraft(keyFor(path)).catch(() => null);
        if (draft && draft.content !== data.content) {
          if (draft.baseSha !== data.sha) {
            // 待避中に他所が更新 → 競合フロー（SPEC §7-3 → §8）
            setMerge({
              remoteContent: data.content,
              remoteSha: data.sha,
              localContent: draft.content,
            });
          } else {
            setRestorePrompt(draft);
          }
        } else if (draft) {
          // リモートと同一の待避は不要（正は常にGitHub）
          deleteDraft(keyFor(path)).catch(() => {});
          markDraft(path, false);
        }
        setEditorDoc(data.content);
        setEditorEpoch((epoch) => epoch + 1);
        compilePreview();
      } finally {
        setChapterLoading(false);
      }
    },
    [
      ok,
      projectId,
      flushDraft,
      keyFor,
      markDraft,
      compilePreview,
      refreshDerived,
    ],
  );

  // ?file= の初期章選択（初回のみ。章一覧との一致でのみ採用する多層防御。SPEC-phase4 §3.1）。
  // openChapterFlow は同期 setState を含むため、effect 本体から直接呼ばずタイマー経由で呼ぶ
  const initialChapterRef = useRef(
    initialFile &&
      (ok?.chapters.some((chapter) => chapter.path === initialFile) ?? false)
      ? initialFile
      : null,
  );
  useEffect(() => {
    if (initialChapterRef.current === null) return;
    const timer = setTimeout(() => {
      const path = initialChapterRef.current;
      initialChapterRef.current = null;
      if (path !== null) void openChapterFlow(path);
    }, 0);
    return () => clearTimeout(timer);
  }, [openChapterFlow]);

  /** 復元バナー: 待避を取り込む（SPEC §7-2） */
  const restoreDraft = useCallback(() => {
    const current = currentRef.current;
    if (!current || !restorePrompt) return;
    contentRef.current = restorePrompt.content;
    setDirty(restorePrompt.content !== current.remoteContent);
    refreshDerived(restorePrompt.content);
    setRestorePrompt(null);
    setEditorDoc(restorePrompt.content);
    setEditorEpoch((epoch) => epoch + 1);
    compilePreview();
  }, [restorePrompt, compilePreview, refreshDerived]);

  /** 復元バナー: 待避を破棄する */
  const discardDraft = useCallback(() => {
    const current = currentRef.current;
    if (!current) return;
    deleteDraft(keyFor(current.path)).catch(() => {});
    markDraft(current.path, false);
    setRestorePrompt(null);
  }, [keyFor, markDraft]);

  const requestSave = useCallback(() => {
    if (!currentRef.current || saving) return;
    flushDraft();
    setSaveDialogOpen(true);
  }, [saving, flushDraft]);

  const {
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
  } = useReviewPanel({
    projectId,
    currentRef,
    contentRef,
    okRef,
    editorViewRef,
    previewOpen,
    setPreviewOpen,
    requestSave,
    openChapterFlow,
  });

  /** 保存＝コミット（SPEC §6）。conflict はマージ支援へ（SPEC §8-1） */
  const confirmSave = useCallback(
    async (message: string) => {
      const current = currentRef.current;
      if (!current) return;
      setSaving(true);
      try {
        const result = await saveChapter(projectId, current.path, {
          content: contentRef.current,
          baseSha: current.baseSha,
          message,
          branch: okRef.current?.branch,
        });
        if (!result.ok || !result.data) {
          if (!result.ok && result.error.code === "conflict") {
            // 競合時は「保存後に校正パネルを開く」予約も落とす（後日の無関係な保存で開かないように）
            pendingProofreadRef.current = false;
            setSaveDialogOpen(false);
            const remote = await openChapter(
              projectId,
              current.path,
              okRef.current?.branch,
            );
            if (remote.ok && remote.data) {
              setMerge({
                remoteContent: remote.data.content,
                remoteSha: remote.data.sha,
                localContent: contentRef.current,
              });
              toast.error(
                "原稿がリモートで更新されています。差分を確認して取り込んでください",
              );
            } else {
              toast.error(
                "リモートの最新取得に失敗しました。もう一度保存してください",
              );
            }
            return;
          }
          toast.error(result.ok ? "保存に失敗しました" : result.error.message);
          return;
        }
        // 新しい blob SHA を基準に進める（再取得なしの自己更新。SPEC §6）
        currentRef.current = {
          ...current,
          baseSha: result.data.blobSha,
          remoteContent: contentRef.current,
        };
        setDirty(false);
        deleteDraft(keyFor(current.path)).catch(() => {});
        markDraft(current.path, false);
        setSaveDialogOpen(false);
        toast.success("コミットしました");
        compilePreview();
        // 校正ボタン起点の保存だった場合は、そのまま校正パネルを開く（Issue #18）
        if (pendingProofreadRef.current) {
          pendingProofreadRef.current = false;
          void openProofread();
        }
      } finally {
        setSaving(false);
      }
    },
    [
      projectId,
      keyFor,
      markDraft,
      compilePreview,
      openProofread,
      pendingProofreadRef,
    ],
  );

  /** マージ結果を編集へ取り込む（リモートSHAが新しい基準になる。SPEC §8） */
  const adoptMerge = useCallback(
    (merged: string) => {
      const current = currentRef.current;
      if (!current || !merge) return;
      currentRef.current = {
        ...current,
        baseSha: merge.remoteSha,
        remoteContent: merge.remoteContent,
      };
      contentRef.current = merged;
      const isDirty = merged !== merge.remoteContent;
      setDirty(isDirty);
      refreshDerived(merged);
      // currentRef を新基準に進めた上で待避を確定する（dirty なら保存・同一なら破棄）
      persistDraft();
      setMerge(null);
      setEditorDoc(merged);
      setEditorEpoch((epoch) => epoch + 1);
      compilePreview();
    },
    [merge, persistDraft, compilePreview, refreshDerived],
  );

  /** ローカル編集を破棄してリモート最新を開き直す */
  const discardLocalForMerge = useCallback(() => {
    const current = currentRef.current;
    if (!current) return;
    deleteDraft(keyFor(current.path)).catch(() => {});
    markDraft(current.path, false);
    setMerge(null);
    void openChapterFlow(current.path);
  }, [keyFor, markDraft, openChapterFlow]);

  /** 全体プレビュー（明示操作。SPEC §5.2） */
  const startFullPreview = useCallback(async () => {
    if (!ok) return;
    flushDraft();
    setFullPreviewLoading(true);
    try {
      const result = await getAllChapterContents(projectId, ok.branch);
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "全章の取得に失敗しました" : result.error.message,
        );
        return;
      }
      // 開いている章は編集中の内容を使う（保存前でも全体を確認できるように）
      const current = currentRef.current;
      const chapterContents = result.data.chapters.map((chapter) =>
        current && chapter.path === current.path
          ? { path: chapter.path, content: contentRef.current }
          : chapter,
      );
      const html = buildPreviewHtml({
        chapters: chapterContents,
        theme: ok.theme,
        title: "全体プレビュー",
        origin: window.location.origin,
        assetUrl,
      });
      previewTitleRef.current = "全体プレビュー";
      setPreviewHtml(html);
      setTypesetting(true);
      setFullPreview(true);
      setPreviewOpen(true);
    } finally {
      setFullPreviewLoading(false);
    }
  }, [ok, projectId, flushDraft, assetUrl, setPreviewOpen]);

  /** 新規章の作成＝コミット（SPEC §3.3。entry へは自動追記される。SPEC-phase3 §7-2） */
  const handleCreateChapter = useCallback(
    async (name: string) => {
      setCreating(true);
      try {
        const result = await createChapter(
          projectId,
          name,
          okRef.current?.branch,
        );
        if (!result.ok || !result.data) {
          toast.error(
            result.ok ? "章の作成に失敗しました" : result.error.message,
          );
          return;
        }
        const { path, inEntry } = result.data;
        setChapters((prev) =>
          prev.some((chapter) => chapter.path === path)
            ? prev
            : [...prev, { path, inEntry }],
        );
        setNewChapterOpen(false);
        toast.success(
          inEntry
            ? "章を作成し、entry に追記してコミットしました"
            : "章を作成してコミットしました（entry への追記はできませんでした）",
        );
        await openChapterFlow(path);
      } finally {
        setCreating(false);
      }
    },
    [projectId, openChapterFlow],
  );

  /** 設定コミット後の再取得（章一覧の順序・テーマCSSに反映。SPEC-phase3 §7。現在ブランチを維持） */
  const refreshWorkspace = useCallback(async () => {
    const result = await getEditorWorkspace(projectId, okRef.current?.branch);
    if (result.ok && result.data) {
      setWs(result.data);
      if (result.data.gate === "ok") {
        setChapters(result.data.chapters);
        okRef.current = result.data;
      }
    }
  }, [projectId]);

  const handleSettingsSaved = useCallback(() => {
    void refreshWorkspace().then(() => {
      // 新しいテーマ（組み設定）でプレビューを組み直す
      if (currentRef.current) compilePreview();
    });
  }, [refreshWorkspace, compilePreview]);

  // ---- ブランチ切替・作成・PR（SPEC-vertical-editor-phase5） ----

  /** 新ブランチのワークスペースを反映（章の選択状態・プレビュー等のリセット込み） */
  const applyWorkspace = useCallback((data: OkWorkspace) => {
    setSelectedPath(null);
    currentRef.current = null;
    contentRef.current = "";
    setPreviewHtml(null);
    setFullPreview(false);
    setMerge(null);
    setRestorePrompt(null);
    setDirty(false);
    setCharCount(null);
    setActualPages(null);
    setComments([]);
    setSidebarTab("chapters");
    setWs(data);
    setChapters(data.chapters);
    okRef.current = data;
  }, []);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
  }, []);

  const {
    branchSwitching,
    branchCreateOpen,
    setBranchCreateOpen,
    branchCreating,
    prOpen,
    setPrOpen,
    switchBranch,
    handleCreateBranch,
  } = useBranchState({
    projectId,
    ok,
    okRef,
    flushDraft,
    clearPreviewTimer,
    closeReviewPanel,
    applyWorkspace,
  });

  const {
    pendingImage,
    setPendingImage,
    uploadingImage,
    confirmImageUpload,
    imageInputRef,
  } = useImageUpload({ projectId, okRef, editorViewRef });

  const { jumpToComment, deleteComment } = useCommentActions({
    editorViewRef,
    recount,
  });

  /** 講評パネルを開く（デフォルトブランチが対象のまま。SPEC-phase5 §3.4・論点G。注記のみ） */
  const openCritique = useCallback(() => {
    const okNow = okRef.current;
    if (okNow && okNow.branch !== okNow.defaultBranch) {
      toast.info(
        `講評はデフォルトブランチ（${okNow.defaultBranch}）のコミット内容が対象です`,
      );
    }
    openReviewPanel("critique");
  }, [openReviewPanel]);

  /** 章の選択（校正パネルは開いていた章に紐づくため、章の切替で閉じる。講評は作品全体なので維持） */
  const handleSelectChapter = useCallback(
    (path: string) => {
      if (path !== selectedPath && reviewOpen === "proofread") {
        closeReviewPanel();
      }
      void openChapterFlow(path);
    },
    [selectedPath, reviewOpen, closeReviewPanel, openChapterFlow],
  );

  const { detached, toggleDetachedPreview } = useDetachedPreview({
    projectId,
    previewHtml,
    fullPreview,
    previewTitleRef,
    onPages: setActualPages,
  });

  // ---- 前提未達（repo/PAT）の誘導表示（原稿タブと同じ作法） ----
  if (workspaceError) {
    return <EditorGuidance kind="error" message={workspaceError} />;
  }
  if (!ws || ws.gate === "no_pat") {
    return <EditorGuidance kind="no_pat" />;
  }
  if (ws.gate === "no_repo") {
    return <EditorGuidance kind="no_repo" />;
  }

  // ここまでのガードで gate は 'ok' に絞り込まれている（JSX用の非null別名）
  const okWs = ws;
  const selectedName = selectedPath ? fileName(selectedPath) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <EditorTopBar
        focusMode={focusMode}
        sidebarOpen={sidebarOpen}
        selectedName={selectedName}
        selectedPath={selectedPath}
        dirty={dirty}
        saving={saving}
        merging={merge !== null}
        chapterLoading={chapterLoading}
        charCount={charCount}
        actualPages={actualPages}
        kumi={kumi}
        chaptersCount={chapters.length}
        projectId={projectId}
        fullPreviewLoading={fullPreviewLoading}
        detached={detached}
        previewOpen={previewOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onRequestSave={requestSave}
        onOpenProofread={() => void openProofread()}
        onOpenCritique={openCritique}
        onOpenSettings={() => setSettingsOpen(true)}
        onExportAozora={() => setAozoraSource(contentRef.current)}
        onOpenBuild={() => setBuildOpen(true)}
        onStartFullPreview={() => void startFullPreview()}
        onToggleDetached={toggleDetachedPreview}
        onTogglePreview={() => setPreviewOpen((open) => !open)}
        onEnterFocus={() => setFocusMode(true)}
        onExitFocus={() => setFocusMode(false)}
      />

      <div className="flex min-h-0 flex-1">
        {/* 章一覧サイドバー（SPEC §3.3。集中モード中は隠す） */}
        {sidebarOpen && !focusMode && (
          <EditorSidebar
            projectId={projectId}
            branch={okWs.branch}
            defaultBranch={okWs.defaultBranch}
            branchSwitching={branchSwitching}
            selectedPath={selectedPath}
            chapters={chapters}
            draftPaths={draftPaths}
            dirty={dirty}
            comments={comments}
            sidebarTab={sidebarTab}
            onSidebarTabChange={setSidebarTab}
            onSwitchBranch={(name) => void switchBranch(name)}
            onCreateBranchRequest={() => setBranchCreateOpen(true)}
            onPrRequest={() => setPrOpen(true)}
            onSelectChapter={handleSelectChapter}
            onNewChapter={() => setNewChapterOpen(true)}
            onJumpToComment={jumpToComment}
            onDeleteComment={deleteComment}
            fileName={fileName}
            linkedScenes={
              selectedPath === null ? [] : (linkedScenes[selectedPath] ?? [])
            }
          />
        )}

        {/* 入力＋プレビュー（SPEC §3.2） */}
        <div
          ref={splitRef}
          className={cn(
            "min-w-0 flex-1 flex-col lg:flex-row",
            selectedPath === null && sidebarOpen ? "hidden lg:flex" : "flex",
          )}
        >
          {selectedPath === null ? (
            <p className="p-6 text-sm text-muted-foreground">
              左の一覧から章を選ぶと執筆をはじめられます
            </p>
          ) : (
            <>
              <div
                className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-none"
                style={
                  previewOpen && !detached
                    ? { flexBasis: `${ratio * 100}%` }
                    : { flexBasis: "100%" }
                }
              >
                {/* モバイル: 一覧へ戻る（集中モード中は隠す） */}
                <div
                  className={cn(
                    "flex items-center gap-2 border-b border-border px-2 py-1 lg:hidden",
                    focusMode && "hidden",
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="章一覧へ戻る"
                    className="text-muted-foreground"
                    onClick={() => {
                      flushDraft();
                      if (reviewOpen === "proofread") closeReviewPanel();
                      setSelectedPath(null);
                      currentRef.current = null;
                      setPreviewHtml(null);
                      setMerge(null);
                      setRestorePrompt(null);
                      setDirty(false);
                      setCharCount(null);
                      setActualPages(null);
                      setComments([]);
                      setSidebarTab("chapters");
                      setSidebarOpen(true);
                    }}
                  >
                    <ArrowLeft />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    章一覧へ戻る
                  </span>
                </div>

                {restorePrompt && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground">
                    <Info className="size-4 shrink-0" />
                    <span className="min-w-0">
                      未保存の編集があります（
                      {new Date(restorePrompt.updatedAt).toLocaleString(
                        "ja-JP",
                      )}{" "}
                      時点）
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={discardDraft}
                      >
                        破棄する
                      </Button>
                      <Button size="sm" onClick={restoreDraft}>
                        復元する
                      </Button>
                    </span>
                  </div>
                )}

                {chapterLoading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2
                      className="size-5 animate-spin text-muted-foreground"
                      aria-label="読み込み中"
                    />
                  </div>
                ) : chapterError ? (
                  <p className="p-4 text-sm text-destructive">{chapterError}</p>
                ) : merge ? (
                  <MergePane
                    remoteContent={merge.remoteContent}
                    localContent={merge.localContent}
                    onAdopt={adoptMerge}
                    onDiscardLocal={discardLocalForMerge}
                  />
                ) : (
                  <>
                    <EditorToolbar
                      viewRef={editorViewRef}
                      direction={ok?.theme.direction ?? "vertical"}
                      onImageRequest={() => imageInputRef.current?.click()}
                    />
                    <div className="min-h-0 flex-1">
                      <EditorPane
                        key={`${selectedPath}:${editorEpoch}`}
                        initialContent={editorDoc}
                        onDocChange={onDocChange}
                        onSaveRequest={requestSave}
                        onImageDrop={setPendingImage}
                        onSelectionChange={handleSelectionChange}
                        viewRef={editorViewRef}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* 比率ドラッグ用の仕切り（デスクトップのみ） */}
              {previewOpen && !detached && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="ペイン幅の調整"
                  className="hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 lg:block"
                  onPointerDown={startDrag}
                />
              )}

              {previewOpen && !detached && (
                <div
                  className={cn(
                    "hidden min-h-0 min-w-0 flex-1 flex-col border-border lg:flex",
                    dragging && "pointer-events-none select-none",
                  )}
                >
                  {fullPreview && (
                    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
                      <Info className="size-3.5 shrink-0" />
                      <span className="min-w-0">
                        全体プレビュー（目次ページは入稿ビルドでのみ生成されます。扉・奥付の専用様式は章単体プレビューで確認してください）
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto shrink-0"
                        onClick={compilePreview}
                      >
                        編集中の章に戻る
                      </Button>
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <PreviewPane
                      html={previewHtml}
                      typesetting={typesetting}
                      onLoaded={() => setTypesetting(false)}
                      // 実ページ数は編集章の部分プレビューのみ反映（全体プレビューは書籍全体の値になるため）
                      onPageCount={fullPreview ? undefined : setActualPages}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* エディタ内レビューパネル（Issue #18）。lg以上は右パネル、未満はボトムシート（原稿タブと同じ流儀） */}
        {reviewOpen === "proofread" &&
          !focusMode &&
          (reviewFile === null ? (
            <aside
              aria-label="校正パネル"
              className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
            >
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
                {reviewLoading ? (
                  <Loader2
                    className="size-5 animate-spin text-muted-foreground"
                    aria-label="読み込み中"
                  />
                ) : (
                  <>
                    <p className="text-sm text-destructive">
                      {reviewError ?? "原稿情報の読み込みに失敗しました"}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={closeReviewPanel}
                    >
                      閉じる
                    </Button>
                  </>
                )}
              </div>
            </aside>
          ) : (
            <ProofreadPanel
              key={reviewFile.linkId}
              linkId={reviewFile.linkId}
              content={reviewFile.content}
              suggestions={reviewFile.suggestions}
              selection={proofreadSelection}
              onUpdateStatus={handleUpdateSuggestion}
              onLocate={locateInEditor}
              onCompleted={refreshReview}
              onClose={closeReviewPanel}
            />
          ))}
        {reviewOpen === "critique" && !focusMode && (
          <CritiquePanel projectId={projectId} onClose={closeReviewPanel} />
        )}
      </div>

      <SaveDialog
        open={saveDialogOpen}
        branch={okWs.branch}
        defaultMessage={
          selectedName
            ? `執筆: ${selectedName} を更新（ネコノテAI 縦書きエディタ）`
            : ""
        }
        saving={saving}
        onConfirm={(message) => void confirmSave(message)}
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          // 保存せず閉じたら「保存後に校正パネルを開く」予約も解除する
          if (!open) pendingProofreadRef.current = false;
        }}
      />
      <NewChapterDialog
        open={newChapterOpen}
        creating={creating}
        onCreate={(name) => void handleCreateChapter(name)}
        onOpenChange={setNewChapterOpen}
      />
      <SettingsDialog
        projectId={projectId}
        branch={okWs.branch}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={handleSettingsSaved}
        onOpenChapter={(path) => void openChapterFlow(path)}
      />
      <BuildDialog
        projectId={projectId}
        open={buildOpen}
        dirty={dirty || draftPaths.size > 0}
        nonDefaultBranch={okWs.branch !== okWs.defaultBranch}
        onOpenChange={setBuildOpen}
      />
      <AozoraExportDialog
        open={aozoraSource !== null}
        fileName={selectedName ?? "chapter.txt"}
        source={aozoraSource ?? ""}
        onOpenChange={(open) => {
          if (!open) setAozoraSource(null);
        }}
      />
      <BranchCreateDialog
        open={branchCreateOpen}
        defaultBranch={okWs.defaultBranch}
        creating={branchCreating}
        onCreate={(name) => void handleCreateBranch(name)}
        onOpenChange={setBranchCreateOpen}
      />
      <PrCreateDialog
        projectId={projectId}
        branch={okWs.branch}
        defaultBranch={okWs.defaultBranch}
        open={prOpen}
        onOpenChange={setPrOpen}
      />
      {/* 種別・キャプションはファイルごとに初期化する（key） */}
      <ImageUploadDialog
        key={
          pendingImage
            ? `${pendingImage.name}:${pendingImage.lastModified}`
            : "none"
        }
        file={pendingImage}
        uploading={uploadingImage}
        onConfirm={(params) => void confirmImageUpload(params)}
        onCancel={() => setPendingImage(null)}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (file) setPendingImage(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
