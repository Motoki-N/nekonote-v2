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
