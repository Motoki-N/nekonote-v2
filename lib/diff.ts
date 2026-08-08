// unified diff（GitHubのpatch）の表示用パース（SPEC-manuscript-history §2）。
// 行単位のpatchを土台に、hunk内で対応する削除行/追加行のペアへ
// 文字単位の変更部分を付ける（共通接頭辞・接尾辞のトリム方式。LCSはしない）

export type Segment = { text: string; changed: boolean }

export type DiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'context'; text: string }
  | { kind: 'del' | 'add'; segments: Segment[] }

/**
 * 削除行と追加行のペアから、共通接頭辞・接尾辞を除いた中間部を「変更部分」として返す。
 * サロゲートペア（絵文字等）を割らないようコードポイント単位で比較する
 */
export function splitChangedSegments(
  del: string,
  add: string,
): { del: Segment[]; add: Segment[] } {
  const d = Array.from(del)
  const a = Array.from(add)
  const max = Math.min(d.length, a.length)
  let prefix = 0
  while (prefix < max && d[prefix] === a[prefix]) prefix++
  let suffix = 0
  while (suffix < max - prefix && d[d.length - 1 - suffix] === a[a.length - 1 - suffix]) suffix++
  const toSegments = (chars: string[]): Segment[] =>
    [
      { text: chars.slice(0, prefix).join(''), changed: false },
      { text: chars.slice(prefix, chars.length - suffix).join(''), changed: true },
      { text: chars.slice(chars.length - suffix).join(''), changed: false },
    ].filter((segment) => segment.text !== '')
  return { del: toSegments(d), add: toSegments(a) }
}

/**
 * patch を表示用の行に変換する。hunk内で連続する削除行の並びと追加行の並びを
 * 順に対応付け、ペアになった行だけ文字単位の強調を付ける（余った行は行全体を強調）
 */
export function parsePatch(patch: string): DiffRow[] {
  const lines = patch.split('\n')
  const rows: DiffRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('@@')) {
      rows.push({ kind: 'hunk', text: line })
      i++
      continue
    }
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" は表示しない
      i++
      continue
    }
    if (line.startsWith('-')) {
      // 削除行の並び→続く追加行の並びをまとめて取り、index順にペアリングする
      const dels: string[] = []
      while (i < lines.length && lines[i].startsWith('-')) {
        dels.push(lines[i].slice(1))
        i++
      }
      const adds: string[] = []
      while (i < lines.length && lines[i].startsWith('+')) {
        adds.push(lines[i].slice(1))
        i++
      }
      const paired = Math.min(dels.length, adds.length)
      const pairs = dels.slice(0, paired).map((del, j) => splitChangedSegments(del, adds[j]))
      for (const [j, del] of dels.entries()) {
        rows.push({
          kind: 'del',
          segments: j < paired ? pairs[j].del : [{ text: del, changed: true }],
        })
      }
      for (const [j, add] of adds.entries()) {
        rows.push({
          kind: 'add',
          segments: j < paired ? pairs[j].add : [{ text: add, changed: true }],
        })
      }
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', segments: [{ text: line.slice(1), changed: true }] })
      i++
      continue
    }
    rows.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line })
    i++
  }
  return rows
}
