"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  PREVIEW_DISPLAY_STORAGE_KEY,
  parsePreviewDisplay,
} from "@/lib/editor/preview-display";
import type { PreviewDisplaySettings } from "@/lib/editor/preview-display";

// 同じウィンドウ内の書き込みは storage イベントが飛ばないため、自前で知らせる
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 別ウィンドウ（エディタ本体⇔分離プレビュー）の変更は storage イベントで届く
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREVIEW_DISPLAY_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(PREVIEW_DISPLAY_STORAGE_KEY);
  } catch {
    // localStorage が使えない環境では既定値で表示する
    return null;
  }
}

/**
 * プレビューの表示設定（Issue #370・SPEC-vertical-editor-phase2 §5.4）。
 * 全プロジェクト共通で localStorage に保持し、エディタ本体と分離プレビューウィンドウで揃える
 */
export function usePreviewDisplay() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const settings = useMemo(() => parsePreviewDisplay(raw), [raw]);

  const update = useCallback((patch: Partial<PreviewDisplaySettings>) => {
    const next = { ...parsePreviewDisplay(readRaw()), ...patch };
    try {
      localStorage.setItem(PREVIEW_DISPLAY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 保存できない環境では切り替え自体ができない（既定値のまま）
    }
    for (const listener of listeners) listener();
  }, []);

  return { settings, update };
}
