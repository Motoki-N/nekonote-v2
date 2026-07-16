import 'server-only'

import { getFileContent } from '@/lib/git/github'
import { joinRepoPath } from '@/lib/editor/book-config'
import type { ThemeAssets } from '@/lib/editor/preview'

// リポジトリの判型テーマCSSをプレビュー用に組み立てる（SPEC-vertical-editor-phase2 §5.1）。
// テーマは原稿リポジトリのビルド時は node_modules を参照するが、ブラウザプレビューでは
// アプリが postinstall でホストする同一パッケージ（public/vivliostyle/themes/）へ読み替える

/** node_modules 参照をアプリホストのCSSへ読み替える対応表。順序に意味あり（bunko が先勝ち） */
const APP_HOSTED_THEMES: { pattern: RegExp; path: string }[] = [
  { pattern: /@vivliostyle\/theme-bunko/, path: '/vivliostyle/themes/theme-bunko/theme.css' },
  { pattern: /@vivliostyle\/theme-base/, path: '/vivliostyle/themes/theme-base/theme-all.css' },
]

/**
 * 既定テーマ（book.config.js が読めない・theme 指定がないときのフォールバック。文庫A6相当）。
 * --vs-page--size がないと size: auto のままページ分割されないため、既定でもA6を与える
 */
const DEFAULT_THEME: ThemeAssets = {
  stylesheetPaths: [APP_HOSTED_THEMES[0].path],
  inlineCss: ':root { --vs-page--size: 105mm 148mm; }',
}

const IMPORT_RE = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;?/g

/**
 * book.config.js の theme が指すCSSを取得し、@import を解決した ThemeAssets を返す。
 * - node_modules/@vivliostyle/* への参照 → アプリホストの <link> へ読み替え
 * - リポジトリ内の相対参照 → 取得してインライン展開（1段のみ。判型テーマの構造上それで足りる）
 * - その他（http等） → 除去（プレビューは自己完結が原則）
 * 取得に失敗しても既定テーマで返す（プレビューを落とさないフェイルソフト）
 */
export async function resolveThemeAssets(
  token: string,
  repo: string,
  basePath: string,
  themePath: string | null,
): Promise<ThemeAssets> {
  if (!themePath) return DEFAULT_THEME

  // npm パッケージ指定（相対パスでない）はアプリホスト読み替えのみ
  if (!themePath.startsWith('.') && !themePath.includes('/')) return DEFAULT_THEME
  const hosted = APP_HOSTED_THEMES.find((t) => t.pattern.test(themePath))
  if (hosted) return { stylesheetPaths: [hosted.path], inlineCss: '' }

  const themeFilePath = joinRepoPath(basePath, themePath)
  if (!themeFilePath || !themeFilePath.endsWith('.css')) return DEFAULT_THEME

  let source: string
  try {
    source = (await getFileContent(token, repo, themeFilePath)).content
  } catch (error) {
    console.error(`テーマCSS ${themeFilePath} の取得に失敗:`, error)
    return DEFAULT_THEME
  }

  const themeDir = themeFilePath.split('/').slice(0, -1).join('/')
  const stylesheetPaths: string[] = []
  const inlineChildren = new Map<string, string>()

  // 先に取得対象を洗い出してから並列取得する
  const relativeImports: string[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    const url = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    const appHosted = APP_HOSTED_THEMES.find((t) => t.pattern.test(url))
    if (appHosted) {
      if (!stylesheetPaths.includes(appHosted.path)) stylesheetPaths.push(appHosted.path)
    } else if (!/^(?:https?:|data:)/.test(url) && url.endsWith('.css')) {
      relativeImports.push(url)
    }
  }
  await Promise.all(
    relativeImports.map(async (url) => {
      const childPath = joinRepoPath(themeDir, url)
      if (!childPath) return
      try {
        inlineChildren.set(url, (await getFileContent(token, repo, childPath)).content)
      } catch (error) {
        console.error(`テーマCSS ${childPath} の取得に失敗:`, error)
      }
    }),
  )

  const inlineCss = source.replace(IMPORT_RE, (statement, ...groups: (string | undefined)[]) => {
    const url = groups[0] ?? groups[1] ?? groups[2] ?? groups[3] ?? groups[4] ?? ''
    if (APP_HOSTED_THEMES.some((t) => t.pattern.test(url))) return '' // <link> へ読み替え済み
    const child = inlineChildren.get(url)
    return child !== undefined ? `\n${child}\n` : `/* 未解決の @import を除去: ${url} */`
  })

  return {
    stylesheetPaths: stylesheetPaths.length > 0 ? stylesheetPaths : DEFAULT_THEME.stylesheetPaths,
    inlineCss,
  }
}
