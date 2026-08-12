"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  detachedPreviewUrl,
  previewChannelName,
} from "@/lib/editor/preview-channel";
import type { PreviewChannelMessage } from "@/lib/editor/preview-channel";

/**
 * プレビューの別ウィンドウ分離（Issue #72）。
 * BroadcastChannel の常時接続・HTML転送・閉窓検知・トグルを担う
 */
export function useDetachedPreview({
  projectId,
  previewHtml,
  fullPreview,
  previewTitleRef,
  onPages,
}: {
  projectId: string;
  previewHtml: string | null;
  fullPreview: boolean;
  /** previewHtml と対になる表示名（組版時点で確定） */
  previewTitleRef: React.RefObject<string>;
  /** 分離窓からの実ページ数通知（編集章の部分プレビューのみ） */
  onPages: (total: number) => void;
}) {
  const [detached, setDetached] = useState(false);
  /** 分離窓からの ready（初回・リロード）で現在のHTMLを送り直すためのトリガー */
  const [resendTick, setResendTick] = useState(0);
  const popupRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onPagesRef = useRef(onPages);
  useEffect(() => {
    onPagesRef.current = onPages;
  }, [onPages]);

  // 分離窓との通信チャンネル。窓のリロード時の ready も拾えるよう、常時張っておく
  useEffect(() => {
    const channel = new BroadcastChannel(previewChannelName(projectId));
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<PreviewChannelMessage>) => {
      const message = event.data;
      if (message.type === "ready") {
        // 窓側の準備完了（URL直開き・リロード含む）→ 分離モードにして現在のHTMLを送る
        setDetached(true);
        setResendTick((tick) => tick + 1);
      } else if (message.type === "pages") {
        // 実ページ数は編集章の部分プレビューのみ反映（インライン時と同じ条件）
        if (!message.full) onPagesRef.current(message.total);
      } else if (message.type === "closed") {
        setDetached(false);
      }
    };
    // リロード等で開いたままの分離窓があれば再接続させる（窓が ready を返す）
    channel.postMessage({ type: "hello" } satisfies PreviewChannelMessage);
    return () => {
      channel.close();
      channelRef.current = null;
      // エディタを離れたら分離窓も閉じる（宙に浮いた古いプレビューを残さない）
      popupRef.current?.close();
      popupRef.current = null;
    };
  }, [projectId]);

  // 分離中はプレビューHTMLの更新を窓へ送る（再組版は窓側の Viewer が行う）
  useEffect(() => {
    if (!detached || previewHtml === null) return;
    channelRef.current?.postMessage({
      type: "document",
      html: previewHtml,
      full: fullPreview,
      title: previewTitleRef.current,
    } satisfies PreviewChannelMessage);
  }, [detached, previewHtml, fullPreview, resendTick, previewTitleRef]);

  // pagehide が飛ばない閉じ方（プロセス終了等）への保険として閉窓をポーリング検知
  useEffect(() => {
    if (!detached) return;
    const timer = setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setDetached(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [detached]);

  const toggleDetachedPreview = useCallback(() => {
    if (detached) {
      popupRef.current?.close();
      popupRef.current = null;
      setDetached(false);
      return;
    }
    // 同名ウィンドウは再利用される（多重に開かない）。popup 指定でタブでなく独立ウィンドウに
    const popup = window.open(
      detachedPreviewUrl(projectId),
      `nekonote-preview-${projectId}`,
      "popup=yes,width=900,height=1000",
    );
    if (!popup) {
      toast.error(
        "ポップアップがブロックされました。ブラウザの設定で許可してください",
      );
      return;
    }
    popupRef.current = popup;
    setDetached(true);
  }, [detached, projectId]);

  return { detached, toggleDetachedPreview };
}
