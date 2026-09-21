"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteDraft,
  draftKey,
  getDraft,
  listDraftKeys,
  setDraft,
} from "@/lib/editor/draft-store";
import type { Draft } from "@/lib/editor/draft-store";
import type { CurrentChapter } from "@/components/editor/editor-state";

/** 待避1件（一括コミットの対象。`path` はリポジトリルートからのパス） */
export type DraftEntry = Draft & { path: string };

// 待避（IndexedDB）のデバウンス（SPEC-vertical-editor-phase2 §5.1・§7）
const DRAFT_DEBOUNCE_MS = 1000;

/** 永続化要求は1タブにつき1回でよい（結果は拒否でも構わない） */
let persistRequested = false;

/**
 * 待避領域を永続バケットへ昇格させる（Issue #255-1）。
 * 既定の best-effort バケットはディスク逼迫時にオリジンごと退去されうる。
 * 未コミットの本文はまだ GitHub に無いため、退去＝原稿の消失になる。
 * 非対応ブラウザ・拒否時は何もしない（待避が消えうる前提は変わらない）
 */
function requestPersistentStorage(): void {
  if (persistRequested) return;
  persistRequested = true;
  navigator.storage?.persist?.().catch(() => {});
}

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
    requestPersistentStorage();
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

  /**
   * 現在の内容で待避を即時確定する（デバウンス中の分を落とさない）。
   * 書き込みの完了を待てるよう Promise を返す（一括コミットの収集が使う）
   */
  const persistDraft = useCallback((): Promise<void> => {
    const current = currentRef.current;
    if (!current) return Promise.resolve();
    const content = contentRef.current;
    const key = keyFor(current.path);
    if (content === current.remoteContent) {
      markDraft(current.path, false);
      return deleteDraft(key).catch(() => {});
    }
    markDraft(current.path, true);
    return setDraft(key, {
      content,
      baseSha: current.baseSha,
      updatedAt: Date.now(),
    }).catch(() => {});
  }, [keyFor, markDraft, currentRef, contentRef]);

  const flushDraft = useCallback((): Promise<void> => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    return persistDraft();
  }, [persistDraft]);

  /**
   * 待避中の章をすべて集める（一括コミットの対象。Issue #255-2）。
   * 編集中の章を取りこぼさないよう、確定の完了を待ってから読み出す。
   * 一覧の順序は章のパス昇順（サイドバーの並びとは別物だが安定する）
   */
  const collectDrafts = useCallback(async (): Promise<DraftEntry[]> => {
    await flushDraft();
    if (repo === null || branch === null) return [];
    const prefix = `${repo}:${branch}:`;
    const keys = await listDraftKeys(prefix);
    const entries = await Promise.all(
      keys.sort().map(async (key) => {
        const draft = await getDraft(key);
        return draft === null
          ? null
          : { ...draft, path: key.slice(prefix.length) };
      }),
    );
    return entries.filter((entry): entry is DraftEntry => entry !== null);
  }, [flushDraft, repo, branch]);

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
    collectDrafts,
  };
}
