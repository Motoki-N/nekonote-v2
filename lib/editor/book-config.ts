// book.config.js（Vivliostyle CLI 設定）の情報抽出（SPEC-vertical-editor-phase2 §3.3・§5.1）。
// JSファイルのため実行せず、文字列リテラルを正規表現で抽出する。
// 抽出できない場合の扱い（章順フォールバック等）は呼び出し側の責務

/** entry 配列から章ファイルパス（.md の文字列リテラル）を出現順に抽出する */
export function extractEntryPaths(source: string): string[] {
  const arrayMatch = source.match(/\bentry\s*:\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) return [];
  const paths: string[] = [];
  for (const literal of arrayMatch[1].matchAll(/['"`]([^'"`\n]+\.md)['"`]/g)) {
    paths.push(literal[1]);
  }
  return paths;
}

/** theme のCSSパス（文字列リテラル）を抽出する。見つからなければ null */
export function extractThemePath(source: string): string | null {
  const match = source.match(/\btheme\s*:\s*['"`]([^'"`\n]+)['"`]/);
  return match ? match[1] : null;
}

/**
 * `size: '105mm,148mm'` をCSSの @page size 値（`105mm 148mm`）として抽出する。
 * CLIビルドではこの設定が判型を与えるが、ブラウザプレビューには渡らないため、
 * アプリが `--vs-page--size` としてテーマに注入する（これがないと `size: auto` の
 * まま組版され、ページ分割されない）。寸法ペアと用紙名（A6 等）のみ許可
 */
export function extractPageSizeCss(source: string): string | null {
  const match = source.match(/\bsize\s*:\s*['"`]([^'"`\n]+)['"`]/);
  if (!match) return null;
  const value = match[1].trim();
  const pair = value.match(
    /^(\d+(?:\.\d+)?(?:mm|cm|pt|in|px))\s*,\s*(\d+(?:\.\d+)?(?:mm|cm|pt|in|px))$/,
  );
  if (pair) return `${pair[1]} ${pair[2]}`;
  return /^[A-Za-z]\d?(?:\s+(?:portrait|landscape))?$/.test(value)
    ? value
    : null;
}

// ---- 設定フォーム用の読み書き（SPEC-vertical-editor-phase3 §7）。
// 実行もASTパースもせず、正規表現ベースの文字列置換のみで書き換える。
// 呼び出し側は置換後に抽出関数を再実行して期待値が読めることを検証してからコミットする

/** 書誌情報のキー（値が単純な文字列リテラルのもののみ対象） */
export type BiblioKey = "title" | "author";

/** `key: '値'` の文字列リテラル値を抽出する。見つからなければ null */
export function extractStringValue(
  source: string,
  key: BiblioKey,
): string | null {
  const match = source.match(
    new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`\\n]*)\\1`),
  );
  return match ? match[2] : null;
}

/**
 * `key: '値'` の値を置換する（引用符のスタイルは元のまま）。
 * キーが見つからない・値に引用符や改行が入る場合は null（フェイルソフト）
 */
export function replaceStringValue(
  source: string,
  key: BiblioKey,
  value: string,
): string | null {
  if (/['"`\n\\]/.test(value)) return null;
  const regex = new RegExp(`(\\b${key}\\s*:\\s*)(['"\`])[^'"\`\\n]*\\2`);
  if (!regex.test(source)) return null;
  // 置換は関数形式にする（値に `$&` 等が含まれても置換テンプレート展開されない。
  // security-review 2026-07-16 L-1）
  return source.replace(
    regex,
    (_whole, prefix: string, quote: string) =>
      `${prefix}${quote}${value}${quote}`,
  );
}

/** entry 配列の1要素（文字列リテラル＝章、その他＝目次差し込み等の表示専用要素） */
export type EntryItem = {
  /** 元テキスト（トリム済み。書き戻しにそのまま使う） */
  raw: string;
  /** 章ファイルパス（文字列リテラルの場合のみ。それ以外は null） */
  path: string | null;
};

/**
 * entry 配列をトップレベルのカンマで分割して要素ごとに返す。
 * 配列が見つからない・ネストが壊れている場合は null（フォームは読み取り専用にする）
 */
export function parseEntryItems(source: string): EntryItem[] | null {
  const arrayMatch = source.match(/\bentry\s*:\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) return null;
  const inner = arrayMatch[1];
  const items: EntryItem[] = [];
  let depth = 0;
  let current = "";
  for (const char of inner) {
    if (char === "{" || char === "[" || char === "(") depth++;
    if (char === "}" || char === "]" || char === ")") depth--;
    if (depth < 0) return null;
    if (char === "," && depth === 0) {
      pushEntryItem(items, current);
      current = "";
      continue;
    }
    current += char;
  }
  if (depth !== 0) return null;
  pushEntryItem(items, current);
  return items;
}

function pushEntryItem(items: EntryItem[], text: string): void {
  // 行コメントは要素に含めない（`// 目次（自動生成）...` 等の注記行）
  const raw = text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line !== "")
    .join(" ");
  if (raw === "") return;
  const literal = raw.match(/^['"`]([^'"`\n]+\.md)['"`]$/);
  items.push({ raw, path: literal ? literal[1] : null });
}

/**
 * entry 配列の中身を newItems（各要素の raw テキスト）で書き換える。
 * インデントは既存の最初の要素行に合わせる（なければスペース4つ）
 */
export function replaceEntryItems(
  source: string,
  newItems: string[],
): string | null {
  const arrayMatch = source.match(/(\bentry\s*:\s*\[)([\s\S]*?)(\])/);
  if (!arrayMatch) return null;
  const indentMatch = arrayMatch[2].match(/\n([ \t]+)\S/);
  const indent = indentMatch ? indentMatch[1] : "    ";
  const closeIndent =
    indent.length >= 2 ? indent.slice(0, indent.length - 2) : "";
  const body = newItems.map((item) => `${indent}${item},`).join("\n");
  // 関数形式で `$` 系の置換テンプレート展開を防ぐ（security-review 2026-07-16 L-1）
  return source.replace(
    /\bentry\s*:\s*\[[\s\S]*?\]/,
    () => `entry: [\n${body}\n${closeIndent}]`,
  );
}

/** テーマCSSの組み設定変数（SPEC-phase3 §7-3。値は文字列のまま扱い、数値検証は呼び出し側） */
export const KUMI_VAR_NAMES = [
  "--vs-font-size-on-print",
  "--vs-line-height",
  "--vs-theme--num-of-line",
  "--vs-theme--num-of-character",
] as const;
export type KumiVarName = (typeof KUMI_VAR_NAMES)[number];

/**
 * ノンブル・柱のスロット変数（SPEC-phase3 §7-5。Issue #237）。
 * 値の実体は判型テーマの `:root`、これを参照する `@page` ルールは nekonote-parts.css にある
 */
export const NOMBRE_VAR_NAMES = [
  "--nekonote--slot-top-outer",
  "--nekonote--slot-top-center",
  "--nekonote--slot-bottom-outer",
  "--nekonote--slot-bottom-center",
] as const;
export type NombreVarName = (typeof NOMBRE_VAR_NAMES)[number];

/** 設定フォームが書き換えるテーマCSS変数（組み設定＋ノンブル・柱） */
export type ThemeVarName = KumiVarName | NombreVarName;

/** テーマCSSから組み設定変数の値を抽出する（`%` などの単位付きはそのまま返す） */
export function extractCssVar(css: string, name: ThemeVarName): string | null {
  const match = css.match(new RegExp(`${name}\\s*:\\s*([^;\\n]+);`));
  return match ? match[1].trim() : null;
}

/** テーマCSSの変数値を置換する。変数が見つからなければ null */
export function replaceCssVar(
  css: string,
  name: ThemeVarName,
  value: string,
): string | null {
  if (/[;{}\n]/.test(value)) return null;
  const regex = new RegExp(`(${name}\\s*:\\s*)[^;\\n]+(;)`);
  if (!regex.test(css)) return null;
  // 関数形式で `$` 系の置換テンプレート展開を防ぐ（security-review 2026-07-16 L-1）
  return css.replace(
    regex,
    (_whole, prefix: string, semi: string) => `${prefix}${value}${semi}`,
  );
}

// ---- ノンブル・柱の設定（Issue #237）。
// UIの選択（ノンブル・柱の位置）と、テーマCSSのスロット変数値との相互変換。
// 書き込む値は下の対応表から組み立てたものだけに限り、任意のCSSがテーマへ入らないようにする

/** ノンブル・柱を出せる位置。小口（outer）は左右ページで自動的に入れ替わる */
export const NOMBRE_SLOTS = [
  "none",
  "top-outer",
  "top-center",
  "bottom-outer",
  "bottom-center",
] as const;
export type NombreSlot = (typeof NOMBRE_SLOTS)[number];

export const NOMBRE_SLOT_LABELS: Record<NombreSlot, string> = {
  none: "出さない",
  "top-outer": "天・小口",
  "top-center": "天・中央",
  "bottom-outer": "地・小口",
  "bottom-center": "地・中央",
};

export type NombreSettings = {
  /** ノンブル（ページ番号）の位置 */
  page: NombreSlot;
  /** 柱（章タイトル）の位置。同じ位置ならノンブルと連結して出る */
  title: NombreSlot;
};

/** 位置 → スロット変数名（`none` はどの変数にも対応しない） */
const SLOT_VAR_NAMES = {
  "top-outer": "--nekonote--slot-top-outer",
  "top-center": "--nekonote--slot-top-center",
  "bottom-outer": "--nekonote--slot-bottom-outer",
  "bottom-center": "--nekonote--slot-bottom-center",
} as const satisfies Record<Exclude<NombreSlot, "none">, NombreVarName>;

const PAGE_CONTENT = "counter(page)";
const TITLE_CONTENT = "env(doc-title)";
/** ノンブルと柱を同じ位置に出すときの区切り（theme-bunko 既定と同じ全角空白） */
const JOINER = "'　'";

/**
 * 空白の入れ方の揺れを吸収して比較する（CSSの値としては等価）。
 * 引用符の中（区切り文字）は空白そのものが意味を持つため、畳まずに残す
 * ——`counter(page) ' ' env(doc-title)`（半角区切り）を全角区切りと同一視して
 * 黙って書き換えてしまわないようにする
 */
function normalizeSlotValue(value: string): string {
  const quoted: string[] = [];
  // 空白除去で消えない目印（CSSの値には現れない制御文字）へ退避してから畳む
  const masked = value.replace(/'[^']*'|"[^"]*"/g, (match) => {
    quoted.push(match);
    return `\u0000${quoted.length - 1}\u0000`;
  });
  return masked
    .replace(/\s+/g, "")
    .replace(
      /\u0000(\d+)\u0000/g,
      (_whole, index: string) => quoted[+index],
    );
}

/** スロット値 → 何が入っているか。組み立て可能な値でなければ null（＝手書き扱い） */
function parseSlotValue(
  value: string,
): { page: boolean; title: boolean } | null {
  const normalized = normalizeSlotValue(value);
  if (normalized === "none") return { page: false, title: false };
  if (normalized === normalizeSlotValue(PAGE_CONTENT))
    return { page: true, title: false };
  if (normalized === normalizeSlotValue(TITLE_CONTENT))
    return { page: false, title: true };
  if (
    normalized === normalizeSlotValue(`${PAGE_CONTENT} ${JOINER} ${TITLE_CONTENT}`)
  )
    return { page: true, title: true };
  return null;
}

/**
 * テーマCSSのスロット変数からノンブル設定を復元する。
 * 変数が欠けている・アプリが組み立てられない値が入っている（手書きでカスタムされた）場合は
 * null を返し、呼び出し側はそのテーマを読み取り専用として扱う（フェイルソフト）
 */
export function parseNombreSettings(
  vars: Partial<Record<NombreVarName, string | null>>,
): NombreSettings | null {
  let page: NombreSlot = "none";
  let title: NombreSlot = "none";
  for (const [slot, varName] of Object.entries(SLOT_VAR_NAMES)) {
    const raw = vars[varName];
    if (raw === null || raw === undefined) return null;
    const parsed = parseSlotValue(raw);
    if (!parsed) return null;
    // 同じものが複数のスロットに入っている状態はUIで表現できない
    if (parsed.page) {
      if (page !== "none") return null;
      page = slot as NombreSlot;
    }
    if (parsed.title) {
      if (title !== "none") return null;
      title = slot as NombreSlot;
    }
  }
  return { page, title };
}

/** ノンブル設定 → 書き込むスロット変数の値（全変数を必ず埋める） */
export function buildNombreVars(
  settings: NombreSettings,
): Record<NombreVarName, string> {
  const values = {} as Record<NombreVarName, string>;
  for (const [slot, varName] of Object.entries(SLOT_VAR_NAMES)) {
    const parts: string[] = [];
    if (settings.page === slot) parts.push(PAGE_CONTENT);
    if (settings.title === slot) parts.push(TITLE_CONTENT);
    values[varName] = parts.length === 0 ? "none" : parts.join(` ${JOINER} `);
  }
  return values;
}

/** リポジトリルート基準でパスを結合する（`.`/`..`/空セグメントを正規化。ルート外は null） */
export function joinRepoPath(...segments: string[]): string | null {
  const resolved: string[] = [];
  for (const segment of segments) {
    for (const part of segment.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (resolved.length === 0) return null;
        resolved.pop();
        continue;
      }
      resolved.push(part);
    }
  }
  return resolved.join("/");
}
