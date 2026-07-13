"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "saving" | "offline";

export const AUTOSAVE_DELAY_MS = 2000;

export type StoredDraft<T> = { payload: T; savedAt: number };

/** localStorage のドラフトを読む（形式不正は null） */
export function readStoredDraft<T>(key: string): StoredDraft<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft<T>>;
    if (parsed.payload === undefined || typeof parsed.savedAt !== "number") return null;
    return { payload: parsed.payload, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function clearStoredDraft(key: string) {
  localStorage.removeItem(key);
}

/**
 * ノート・企画書で共用する自動保存（SPEC-notes §3.3 / SPEC-proposal-review §3.2）。
 * 2秒デバウンス＋ページ離脱・バックグラウンド化・アンマウント時の即時フラッシュ。
 * 保存失敗（401・ネットワーク断）時は localStorage へドラフト退避する（SPEC-auth §6）
 */
export function useAutosave<T>({
  storageKey,
  initialPayload,
  getPayload,
  save,
}: {
  storageKey: string;
  /** サーバー保存済みの初期値（差分がないときは保存しない） */
  initialPayload: T;
  /** 現在の編集内容。エディタ未生成時は null を返す */
  getPayload: () => T | null;
  save: (payload: T) => Promise<{ ok: boolean }>;
}) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const lastSavedRef = useRef<T>(initialPayload);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallback(async () => {
    const payload = getPayload();
    if (payload === null) return;
    if (JSON.stringify(payload) === JSON.stringify(lastSavedRef.current)) return;
    setStatus("saving");
    try {
      const result = await save(payload);
      if (!result.ok) throw new Error("save failed");
      lastSavedRef.current = payload;
      clearStoredDraft(storageKey);
      setStatus("saved");
    } catch {
      const draft: StoredDraft<T> = { payload, savedAt: Date.now() };
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setStatus("offline");
    }
  }, [getPayload, save, storageKey]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(doSave, AUTOSAVE_DELAY_MS);
  }, [doSave]);

  /** デバウンスを打ち切って即時保存する（ごみ箱移動・レビュー実行前など） */
  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await doSave();
  }, [doSave]);

  useEffect(() => {
    function flushNow() {
      if (timerRef.current) clearTimeout(timerRef.current);
      void doSave();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushNow();
    }
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushNow();
    };
  }, [doSave]);

  return { status, scheduleSave, flush };
}
