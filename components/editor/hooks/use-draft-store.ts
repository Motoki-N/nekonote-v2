"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteDraft,
  draftKey,
  listDraftKeys,
  setDraft,
} from "@/lib/editor/draft-store";
import type { CurrentChapter } from "@/components/editor/editor-state";

// 待避（IndexedDB）のデバウンス（SPEC-vertical-editor-phase2 §5.1・§7）
const DRAFT_DEBOUNCE_MS = 1000;

/**
 * 未保存編集の IndexedDB 待避（SPEC-vertical-editor-phase2 §7）。
 * 待避キー解決・章ごとの未保存印・デバウンス書き込み・即時確定を担う。
 * 待避はキャッシュであり正は常に GitHub（IndexedDB 不可の環境では印なしで動く）
 */
export function useDraftStore({
  repo,
  branch,
  currentRef,
  contentRef,
}: {
  /** gate 未達（null）の間はキー解決を素通しにする */
  repo: string | null;
  branch: string | null;
  currentRef: React.RefObject<CurrentChapter | null>;
  contentRef: React.RefObject<string>;
}) {
  const [draftPaths, setDraftPaths] = useState<ReadonlySet<string>>(new Set());
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keyFor = useCallback(
    (path: string) =>
      repo !== null && branch !== null ? draftKey(repo, branch, path) : path,
    [repo, branch],
  );

  // 未保存待避のある章に印をつける（SPEC §3.3）
  useEffect(() => {
    if (repo === null || branch === null) return;
    const prefix = `${repo}:${branch}:`;
    listDraftKeys(prefix)
      .then((keys) =>
        setDraftPaths(new Set(keys.map((key) => key.slice(prefix.length)))),
      )
      .catch(() => {
        // IndexedDB が使えない環境では印なしで動かす（待避はキャッシュ。正はGitHub）
      });
  }, [repo, branch]);

  const markDraft = useCallback((path: string, has: boolean) => {
    setDraftPaths((prev) => {
      if (prev.has(path) === has) return prev;
      const next = new Set(prev);
      if (has) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  /** 現在の内容で待避を即時確定する（デバウンス中の分を落とさない） */
  const persistDraft = useCallback(() => {
    const current = currentRef.current;
    if (!current) return;
    const content = contentRef.current;
    const key = keyFor(current.path);
    if (content === current.remoteContent) {
      deleteDraft(key).catch(() => {});
      markDraft(current.path, false);
    } else {
      setDraft(key, {
        content,
        baseSha: current.baseSha,
        updatedAt: Date.now(),
      }).catch(() => {});
      markDraft(current.path, true);
    }
  }, [keyFor, markDraft, currentRef, contentRef]);

  const flushDraft = useCallback(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    persistDraft();
  }, [persistDraft]);

  /** 打鍵側から呼ぶデバウンス待避（DRAFT_DEBOUNCE_MS 後に確定） */
  const scheduleDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(persistDraft, DRAFT_DEBOUNCE_MS);
  }, [persistDraft]);

  // アンマウント時: タイマーを止め、待避を確定する
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      persistDraft();
    };
  }, [persistDraft]);

  return {
    draftPaths,
    keyFor,
    markDraft,
    persistDraft,
    flushDraft,
    scheduleDraft,
  };
}
