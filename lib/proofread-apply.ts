// 校正提案の適用判定・適用（SPEC-proofreading §3.4）。
// 「原文抜粋が現在の原稿に一意に見つかるか」をアンカーとする安全弁で、
// クライアントの「適用不能」表示とサーバーのコミット適用の両方が同じ判定を通る。

/** needle の出現回数を数える（一意判定に十分な2で打ち切り）。空文字は0扱い */
export function countOccurrences(content: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let idx = content.indexOf(needle)
  while (idx !== -1) {
    count += 1
    if (count > 1) return count
    idx = content.indexOf(needle, idx + needle.length)
  }
  return count
}

/** 原文抜粋が現在の原稿に一意に見つかる（＝置換適用できる）か */
export function isApplicable(content: string, originalText: string): boolean {
  return countOccurrences(content, originalText) === 1
}

export type ProofreadPatch = {
  original_text: string
  suggested_text: string
}

export type ApplySuggestionsResult =
  | { ok: true; content: string }
  | { ok: false; failedOriginal: string }

export type WriteBackItem = {
  original_text: string
  suggested_text: string
  reason: string | null
}

/** コメント本文の無害化（`--` はHTMLコメントを壊すため全角へ。1行コメントにするため改行は空白へ） */
function sanitizeCommentText(text: string): string {
  return text.replace(/\r?\n/g, ' ').replaceAll('--', '−−')
}

/** 保留提案1件ぶんの書き戻しコメント（SPEC-vertical-editor-phase4 §3.2） */
export function formatWriteBackComment(item: WriteBackItem): string {
  // 原文は挿入位置の直下にあるため先頭20字に切り詰める。修正案・理由は全文を残す
  const excerpt =
    item.original_text.length > 20 ? `${item.original_text.slice(0, 20)}…` : item.original_text
  const reason = item.reason ? ` 理由: ${sanitizeCommentText(item.reason)}` : ''
  return `<!-- [ネコノテ校正・保留] 「${sanitizeCommentText(excerpt)}」→「${sanitizeCommentText(item.suggested_text)}」${reason} -->`
}

/**
 * 保留提案を該当箇所の直前の行へ `<!-- -->` コメントとして挿入する（SPEC-vertical-editor-phase4 §3.2）。
 * 適用と同じ一意一致アンカーを使い、1件でも見つからなければ全体を失敗にする（部分書き戻しを作らない）。
 * 位置は元の本文で全件確定してから後方順に挿入する（挿入による位置ズレ防止）
 */
export function writeBackAsComments(
  content: string,
  items: WriteBackItem[],
): ApplySuggestionsResult {
  const insertions: { at: number; text: string }[] = []
  for (const item of items) {
    if (!isApplicable(content, item.original_text)) {
      return { ok: false, failedOriginal: item.original_text }
    }
    const idx = content.indexOf(item.original_text)
    // 該当箇所を含む行の先頭（行頭一致 idx=0 でも lastIndexOf が -1 → 0 になる）
    const lineStart = content.lastIndexOf('\n', idx - 1) + 1
    insertions.push({ at: lineStart, text: `${formatWriteBackComment(item)}\n` })
  }
  insertions.sort((a, b) => b.at - a.at)
  let current = content
  for (const insertion of insertions) {
    current = current.slice(0, insertion.at) + insertion.text + current.slice(insertion.at)
  }
  return { ok: true, content: current }
}

/**
 * 受け入れ済み提案を順に適用する。
 * 各提案は適用時点の本文で一意に見つかることを要求し、
 * 見つからない・複数見つかる提案があれば全体を失敗にする（部分適用のコミットを作らない）
 */
export function applySuggestions(
  content: string,
  patches: ProofreadPatch[],
): ApplySuggestionsResult {
  let current = content
  for (const patch of patches) {
    if (!isApplicable(current, patch.original_text)) {
      return { ok: false, failedOriginal: patch.original_text }
    }
    const idx = current.indexOf(patch.original_text)
    // String.replace は置換文字列の $ を特殊解釈するため、インデックスで連結する
    current =
      current.slice(0, idx) + patch.suggested_text + current.slice(idx + patch.original_text.length)
  }
  return { ok: true, content: current }
}
