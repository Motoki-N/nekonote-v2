// book.config.js（Vivliostyle CLI 設定）の情報抽出（SPEC-vertical-editor-phase2 §3.3・§5.1）。
// JSファイルのため実行せず、文字列リテラルを正規表現で抽出する。
// 抽出できない場合の扱い（章順フォールバック等）は呼び出し側の責務

/** entry 配列から章ファイルパス（.md の文字列リテラル）を出現順に抽出する */
export function extractEntryPaths(source: string): string[] {
  const arrayMatch = source.match(/\bentry\s*:\s*\[([\s\S]*?)\]/)
  if (!arrayMatch) return []
  const paths: string[] = []
  for (const literal of arrayMatch[1].matchAll(/['"`]([^'"`\n]+\.md)['"`]/g)) {
    paths.push(literal[1])
  }
  return paths
}

/** theme のCSSパス（文字列リテラル）を抽出する。見つからなければ null */
export function extractThemePath(source: string): string | null {
  const match = source.match(/\btheme\s*:\s*['"`]([^'"`\n]+)['"`]/)
  return match ? match[1] : null
}

// ---- 設定フォーム用の読み書き（SPEC-vertical-editor-phase3 §7）。
// 実行もASTパースもせず、正規表現ベースの文字列置換のみで書き換える。
// 呼び出し側は置換後に抽出関数を再実行して期待値が読めることを検証してからコミットする

/** 書誌情報のキー（値が単純な文字列リテラルのもののみ対象） */
export type BiblioKey = 'title' | 'author'

/** `key: '値'` の文字列リテラル値を抽出する。見つからなければ null */
export function extractStringValue(source: string, key: BiblioKey): string | null {
  const match = source.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`\\n]*)\\1`))
  return match ? match[2] : null
}

/**
 * `key: '値'` の値を置換する（引用符のスタイルは元のまま）。
 * キーが見つからない・値に引用符や改行が入る場合は null（フェイルソフト）
 */
export function replaceStringValue(source: string, key: BiblioKey, value: string): string | null {
  if (/['"`\n\\]/.test(value)) return null
  const regex = new RegExp(`(\\b${key}\\s*:\\s*)(['"\`])[^'"\`\\n]*\\2`)
  if (!regex.test(source)) return null
  return source.replace(regex, `$1$2${value}$2`)
}

/** entry 配列の1要素（文字列リテラル＝章、その他＝目次差し込み等の表示専用要素） */
export type EntryItem = {
  /** 元テキスト（トリム済み。書き戻しにそのまま使う） */
  raw: string
  /** 章ファイルパス（文字列リテラルの場合のみ。それ以外は null） */
  path: string | null
}

/**
 * entry 配列をトップレベルのカンマで分割して要素ごとに返す。
 * 配列が見つからない・ネストが壊れている場合は null（フォームは読み取り専用にする）
 */
export function parseEntryItems(source: string): EntryItem[] | null {
  const arrayMatch = source.match(/\bentry\s*:\s*\[([\s\S]*?)\]/)
  if (!arrayMatch) return null
  const inner = arrayMatch[1]
  const items: EntryItem[] = []
  let depth = 0
  let current = ''
  for (const char of inner) {
    if (char === '{' || char === '[' || char === '(') depth++
    if (char === '}' || char === ']' || char === ')') depth--
    if (depth < 0) return null
    if (char === ',' && depth === 0) {
      pushEntryItem(items, current)
      current = ''
      continue
    }
    current += char
  }
  if (depth !== 0) return null
  pushEntryItem(items, current)
  return items
}

function pushEntryItem(items: EntryItem[], text: string): void {
  // 行コメントは要素に含めない（`// 目次（自動生成）...` 等の注記行）
  const raw = text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line !== '')
    .join(' ')
  if (raw === '') return
  const literal = raw.match(/^['"`]([^'"`\n]+\.md)['"`]$/)
  items.push({ raw, path: literal ? literal[1] : null })
}

/**
 * entry 配列の中身を newItems（各要素の raw テキスト）で書き換える。
 * インデントは既存の最初の要素行に合わせる（なければスペース4つ）
 */
export function replaceEntryItems(source: string, newItems: string[]): string | null {
  const arrayMatch = source.match(/(\bentry\s*:\s*\[)([\s\S]*?)(\])/)
  if (!arrayMatch) return null
  const indentMatch = arrayMatch[2].match(/\n([ \t]+)\S/)
  const indent = indentMatch ? indentMatch[1] : '    '
  const closeIndent = indent.length >= 2 ? indent.slice(0, indent.length - 2) : ''
  const body = newItems.map((item) => `${indent}${item},`).join('\n')
  return source.replace(
    /\bentry\s*:\s*\[[\s\S]*?\]/,
    `entry: [\n${body}\n${closeIndent}]`,
  )
}

/** テーマCSSの組み設定変数（SPEC-phase3 §7-3。値は文字列のまま扱い、数値検証は呼び出し側） */
export const KUMI_VAR_NAMES = [
  '--vs-font-size-on-print',
  '--vs-line-height',
  '--vs-theme--num-of-line',
  '--vs-theme--num-of-character',
] as const
export type KumiVarName = (typeof KUMI_VAR_NAMES)[number]

/** テーマCSSから組み設定変数の値を抽出する（`%` などの単位付きはそのまま返す） */
export function extractCssVar(css: string, name: KumiVarName): string | null {
  const match = css.match(new RegExp(`${name}\\s*:\\s*([^;\\n]+);`))
  return match ? match[1].trim() : null
}

/** テーマCSSの変数値を置換する。変数が見つからなければ null */
export function replaceCssVar(css: string, name: KumiVarName, value: string): string | null {
  if (/[;{}\n]/.test(value)) return null
  const regex = new RegExp(`(${name}\\s*:\\s*)[^;\\n]+(;)`)
  if (!regex.test(css)) return null
  return css.replace(regex, `$1${value}$2`)
}

/** リポジトリルート基準でパスを結合する（`.`/`..`/空セグメントを正規化。ルート外は null） */
export function joinRepoPath(...segments: string[]): string | null {
  const resolved: string[] = []
  for (const segment of segments) {
    for (const part of segment.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (resolved.length === 0) return null
        resolved.pop()
        continue
      }
      resolved.push(part)
    }
  }
  return resolved.join('/')
}
