// JST 固定の日付ヘルパ（SPEC-refactoring-step1 段階3 D-3）。
// 「進捗記録・リマインド・退避フォルダ名は JST の日付で揃える」という仕様が
// 複数ファイルに別実装で埋まっていたものを一元化する（サーバーは UTC で動くため明示する）

/** JST 基準の日付（YYYY-MM-DD）。writing_progress の date・リマインド判定に使う */
export function jstDateString(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    at,
  );
}

/**
 * JST のコンパクトなタイムスタンプ（YYYYMMDD-HHmmss）。退避フォルダ名などに使う。
 * JST は DST なしのため +9 時間の固定オフセットで読み替える
 */
export function jstStamp(at: Date): string {
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${jst.slice(0, 10).replaceAll("-", "")}-${jst.slice(11, 19).replaceAll(":", "")}`;
}
