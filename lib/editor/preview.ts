import { stringify } from '@vivliostyle/vfm'

// 縦書きプレビューのHTML生成（SPEC-vertical-editor-phase2 §5）。
// 編集中テキストの組版はブラウザ内で完結させる（VFM変換→テーマCSS注入→Blob URL→Viewer）。
// このモジュールはクライアントで実行される純関数のみを置く

export type PreviewChapter = {
  /** リポジトリルート（base_path）からのパス。画像相対パスの解決基準になる */
  path: string
  content: string
}

/** テーマCSSの取得結果（サーバー側で @import 解決済み。lib/actions/editor.ts が組み立てる） */
export type ThemeAssets = {
  /** アプリがホストする組版CSSのパス（/vivliostyle/themes/...）。<link> として注入する */
  stylesheetPaths: string[]
  /** リポジトリ由来のCSS（判型・パーツ定義）。<style> として注入する */
  inlineCss: string
}

/** 先頭のYAMLフロントマターから `class:` を取り出す（扉・奥付の body クラス。VFM仕様準拠の簡易版） */
export function extractBodyClass(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return null
  const line = match[1].match(/^class:\s*(.+)$/m)
  if (!line) return null
  const value = line[1].trim().replace(/^['"]|['"]$/g, '')
  // クラス名として妥当なもののみ（HTML属性へ埋め込むため英数とハイフン等に限定）
  return /^[\w][\w\s-]*$/.test(value) ? value : null
}

/**
 * 章ファイルからの相対パスをリポジトリルート基準に正規化する。
 * ルート外へ出るパス（`..` が残る）は null
 */
export function resolveRepoPath(chapterPath: string, relativeSrc: string): string | null {
  const dir = chapterPath.split('/').slice(0, -1)
  const parts = [...dir, ...relativeSrc.split('/')]
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
      continue
    }
    resolved.push(part)
  }
  return resolved.join('/')
}

/**
 * VFM変換後HTMLの <img src> を認証プロキシURLへ書き換える（§5.3）。
 * PATがないブラウザからはリポジトリの画像を直接取得できないため。
 * http(s)/data はそのまま、解決できない相対パスもそのまま残す（Viewer側で自然に404になる）
 */
function rewriteImageSrc(
  html: string,
  chapterPath: string,
  assetUrl: (repoPath: string) => string,
): string {
  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)(")/g,
    (whole, before: string, src: string, after: string) => {
      if (/^(?:https?:|data:|blob:)/.test(src)) return whole
      const repoPath = resolveRepoPath(chapterPath, src)
      if (!repoPath) return whole
      return `${before}${escapeHtmlAttr(assetUrl(repoPath))}${after}`
    },
  )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

/**
 * 章群を組版用の単一HTMLへ変換する。
 * - 1章のみ: フロントマターの `class:` を body へ反映（扉・奥付の専用様式が当たる）
 * - 複数章（全体プレビュー）: 章ごとに独立ドキュメントになる本ビルドとの差を
 *   「章境の改ページ」シムで補う。body クラス依存の様式（扉・奥付）は当たらない（UIで注記）
 */
export function buildPreviewHtml(params: {
  chapters: PreviewChapter[]
  theme: ThemeAssets
  title: string
  /** アプリのオリジン（Blob URL文書内では相対URLが解決できないため絶対URLにする） */
  origin: string
  assetUrl: (repoPath: string) => string
}): string {
  const { chapters, theme, title, origin, assetUrl } = params
  const isSingle = chapters.length === 1

  const sections = chapters.map((chapter) => {
    const fragment = stringify(chapter.content, { partial: true })
    return rewriteImageSrc(fragment, chapter.path, assetUrl)
  })

  const bodyClass = isSingle ? extractBodyClass(chapters[0].content) : null
  // リポジトリ由来のCSSが </style> で <style> を破ってタグ注入するのを防ぐ
  // （security-review M-2。`<\/` はCSS文字列としては等価なエスケープ）
  const safeInlineCss = theme.inlineCss.replace(/<\/(style)/gi, '<\\/$1')
  const links = theme.stylesheetPaths
    .map((path) => `<link rel="stylesheet" href="${escapeHtmlAttr(`${origin}${path}`)}">`)
    .join('\n')
  // 本ビルドでは entry の各mdが独立ドキュメント＝章境が必ず改ページになる。単一HTML化した
  // 全体プレビューでも同じページ割りになるようにする（テーマ本体には手を入れない）
  const multiChapterShim = isSingle
    ? ''
    : '<style>body > section.level1 { break-before: page; }</style>'

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${links}
<style>
${safeInlineCss}
</style>
${multiChapterShim}
</head>
<body${bodyClass ? ` class="${escapeHtmlAttr(bodyClass)}"` : ''}>
${sections.join('\n')}
</body>
</html>
`
}

/**
 * 自前ホストの Vivliostyle Viewer でBlob URLの文書を開くURL（§5.1）。
 * `#src=` はエンコードしない——Viewerはハッシュを復号せずに解決するため、
 * エンコードすると相対パス扱いになり404になる（スパイクで実地確認）。
 * Blob URLは `&`/`#` を含まないのでそのまま連結して安全
 */
export function viewerUrl(documentUrl: string): string {
  return `/vivliostyle/viewer/index.html#src=${documentUrl}&bookMode=false&renderAllPages=true`
}
