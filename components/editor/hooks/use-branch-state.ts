"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { createEditorBranch, getEditorWorkspace } from "@/lib/actions/editor";
import type { EditorWorkspaceData } from "@/lib/actions/editor";

/** gate 'ok' に絞り込んだワークスペース（ブランチ操作はこの状態でのみ有効） */
export type OkWorkspace = Extract<EditorWorkspaceData, { gate: "ok" }>;

/**
 * ブランチ切替・作成・PR ダイアログ（SPEC-vertical-editor-phase5）。
 * 選択中ブランチの保持（URLクエリ＋localStorage）と初回同期も担う。
 * 章まわりの状態リセットは applyWorkspace（本体側）に委譲する
 */
export function useBranchState({
  projectId,
  ok,
  okRef,
  flushDraft,
  clearPreviewTimer,
  closeReviewPanel,
  applyWorkspace,
}: {
  projectId: string;
  ok: OkWorkspace | null;
  okRef: React.RefObject<OkWorkspace | null>;
  flushDraft: () => void;
  /** 切替時に部分プレビューの再組版予約を破棄する（旧ブランチの内容で上書きしない） */
  clearPreviewTimer: () => void;
  closeReviewPanel: () => void;
  /** 新ブランチのワークスペースを反映し、章の選択状態・プレビュー等をリセットする */
  applyWorkspace: (data: OkWorkspace) => void;
}) {
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [branchCreateOpen, setBranchCreateOpen] = useState(false);
  const [branchCreating, setBranchCreating] = useState(false);
  const [prOpen, setPrOpen] = useState(false);

  /** 選択中ブランチの保持（URLクエリ＋localStorage。デフォルトなら消す。SPEC-phase5 §3.1） */
  const rememberBranch = useCallback(
    (branchName: string, defaultBranchName: string) => {
      const isDefault = branchName === defaultBranchName;
      try {
        const key = `nekonote-editor-branch:${projectId}`;
        if (isDefault) localStorage.removeItem(key);
        else localStorage.setItem(key, branchName);
      } catch {
        // localStorage が使えない環境では URL のみで保持する
      }
      const url = new URL(window.location.href);
      if (isDefault) url.searchParams.delete("branch");
      else url.searchParams.set("branch", branchName);
      window.history.replaceState(null, "", url);
    },
    [projectId],
  );

  /**
   * ブランチ切替（SPEC-phase5 §3.1）。未保存の編集は待避してそのまま切り替える（論点F。
   * 下書きキーはブランチ別のため、元ブランチへ戻れば復元バナーで拾える）。
   * 章の選択状態・プレビューはリセットし、新ブランチの章一覧を取得し直す
   */
  const switchBranch = useCallback(
    async (nextBranch: string) => {
      const okNow = okRef.current;
      if (!okNow || nextBranch === okNow.branch) return;
      flushDraft();
      clearPreviewTimer();
      // 校正パネルは開いていた章に紐づくため切替で閉じる（章切替・モバイル戻ると同じ作法）
      closeReviewPanel();
      setBranchSwitching(true);
      try {
        const result = await getEditorWorkspace(projectId, nextBranch);
        if (!result.ok || !result.data || result.data.gate !== "ok") {
          toast.error(
            result.ok ? "ブランチの切替に失敗しました" : result.error.message,
          );
          return;
        }
        const data = result.data;
        applyWorkspace(data);
        rememberBranch(data.branch, data.defaultBranch);
        if (data.branchFallback) {
          toast.warning(
            `ブランチ ${nextBranch} が見つかりません。デフォルトブランチを開きました`,
          );
        } else {
          toast.success(`ブランチ ${data.branch} に切り替えました`);
        }
      } finally {
        setBranchSwitching(false);
      }
    },
    [
      projectId,
      flushDraft,
      clearPreviewTimer,
      rememberBranch,
      closeReviewPanel,
      applyWorkspace,
      okRef,
    ],
  );

  /** ブランチ作成→即切替（SPEC-phase5 §3.2。起点は常にデフォルトブランチのHEAD） */
  const handleCreateBranch = useCallback(
    async (name: string) => {
      setBranchCreating(true);
      try {
        const result = await createEditorBranch(projectId, name);
        if (!result.ok || !result.data) {
          toast.error(
            result.ok ? "ブランチの作成に失敗しました" : result.error.message,
          );
          return;
        }
        setBranchCreateOpen(false);
        toast.success(`ブランチ ${result.data.branch} を作成しました`);
        await switchBranch(result.data.branch);
      } finally {
        setBranchCreating(false);
      }
    },
    [projectId, switchBranch],
  );

  // 初回のブランチ同期（SPEC-phase5 §3.1）: サーバーがフォールバックしたら通知して保存値を
  // クリア。?branch= がなければ localStorage から復元する（?file= リンク経由の場合は
  // リンクの意図を優先して復元しない）
  const branchSyncedRef = useRef(false);
  useEffect(() => {
    if (branchSyncedRef.current || !ok) return;
    branchSyncedRef.current = true;
    if (ok.branchFallback) {
      toast.warning(
        "指定のブランチが見つからないため、デフォルトブランチを開きました",
      );
      rememberBranch(ok.branch, ok.defaultBranch);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("branch")) {
      // URL指定で開いた場合は localStorage をURLに合わせる
      rememberBranch(ok.branch, ok.defaultBranch);
      return;
    }
    if (params.get("file")) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(`nekonote-editor-branch:${projectId}`);
    } catch {
      stored = null;
    }
    if (stored && stored !== ok.branch) void switchBranch(stored);
  }, [ok, projectId, rememberBranch, switchBranch]);

  return {
    branchSwitching,
    branchCreateOpen,
    setBranchCreateOpen,
    branchCreating,
    prOpen,
    setPrOpen,
    switchBranch,
    handleCreateBranch,
  };
}
