/**
 * 執筆進捗の増分計算。サーバー（app/api/chat/route.ts のスケジュールコンテキスト）と
 * クライアント（project-overview-card.tsx の実ペース表示）で共用する純関数。
 * 片方だけ仕様変更して「AIが語る数字」と「カードの数字」が食い違うのを防ぐ
 */

export type ProgressRow = {
  /** YYYY-MM-DD（JST） */
  date: string;
  totalChars: number;
};

/**
 * 境界日（today - days日）以前の直近の記録を基準にした増分。
 * rows は日付昇順。記録が疎な場合に備え、ペース計算用の実スパン
 * （基準→最新の実日数）も返す。基準になる過去の記録がなければ null
 */
export function deltaSince(
  rows: readonly ProgressRow[],
  today: string,
  days: number,
): { chars: number; days: number } | null {
  const latest = rows.at(-1);
  if (!latest) return null;
  // YYYY-MM-DD は Date.parse でUTC深夜として解釈される＝日付演算は端末TZ非依存
  const boundary = new Date(Date.parse(today) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const baseline = rows.filter((row) => row.date <= boundary).at(-1);
  if (!baseline || baseline.date === latest.date) return null;
  return {
    chars: latest.totalChars - baseline.totalChars,
    days: Math.round(
      (Date.parse(latest.date) - Date.parse(baseline.date)) / 86_400_000,
    ),
  };
}
