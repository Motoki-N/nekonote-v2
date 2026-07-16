// 字数カウント・ページ数見積り（SPEC-vertical-editor-phase3 §5）。
// 本文のみを数える: コメント・フロントマター・見出し記号・ルビの読み・
// クラス指定記法・画像記法・HTMLタグ・空白改行を除外する。
// クライアントで打鍵デバウンスごとに走るため、正規表現のみで軽量に保つ

/** VFM原稿から本文の字数を数える（コードポイント単位） */
export function countManuscriptChars(source: string): number {
  let text = source
  // フロントマター（先頭の --- ブロック）
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  // HTMLコメント（複数行対応。閉じていない書きかけは本文扱いのまま残す）
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  // 画像記法（キャプション・クラス指定ごと除外）
  text = text.replace(/!\[[^\]\n]*\]\([^)\n]*\)(?:\{[^}\n]*\})?/g, '')
  // ルビ `{親文字|よみ}` は親文字のみ数える
  text = text.replace(/\{([^{}|\n]+)\|[^{}|\n]+\}/g, '$1')
  // インライン属性のクラス指定記法（`{.tenten}` `{#id}` 等）
  text = text.replace(/\{[.#][^}\n]*\}/g, '')
  // HTMLタグ（<span class="..."> 等。中身のテキストは残る）
  text = text.replace(/<\/?[A-Za-z][^>\n]*>/g, '')
  // 見出し記号
  text = text.replace(/^#{1,6}\s+/gm, '')
  // 空白・改行（全角スペース含む——JSの \s は 　 を含む）
  text = text.replace(/\s+/g, '')
  return [...text].length
}

/** 組版設定（1ページの行数×字詰め）。テーマCSSの :root 変数から抽出する */
export type KumiSettings = {
  lines: number
  charsPerLine: number
}

/** テーマCSS（inlineCss）から版面の行数・字詰めを抽出。見つからなければ null */
export function extractKumiSettings(css: string): KumiSettings | null {
  const lines = css.match(/--vs-theme--num-of-line:\s*(\d+)/)
  const chars = css.match(/--vs-theme--num-of-character:\s*(\d+)/)
  if (!lines || !chars) return null
  const parsed = { lines: Number(lines[1]), charsPerLine: Number(chars[1]) }
  return parsed.lines > 0 && parsed.charsPerLine > 0 ? parsed : null
}

// 抽出できないテーマ用の既定（文庫A6: 16行×40字）
const DEFAULT_KUMI: KumiSettings = { lines: 16, charsPerLine: 40 }

/**
 * ページ数の概算（字数 ÷ 版面の収容字数）。
 * 改行・空行でページは実際には増えるため下振れしやすい概算値——
 * プレビュー完了時は Vivliostyle の実ページ数を優先表示する（SPEC §5）
 */
export function estimatePages(chars: number, kumi: KumiSettings | null): number {
  const { lines, charsPerLine } = kumi ?? DEFAULT_KUMI
  return Math.max(1, Math.ceil(chars / (lines * charsPerLine)))
}
