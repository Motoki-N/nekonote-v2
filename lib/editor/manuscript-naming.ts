// ボードから生成する原稿ファイルの自動採番（SPEC-manuscript-bridge §3）。
// 副作用を持たない純関数。タイトルからのスラッグ化はしない
// （chapterFileNameSchema が英数字始まりのASCIIのみを許すのに対しタイトルは日本語であり、
// ローマ字変換は頼まれていない抽象化になる）

import { AppError } from "@/lib/errors";

/** 本文帯の下限。`00` は扉（00-tobira.md）の予約帯 */
const BODY_MIN = 1;
/** 本文帯の上限。`90〜99` はあとがき・奥付（90-atogaki.md / 99-okuzuke.md）の予約帯 */
const BODY_MAX = 89;

/** 採番の対象（ボード順。number = 章番号 or シーン通し番号） */
export type NamingItem = {
  kind: "scene" | "chapter";
  number: number;
};

/** ファイル名の2桁接頭番号（`NN-`）を数値で返す。形式が合わなければ null */
function leadingNumber(fileName: string): number | null {
  const match = fileName.match(/^(\d{2})-/);
  return match ? Number(match[1]) : null;
}

/**
 * 生成するファイル名をボード順に決める（SPEC-manuscript-bridge §3）。
 *
 * 開始番号は本文帯（01〜89）の既存最大値 + 1。以降ボード順に連番で、
 * 同名が既にあれば番号を1つ進めて再試行する。
 * 番号が飛んでも非単調でも実害はない——本の順序は book.config.js の entry が持つため、
 * 「既存ファイルを一切リネームしない」方針が成立する。
 *
 * @param existingNames manuscripts/ 直下の *.md（ファイル名のみ）
 * @param items ボード順の生成対象
 * @returns items と同じ並び・同じ長さのファイル名（例: ["03-chapter2.md", "04-scene7.md"]）
 */
export function planManuscriptFileNames(
  existingNames: string[],
  items: NamingItem[],
): string[] {
  const taken = new Set(existingNames);
  // 予約帯（00・90〜99）の番号は開始位置の計算に入れない。入れると常に 90番台の続きから
  // 採番することになり、本文帯が1件も使えなくなる
  const usedBodyNumbers = existingNames
    .map(leadingNumber)
    .filter((n): n is number => n !== null && n >= BODY_MIN && n <= BODY_MAX);
  let next =
    usedBodyNumbers.length === 0 ? BODY_MIN : Math.max(...usedBodyNumbers) + 1;

  const planned: string[] = [];
  for (const item of items) {
    const slug =
      item.kind === "chapter" ? `chapter${item.number}` : `scene${item.number}`;
    let fileName: string | null = null;
    // 同名の衝突を避けて空き番号まで進める（同一バッチ内の重複も taken で弾く）
    while (next <= BODY_MAX) {
      const candidate = `${String(next).padStart(2, "0")}-${slug}.md`;
      next += 1;
      if (!taken.has(candidate)) {
        fileName = candidate;
        break;
      }
    }
    if (fileName === null) {
      throw new AppError(
        "validation",
        "自動採番の空き番号がありません。ファイル名を指定してください",
      );
    }
    taken.add(fileName);
    planned.push(fileName);
  }
  return planned;
}
