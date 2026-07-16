// HTMLコメント（`<!-- -->`）の一覧抽出（SPEC-vertical-editor-phase3 §3）。
// コメントは出力に一切現れない「作者のメモ」（親SPEC §4.5）。
// エディタのサイドバー一覧・ジャンプに使う。クライアントで打鍵デバウンスごとに走る

export type ManuscriptComment = {
  /** ドキュメント先頭からの文字オフセット（CodeMirror の位置と一致） */
  from: number
  to: number
  /** 1始まりの行番号 */
  line: number
  /** 一覧表示用の要約（先頭の非空行・40字まで） */
  summary: string
}

const SUMMARY_MAX = 40

/** 本文から well-formed な HTMLコメントを出現順に抽出する */
export function extractComments(source: string): ManuscriptComment[] {
  const comments: ManuscriptComment[] = []
  const regex = /<!--([\s\S]*?)-->/g
  // 行番号は前回位置からの差分で数える（コメントが多い長文でも線形時間）
  let scannedIndex = 0
  let scannedLine = 1
  for (const match of source.matchAll(regex)) {
    const from = match.index
    for (let i = scannedIndex; i < from; i++) {
      if (source.charCodeAt(i) === 10) scannedLine++
    }
    scannedIndex = from
    const firstLine = match[1]
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '')
    const summary =
      firstLine === undefined
        ? '（空のコメント）'
        : firstLine.length > SUMMARY_MAX
          ? `${firstLine.slice(0, SUMMARY_MAX)}…`
          : firstLine
    comments.push({ from, to: from + match[0].length, line: scannedLine, summary })
  }
  return comments
}
