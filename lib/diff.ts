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

/** 連続する削除行の並びと追加行の並びを index 順に対応付け、DiffRow へ変換する */
function pairDelAdd(dels: string[], adds: string[]): DiffRow[] {
  const rows: DiffRow[] = []
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
  return rows
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
      rows.push(...pairDelAdd(dels, adds))
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

/** diffTexts で表示する変更行前後の文脈行数（unified diff の慣習に合わせる） */
const CONTEXT_LINES = 3

// LCS の DP テーブル上限（行数の積）。企画書本文の規模なら十分で、超えたら全置換表示に落とす
const LCS_CELL_LIMIT = 4_000_000

/** 行単位の編集列（等しい / 削除 / 追加）。diffTexts の中間表現 */
type LineOp = { op: 'eq' | 'del' | 'add'; text: string }

/** LCS（最長共通部分列）で2つの行配列の編集列を求める */
function diffLineOps(oldLines: string[], newLines: string[]): LineOp[] {
  const n = oldLines.length
  const m = newLines.length
  // 前後の共通行を先にトリムして DP の対象を狭める
  let start = 0
  while (start < n && start < m && oldLines[start] === newLines[start]) start++
  let end = 0
  while (end < n - start && end < m - start && oldLines[n - 1 - end] === newLines[m - 1 - end]) {
    end++
  }
  const oldMid = oldLines.slice(start, n - end)
  const newMid = newLines.slice(start, m - end)
  const ops: LineOp[] = oldLines.slice(0, start).map((text) => ({ op: 'eq', text }))

  if ((oldMid.length + 1) * (newMid.length + 1) > LCS_CELL_LIMIT) {
    // 大きすぎる場合は対応付けを諦めて全置換として表示する（表示は正しいまま粗くなるだけ）
    ops.push(...oldMid.map((text): LineOp => ({ op: 'del', text })))
    ops.push(...newMid.map((text): LineOp => ({ op: 'add', text })))
  } else {
    // dp[i][j] = oldMid[i:] と newMid[j:] の LCS 長（後方から埋める）
    const width = newMid.length + 1
    const dp = new Int32Array((oldMid.length + 1) * width)
    for (let i = oldMid.length - 1; i >= 0; i--) {
      for (let j = newMid.length - 1; j >= 0; j--) {
        dp[i * width + j] =
          oldMid[i] === newMid[j]
            ? dp[(i + 1) * width + j + 1] + 1
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < oldMid.length && j < newMid.length) {
      if (oldMid[i] === newMid[j]) {
        ops.push({ op: 'eq', text: oldMid[i] })
        i++
        j++
      } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        ops.push({ op: 'del', text: oldMid[i] })
        i++
      } else {
        ops.push({ op: 'add', text: newMid[j] })
        j++
      }
    }
    while (i < oldMid.length) ops.push({ op: 'del', text: oldMid[i++] })
    while (j < newMid.length) ops.push({ op: 'add', text: newMid[j++] })
  }

  ops.push(...oldLines.slice(n - end).map((text): LineOp => ({ op: 'eq', text })))
  return ops
}

/**
 * 2つのテキストから表示用の行diffを生成する（企画書の版間差分。Issue #64）。
 * 変更行の前後 CONTEXT_LINES 行だけ文脈を残し、離れた変更は hunk 見出しで区切る
 * （行の対応付け・文字単位強調は parsePatch と同じ流儀）。変更がなければ空配列
 */
export function diffTexts(oldText: string, newText: string): DiffRow[] {
  if (oldText === newText) return []
  const ops = diffLineOps(oldText.split('\n'), newText.split('\n'))

  // 変更（del/add）を含む前後 CONTEXT_LINES 行以内だけを表示対象にする
  const visible = new Array<boolean>(ops.length).fill(false)
  for (const [k, op] of ops.entries()) {
    if (op.op === 'eq') continue
    for (let t = Math.max(0, k - CONTEXT_LINES); t <= Math.min(ops.length - 1, k + CONTEXT_LINES); t++) {
      visible[t] = true
    }
  }

  const rows: DiffRow[] = []
  let oldLine = 1 // 次に消費する旧テキストの行番号（hunk 見出し用）
  let newLine = 1
  let k = 0
  while (k < ops.length) {
    if (!visible[k]) {
      if (ops[k].op !== 'add') oldLine++
      if (ops[k].op !== 'del') newLine++
      k++
      continue
    }
    // 可視領域の連続区間 = 1 hunk。区間内の行数を数えて見出しを作る
    let endIdx = k
    while (endIdx < ops.length && visible[endIdx]) endIdx++
    let oldCount = 0
    let newCount = 0
    for (let t = k; t < endIdx; t++) {
      if (ops[t].op !== 'add') oldCount++
      if (ops[t].op !== 'del') newCount++
    }
    rows.push({ kind: 'hunk', text: `@@ -${oldLine},${oldCount} +${newLine},${newCount} @@` })
    oldLine += oldCount
    newLine += newCount

    while (k < endIdx) {
      if (ops[k].op === 'eq') {
        rows.push({ kind: 'context', text: ops[k].text })
        k++
        continue
      }
      // 連続する del の並び→続く add の並びをまとめ、parsePatch と同じペアリングで強調を付ける
      const dels: string[] = []
      while (k < endIdx && ops[k].op === 'del') {
        dels.push(ops[k].text)
        k++
      }
      const adds: string[] = []
      while (k < endIdx && ops[k].op === 'add') {
        adds.push(ops[k].text)
        k++
      }
      rows.push(...pairDelAdd(dels, adds))
    }
  }
  return rows
}
