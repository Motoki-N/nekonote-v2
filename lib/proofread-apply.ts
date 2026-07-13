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
