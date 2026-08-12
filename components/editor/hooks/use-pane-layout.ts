"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useChrome } from "@/components/layout/app-chrome";

/**
 * ペインのレイアウト状態（SPEC-vertical-editor-phase2 §3.2）。
 * サイドバー/プレビューの開閉・比率ドラッグ・集中モード（クローム隠し・Esc解除）を担う
 */
export function usePaneLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  /** 集中モード: 入力ペイン（＋開いていればプレビュー）以外のクロームをすべて隠す */
  const [focusMode, setFocusMode] = useState(false);
  const [ratio, setRatio] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const { setHidden: setChromeHidden } = useChrome();

  // グローバルナビ＋プロジェクトヘッダーの表示を集中モードに同期（離脱時は必ず復帰させる）
  useEffect(() => {
    setChromeHidden(focusMode);
    return () => setChromeHidden(false);
  }, [focusMode, setChromeHidden]);

  // Esc で集中モードを解除
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

  /** ペイン比率のドラッグ可変（SPEC §3.2） */
  const startDrag = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setDragging(true);
    const onMove = (e: PointerEvent) => {
      const next = (e.clientX - rect.left) / rect.width;
      setRatio(Math.min(0.8, Math.max(0.25, next)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return {
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
  };
}
