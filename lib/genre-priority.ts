import type { WritingGenre } from '@/lib/schemas/enums'

// 執筆ジャンルによる既定選択の優先順位（SPEC-genre-profiles §既定選択）。
// PostgREST の order() では「一致優先」を表現できないため、取得後にJS側でソートする。
// 選択肢の絞り込みはしない（クロスジャンルの手動選択は可能なまま）

/** 一致=0 → 共通(null)=1 → 他ジャンル=2 */
export function genreRank(rowGenre: string | null, genre: WritingGenre): number {
  if (rowGenre === genre) return 0
  if (rowGenre === null) return 1
  return 2
}

/**
 * ジャンル優先ソート。Array.sort は安定ソートなので、
 * DB側の並び（is_default desc → created_at）が同順位内でそのまま維持される
 */
export function sortByGenrePriority<T extends { writing_genre: string | null }>(
  rows: readonly T[],
  genre: WritingGenre,
): T[] {
  return [...rows].sort((a, b) => genreRank(a.writing_genre, genre) - genreRank(b.writing_genre, genre))
}
