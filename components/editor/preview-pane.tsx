"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Crop, Loader2, RotateCw } from "lucide-react";

import { usePreviewDisplay } from "@/components/editor/hooks/use-preview-display";
import { Button } from "@/components/ui/button";
import { fragmentFromViewerHash, viewerUrl } from "@/lib/editor/preview";
import {
  applyPreviewDisplay,
  nextRotation,
} from "@/lib/editor/preview-display";
import { cn } from "@/lib/utils";

/** iframe 内の Viewer のステータス（loading / interactive / complete。未ロードは null） */
function viewerStatus(iframe: HTMLIFrameElement | null): string | null {
  try {
    return (
      iframe?.contentDocument
        ?.querySelector("[data-vivliostyle-viewer-viewport]")
        ?.getAttribute("data-vivliostyle-viewer-status") ?? null
    );
  } catch {
    return null;
  }
}

/**
 * プレビューペイン（SPEC-vertical-editor-phase2 §5.1）。
 * 組版済みHTMLをBlob URL化し、自前ホストの Vivliostyle Viewer（iframe）に読ませる。
 * iframe内の組版CSSは書籍テーマが正であり、アプリのライト/ダークに追従させない（規約の例外）
 */
export function PreviewPane({
  html,
  documentKey,
  typesetting,
  onLoaded,
  onPageCount,
}: {
  /** 組版対象の完成HTML。null はまだ章を開いていない状態 */
  html: string | null;
  /**
   * 組版対象の文書の同一性（章のパス / 全体プレビュー）。同じキーのまま html が変われば
   * 「同じ文書の再組版」とみなして表示位置を引き継ぐ（Issue #256）。
   * 章切替・全体プレビュー切替ではキーが変わり、先頭から表示する
   */
  documentKey: string | null;
  /** 組版中インジケータ（親が変換開始で立て、iframe ロードで下ろす） */
  typesetting: boolean;
  onLoaded: () => void;
  /** 組版が落ち着いた時点の実ページ数（SPEC-phase3 §5。取得できない環境では呼ばれない） */
  onPageCount?: (pages: number) => void;
}) {
  // 表示設定（トンボ・見開き・先頭ページ・回転。Issue #370）。トンボ・見開きは組版HTMLと
  // Viewer URL に効くため、切り替えると同じ文書の再組版として表示位置を保ったまま読み直す
  const { settings: display, update: updateDisplay } = usePreviewDisplay();
  const displayHtml = useMemo(
    () => (html === null ? null : applyPreviewDisplay(html, display)),
    [html, display],
  );
  const spread = display.spread;
  // ダブルバッファ（Issue #290）: iframe を2枚重ね、表（front）に旧プレビューを出したまま
  // 裏で新文書を組版させ、最初のページが表示可能になった時点で表裏を入れ替える。
  // 再組版中も空白にならない（反映までの時間自体は変わらない）
  const iframesRef = useRef<
    [HTMLIFrameElement | null, HTMLIFrameElement | null]
  >([null, null]);
  const [front, setFront] = useState<0 | 1>(0);
  const frontRef = useRef<0 | 1>(0);
  // 各スロットに載せた Blob URL（入れ替えで退いたスロットの分を解放する）
  const slotUrlsRef = useRef<[string | null, string | null]>([null, null]);
  // 読み込み完了前に revoke すると Viewer の取得が失敗するため、差し替えた旧URLは入れ替えまで保持する
  const staleUrlsRef = useRef<string[]>([]);
  // 表に載っている文書のキー（表示位置を引き継いでよいかの判定用）と、裏で組版中の文書のキー
  const frontKeyRef = useRef<string | null>(null);
  const backKeyRef = useRef<string | null>(null);
  const swapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pagePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onPageCountRef = useRef(onPageCount);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onPageCountRef.current = onPageCount;
    onLoadedRef.current = onLoaded;
  }, [onPageCount, onLoaded]);

  /**
   * 実ページ数の取得: Viewer は自前ホスト（同一オリジン）なので iframe 内の
   * ページ番号表示を読める。組版は非同期・段階的に進むため、Viewer のステータスが
   * complete になるまで待ってから総ページ数を報告する（途中の値で確定させない）。
   * 対象は常に表の iframe
   */
  const startPagePolling = useCallback(() => {
    if (pagePollRef.current) clearInterval(pagePollRef.current);
    let ticks = 0;
    pagePollRef.current = setInterval(() => {
      ticks += 1;
      const iframe = iframesRef.current[frontRef.current];
      if (viewerStatus(iframe) === "complete") {
        // Viewer は表示外ページを間引くことがあるため、コンテナ数でなく総ページ表示を読む
        const total = Number(
          iframe?.contentDocument?.querySelector("#vivliostyle-total-pages")
            ?.textContent ?? "",
        );
        if (pagePollRef.current) clearInterval(pagePollRef.current);
        pagePollRef.current = null;
        if (Number.isInteger(total) && total > 0)
          onPageCountRef.current?.(total);
        return;
      }
      // 最長60秒で打ち切り（巨大原稿・組版失敗時にポーリングを残さない）
      if (ticks >= 120) {
        if (pagePollRef.current) clearInterval(pagePollRef.current);
        pagePollRef.current = null;
      }
    }, 500);
  }, []);

  /**
   * 裏で組版を終えた iframe を表に出し、旧い表は about:blank にしてメモリを解放する。
   * settled=false は直後に次の文書を裏へ読ませる場合で、組版中表示を下ろさず、
   * ページ数も確定させない（表示が最新ではないため）
   */
  const swap = useCallback(
    (settled = true) => {
      if (swapPollRef.current) clearInterval(swapPollRef.current);
      swapPollRef.current = null;
      const oldFront = frontRef.current;
      const newFront: 0 | 1 = oldFront === 0 ? 1 : 0;
      frontRef.current = newFront;
      frontKeyRef.current = backKeyRef.current;
      setFront(newFront);

      const oldIframe = iframesRef.current[oldFront];
      if (oldIframe) oldIframe.src = "about:blank";
      const oldUrl = slotUrlsRef.current[oldFront];
      if (oldUrl) staleUrlsRef.current.push(oldUrl);
      slotUrlsRef.current[oldFront] = null;
      for (const url of staleUrlsRef.current) URL.revokeObjectURL(url);
      staleUrlsRef.current = [];

      if (!settled) return;
      onLoadedRef.current();
      startPagePolling();
    },
    [startPagePolling],
  );

  /**
   * 裏の Viewer が最初のページを表示可能（interactive）になるまで待って入れ替える。
   * interactive は復元位置（f=）のページ表示後に立つ。60秒で打ち切り、
   * 組版失敗時もその時点の表示（エラー等）を表に出す
   */
  const startSwapPolling = useCallback(
    (back: 0 | 1) => {
      if (swapPollRef.current) clearInterval(swapPollRef.current);
      let ticks = 0;
      swapPollRef.current = setInterval(() => {
        ticks += 1;
        const status = viewerStatus(iframesRef.current[back]);
        if (status === "interactive" || status === "complete" || ticks >= 600)
          swap();
      }, 100);
    },
    [swap],
  );

  /**
   * 再組版のたびに Viewer を読み込み直すため、そのままでは毎回先頭ページに戻る。
   * Viewer は現在位置を自身のハッシュへ `f=epubcfi(...)` として書き出しており、
   * Viewer は同一オリジンなのでそれを読める。表の iframe から読み取って新URLへ引き継ぐ（Issue #256）
   */
  const currentFragment = useCallback((): string | null => {
    try {
      const hash =
        iframesRef.current[frontRef.current]?.contentWindow?.location.hash;
      return hash ? fragmentFromViewerHash(hash) : null;
    } catch {
      // 読めない状況（未ロード等）では先頭から表示する
      return null;
    }
  }, []);

  useEffect(() => {
    if (displayHtml === null) {
      // iframe がアンマウントされるため、見張りを残さない
      if (swapPollRef.current) clearInterval(swapPollRef.current);
      swapPollRef.current = null;
      if (pagePollRef.current) clearInterval(pagePollRef.current);
      pagePollRef.current = null;
      return;
    }
    // 裏の組版が入れ替え待ちの時点で済んでいれば、捨てずに先に表へ出す
    // （変換処理でメインスレッドが塞がり、ポーリングより先に次の編集が届くことがある）
    const pendingBack: 0 | 1 = frontRef.current === 0 ? 1 : 0;
    const pendingStatus = viewerStatus(iframesRef.current[pendingBack]);
    if (
      swapPollRef.current &&
      (pendingStatus === "interactive" || pendingStatus === "complete")
    )
      swap(false);
    const back: 0 | 1 = frontRef.current === 0 ? 1 : 0;
    const backIframe = iframesRef.current[back];
    if (!backIframe) return;
    const url = URL.createObjectURL(
      new Blob([displayHtml], { type: "text/html" }),
    );
    // 表示中と別の文書に切り替わったときは前の文書の位置を持ち込まない
    const fragment =
      frontKeyRef.current === documentKey ? currentFragment() : null;
    backKeyRef.current = documentKey;
    // 組版中にさらに編集が来たら、裏の読み込みだけやり直す
    const prevUrl = slotUrlsRef.current[back];
    if (prevUrl) staleUrlsRef.current.push(prevUrl);
    slotUrlsRef.current[back] = url;
    if (swapPollRef.current) clearInterval(swapPollRef.current);
    swapPollRef.current = null;
    // 表の旧文書のページ数を、これから組版する文書の値として報告しない
    if (pagePollRef.current) clearInterval(pagePollRef.current);
    pagePollRef.current = null;
    backIframe.src = viewerUrl(url, fragment, spread);
  }, [displayHtml, spread, documentKey, currentFragment, swap]);

  useEffect(() => {
    // staleUrlsRef は入れ替えのたびに作り直すため、アンマウント時点の中身を読む
    const slots = slotUrlsRef.current;
    const staleRef = staleUrlsRef;
    return () => {
      for (const url of staleRef.current) URL.revokeObjectURL(url);
      for (const url of slots) if (url) URL.revokeObjectURL(url);
      if (swapPollRef.current) clearInterval(swapPollRef.current);
      if (pagePollRef.current) clearInterval(pagePollRef.current);
    };
  }, []);

  /** 裏の iframe の Viewer 本体が読み込まれたら、組版の進行を見張り始める */
  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLIFrameElement>) => {
      const slot = event.currentTarget.dataset.slot === "1" ? 1 : 0;
      if (slot === frontRef.current) return;
      if (!slotUrlsRef.current[slot]) return; // about:blank の読み込み
      startSwapPolling(slot);
    },
    [startSwapPolling],
  );

  // 回転（Issue #370）: iframe を包む要素の幅と高さを入れ替えて回す。Viewer は回転前の
  // （入れ替え後の）サイズで組版・フィットするため、回った見た目がペインに収まる
  const rotationStyle: React.CSSProperties =
    display.rotation === 0
      ? { inset: 0 }
      : {
          top: "50%",
          left: "50%",
          width: "100cqh",
          height: "100cqw",
          transform: `translate(-50%, -50%) rotate(${display.rotation}deg)`,
        };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {html !== null && (
        <div
          role="toolbar"
          aria-label="プレビューの表示設定"
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-background px-2 py-1"
        >
          <Button
            size="xs"
            variant={display.marks ? "secondary" : "ghost"}
            aria-pressed={display.marks}
            onClick={() => updateDisplay({ marks: !display.marks })}
          >
            <Crop />
            トンボ
          </Button>
          <Button
            size="xs"
            variant={display.spread ? "secondary" : "ghost"}
            aria-pressed={display.spread}
            onClick={() => updateDisplay({ spread: !display.spread })}
          >
            <BookOpen />
            見開き
          </Button>
          {display.spread && (
            <Button
              size="xs"
              variant={display.spreadFromFirst ? "secondary" : "ghost"}
              aria-pressed={display.spreadFromFirst}
              title="オフ: 先頭ページを単独で表示（1 ／ 2-3 …）。オン: 先頭ページから見開き（1-2 ／ 3-4 …）"
              onClick={() =>
                updateDisplay({ spreadFromFirst: !display.spreadFromFirst })
              }
            >
              先頭から見開き
            </Button>
          )}
          <Button
            size="xs"
            variant={display.rotation === 0 ? "ghost" : "secondary"}
            aria-pressed={display.rotation !== 0}
            title="押すたびに 通常 → 90° → 270° → 通常 と切り替わります"
            onClick={() =>
              updateDisplay({ rotation: nextRotation(display.rotation) })
            }
          >
            <RotateCw />
            {display.rotation === 0 ? "回転" : `${display.rotation}°`}
          </Button>
        </div>
      )}
      {/* 回転時の幅・高さの入れ替えに使うため、サイズのコンテナクエリの基準にする */}
      <div
        className="relative min-h-0 flex-1"
        style={{ containerType: "size" }}
      >
        {html === null ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">
              章を開くと組版プレビューが表示されます
            </p>
          </div>
        ) : (
          <div className="absolute" style={rotationStyle}>
            {/* 裏の iframe も表と同じサイズでレイアウトさせる（サイズが違うとページ割りが変わる） */}
            {([0, 1] as const).map((slot) => (
              <iframe
                key={slot}
                ref={(el) => {
                  iframesRef.current[slot] = el;
                }}
                title="組版プレビュー"
                aria-hidden={slot !== front}
                tabIndex={slot === front ? undefined : -1}
                className={cn(
                  "absolute inset-0 h-full w-full border-0",
                  slot !== front && "pointer-events-none invisible",
                )}
                data-slot={slot}
                onLoad={handleLoad}
              />
            ))}
          </div>
        )}
        {typesetting && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm ring-1 ring-border">
              <Loader2 className="size-3 animate-spin" />
              組版中…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
