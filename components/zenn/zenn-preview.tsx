"use client";

import { useEffect, useState } from "react";

import "zenn-content-css";

// zenn-markdown-html はバンドルが重いため動的importで遅延ロードする。
// v0.5系の markdownToHtml は async（Promise<string>）
type MarkdownToHtml = (text: string) => Promise<string>;
let markdownToHtmlPromise: Promise<MarkdownToHtml> | null = null;
function loadMarkdownToHtml(): Promise<MarkdownToHtml> {
  markdownToHtmlPromise ??= import("zenn-markdown-html").then(
    (mod) => mod.default as MarkdownToHtml,
  );
  return markdownToHtmlPromise;
}

/**
 * Zennと同じ見た目のプレビュー（SPEC-zenn-integration §3.2）。300msデバウンスで変換。
 * 入力は本人がいま打っている本文のみ（self-XSSの範囲。リモート由来は描画しない。
 * embedOrigin 無効＝埋め込みはリンク表示のフォールバック。SPEC §8・§9）。
 *
 * テーマ例外（SPEC §3.4）: .znc コンテナは「Zennと同じ見た目」が目的の例外領域として
 * ライト背景固定（zenn-content-css がライト前提。アプリ側ダークテーマでも切り替えない）
 */
export function ZennPreview({
  body,
  imageUrls = {},
}: {
  body: string;
  /** この画面でアップロードした画像の `/images/...` パス → Blob URL（SPEC §11） */
  imageUrls?: Record<string, string>;
}) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const markdownToHtml = await loadMarkdownToHtml();
          let rendered = await markdownToHtml(body);
          // アップロード済み画像の参照パスをブラウザ内のBlob URLへ差し替える
          // （パスは [a-z0-9_./-] のみ＝HTML属性値として安全。SPEC §11）
          for (const [path, url] of Object.entries(imageUrls)) {
            rendered = rendered.split(`src="${path}"`).join(`src="${url}"`);
          }
          if (!cancelled) setHtml(rendered);
        } catch {
          if (!cancelled) setHtml("<p>プレビューの変換に失敗しました</p>");
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, imageUrls]);

  return (
    <div
      className="h-full overflow-y-auto p-4"
      // ライト背景固定はテーマ例外（SPEC-zenn-integration §3.4）
      style={{ backgroundColor: "#ffffff", color: "#000000" }}
      aria-label="Zennプレビュー"
    >
      {body.trim() === "" ? (
        <p className="text-sm" style={{ color: "#65717b" }}>
          本文を入力するとZennと同じ見た目のプレビューが表示されます
        </p>
      ) : (
        <div className="znc" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}
