// 目次ページの設定（SPEC-toc-settings。Issue #307）。
// - book.config.js（と book.config.epub.js）: 目次の有無・見出し・載せる見出しの深さ
// - 判型テーマCSSの「目次ブロック」: 目次から外す章・書名の表示・ページ番号・リーダー
// どちらも実行もASTパースもせず、正規表現と文字列組み立てだけで読み書きする。
// 書き込む値はアプリが選択肢から組み立てたものに限る（見出し文字だけがユーザー入力）。
// サーバー（設定フォームの保存）とクライアント（全体プレビュー）の両方から使う純関数のみを置く

import {
  TOC_BLOCK_RE,
  canRewriteEntry,
  extractEntryPaths,
  isContentsItem,
  joinRepoPath,
  parseEntryItems,
  replaceEntryItems,
} from "@/lib/editor/book-config";
import type { PreviewToc, PreviewTocSource } from "@/lib/editor/preview";

// ---- book.config.js 側（SPEC §4.1） ----

/** 「載せる見出し」の選択肢（sectionDepth）。1 は 0 と見た目がほぼ同じため出さない（SPEC §4） */
export const TOC_DEPTH_OPTIONS = [
  { value: 0, label: "章のタイトルのみ" },
  { value: 2, label: "章＋節（##）まで" },
  { value: 3, label: "章＋節＋項（###）まで" },
] as const;

/** 目次の見出しが未指定のときに CLI が使う既定値 */
const CLI_DEFAULT_TOC_TITLE = "Table of Contents";
/** フォームで目次を新たに入れるときの見出しの初期値 */
export const DEFAULT_TOC_TITLE = "目次";

export type TocConfig = {
  /** 目次を入れるか（`{ rel: 'contents' }` か `toc` のどちらかがあれば入る＝CLI と同じ判定） */
  enabled: boolean;
  /** 目次の見出し（toc.title） */
  title: string;
  /** 載せる見出しの深さ（toc.sectionDepth。0〜6） */
  depth: number;
};

/** toc ブロックの中の `title: '...'` */
const TOC_TITLE_RE = /(\btitle\s*:\s*)(['"`])([^'"`\n]*)\2/;
/** toc ブロックの中の `sectionDepth: N` */
const TOC_DEPTH_RE = /(\bsectionDepth\s*:\s*)(\d+)/;

/** 目次の見出しとして書き込める文字列か（JSの文字列リテラルを壊さない） */
export function isValidTocTitle(title: string): boolean {
  return (
    title.trim() !== "" && title.length <= 30 && !/['"`\n\r\\]/.test(title)
  );
}

/**
 * book.config.js（または book.config.epub.js）から目次の設定を読む。
 * 書き換えられない構造（`toc` がオブジェクトリテラルでない・入れ子の `{}` を含む・
 * entry を安全に書き戻せない）なら null を返し、フォームは読み取り専用にする
 */
export function parseTocConfig(source: string): TocConfig | null {
  if (!canRewriteEntry(source)) return null;
  const items = parseEntryItems(source);
  if (!items) return null;
  const hasContents = items.some((item) => isContentsItem(item.raw));

  const keyMatch = /\btoc\s*:/.exec(source);
  const blockMatch = TOC_BLOCK_RE.exec(source);
  // `toc:` はあるのに単純なオブジェクトとして読めない（`toc: true`・入れ子等）
  if (keyMatch && (!blockMatch || blockMatch.index !== keyMatch.index))
    return null;
  // toc が2つ以上ある構造は扱わない
  if (blockMatch && /\btoc\s*:/.test(source.slice(keyMatch!.index + 1)))
    return null;

  const body = blockMatch?.[1] ?? "";
  const title = TOC_TITLE_RE.exec(body)?.[3];
  const depthText = TOC_DEPTH_RE.exec(body)?.[2];
  const enabled = hasContents || blockMatch !== null;
  return {
    enabled,
    title:
      title ??
      (blockMatch !== null || hasContents
        ? CLI_DEFAULT_TOC_TITLE
        : DEFAULT_TOC_TITLE),
    depth: depthText === undefined ? 0 : Math.min(6, Number(depthText)),
  };
}

/** `entry` の行のインデント（toc ブロックを新設するときに揃える） */
function entryIndent(source: string): string {
  const match = /^([ \t]*)entry\s*:/m.exec(source);
  return match ? match[1] : "  ";
}

/** toc ブロックの中身（title・sectionDepth）を書き換える。他のキーは保つ */
function rewriteTocBody(body: string, title: string, depth: number): string {
  // 既存のプロパティ行からインデントを推定する（なければ toc の行＋2）
  const innerIndent = /\n([ \t]+)\S/.exec(body)?.[1] ?? "    ";
  let updated = body;
  if (TOC_TITLE_RE.test(updated)) {
    // 関数形式で `$&` 等の置換テンプレート展開を防ぐ（security-review 2026-07-16 L-1）
    updated = updated.replace(
      TOC_TITLE_RE,
      (_whole, prefix: string, quote: string) =>
        `${prefix}${quote}${title}${quote}`,
    );
  } else {
    updated = `\n${innerIndent}title: '${title}',${updated}`;
  }
  if (TOC_DEPTH_RE.test(updated)) {
    updated = updated.replace(
      TOC_DEPTH_RE,
      (_whole, prefix: string) => `${prefix}${depth}`,
    );
  } else {
    // title の直後に足す（末尾カンマがなければ補う）
    updated = updated.replace(
      /(\btitle\s*:\s*(['"`])[^'"`\n]*\2)(\s*,)?/,
      (_whole, property: string, _quote: string, comma: string | undefined) =>
        `${property}${comma ?? ","}\n${innerIndent}sectionDepth: ${depth},`,
    );
  }
  return updated;
}

/** toc ブロックを丸ごと削除する（行ごと消せる形ならその行を、そうでなければ式だけを除く） */
function removeTocBlock(source: string): string {
  const lineRe =
    /^[ \t]*toc\s*:\s*\{[^{}]*\}[ \t]*,?[ \t]*(?:\/\/[^\n]*)?\r?\n/m;
  if (lineRe.test(source)) return source.replace(lineRe, "");
  return source.replace(/\btoc\s*:\s*\{[^{}]*\}\s*,?/, "");
}

/**
 * 目次の設定を book.config.js（または book.config.epub.js）へ書き込んだ中身を返す（SPEC §4.1）。
 * - 入れる: toc ブロックを用意し（なければ entry の直後に新設）、`{ rel: 'contents' }` がなければ
 *   「目次から外さない最初の章の直前」に挿入する
 * - 入れない: `{ rel: 'contents' }` と toc ブロックを両方消す（toc だけ残ると CLI が先頭に足すため）
 * 書き戻し後に parseTocConfig で読み直して一致しなければ null（呼び出し側はコミットしない）
 */
export function applyTocConfig(
  source: string,
  config: TocConfig,
  /** 目次から外す章（entry のパス。挿入位置の決定にだけ使う） */
  excludedPaths: readonly string[],
): string | null {
  if (!isValidTocTitle(config.title)) return null;
  if (!Number.isInteger(config.depth) || config.depth < 0 || config.depth > 6)
    return null;
  if (parseTocConfig(source) === null) return null;

  const items = parseEntryItems(source);
  if (!items) return null;
  const raws = items.map((item) => item.raw);
  let updated = source;

  if (config.enabled) {
    if (!items.some((item) => isContentsItem(item.raw))) {
      const excluded = new Set(excludedPaths);
      const firstListed = items.findIndex(
        (item) => item.path !== null && !excluded.has(item.path),
      );
      raws.splice(Math.max(0, firstListed), 0, "{ rel: 'contents' }");
      const replaced = replaceEntryItems(updated, raws);
      if (replaced === null) return null;
      updated = replaced;
    }
    const block = TOC_BLOCK_RE.exec(updated);
    if (block) {
      const body = rewriteTocBody(block[1], config.title, config.depth);
      updated =
        updated.slice(0, block.index) +
        `toc: {${body}}` +
        updated.slice(block.index + block[0].length);
    } else {
      // entry 配列の直後（`],` の後）に新設する
      const entryMatch = /\bentry\s*:\s*\[[\s\S]*?\](\s*,)?/.exec(updated);
      if (!entryMatch) return null;
      const indent = entryIndent(updated);
      const end = entryMatch.index + entryMatch[0].length;
      const comma = entryMatch[1] === undefined ? "," : "";
      const tocText =
        `\n${indent}toc: {\n` +
        `${indent}  title: '${config.title}',\n` +
        `${indent}  sectionDepth: ${config.depth},\n` +
        `${indent}},`;
      updated = updated.slice(0, end) + comma + tocText + updated.slice(end);
    }
  } else {
    const kept = raws.filter((raw) => !isContentsItem(raw));
    if (kept.length !== raws.length) {
      const replaced = replaceEntryItems(updated, kept);
      if (replaced === null) return null;
      updated = replaced;
    }
    updated = removeTocBlock(updated);
  }

  // 読み取り側と同じ関数で読み直して検証する（既存の設定フォームと同じ作法）
  const reread = parseTocConfig(updated);
  if (
    reread === null ||
    reread.enabled !== config.enabled ||
    (config.enabled &&
      (reread.title !== config.title || reread.depth !== config.depth))
  )
    return null;
  // 章の並びは変わっていないこと
  if (
    JSON.stringify(extractEntryPaths(updated)) !==
    JSON.stringify(extractEntryPaths(source))
  )
    return null;
  return updated;
}

/**
 * 全体プレビューに目次を差し込む位置（SPEC §7）。entry の章のうち、目次より前にあるものの数を返す。
 * 目次を入れない設定なら null。toc だけで `{ rel: 'contents' }` がなければ先頭（CLI と同じ）
 */
export function tocInsertIndex(source: string): number | null {
  const config = parseTocConfig(source);
  if (!config?.enabled) return null;
  const items = parseEntryItems(source) ?? [];
  const at = items.findIndex((item) => isContentsItem(item.raw));
  if (at === -1) return 0;
  return items.slice(0, at).filter((item) => item.path !== null).length;
}

// ---- テーマCSS側の目次ブロック（SPEC §5） ----

export const TOC_PAGE_NUMBER_OPTIONS = [
  { value: "kanji", label: "漢数字（一二）" },
  { value: "arabic", label: "算用数字（12）" },
  { value: "arabic-tcy", label: "算用数字・縦中横（12）" },
  { value: "none", label: "出さない" },
] as const;
export type TocPageNumber = (typeof TOC_PAGE_NUMBER_OPTIONS)[number]["value"];

export const TOC_LEADER_OPTIONS = [
  { value: "dots", label: "点線" },
  { value: "ellipsis", label: "三点リーダー" },
  { value: "none", label: "なし（番号の位置揃えのみ）" },
] as const;
export type TocLeader = (typeof TOC_LEADER_OPTIONS)[number]["value"];

export type TocStyle = {
  /** 目次ページに書名（CLI が出す `<h1>`）を出すか */
  showBookTitle: boolean;
  pageNumber: TocPageNumber;
  leader: TocLeader;
  /** 目次から外す章（entry のパス。例: `manuscripts/00-tobira.md`） */
  excludedPaths: string[];
};

/** ブロックがないテーマの初期値＝theme-base の既定の見た目（SPEC §5。今の見え方のまま） */
export const DEFAULT_TOC_STYLE: TocStyle = {
  showBookTitle: true,
  pageNumber: "arabic",
  leader: "dots",
  excludedPaths: [],
};

const PAGE_NUMBER_VARS: Record<TocPageNumber, [string, string]> = {
  kanji: ["inline", "cjk-decimal"],
  arabic: ["inline", "decimal"],
  // 変数は算用数字と同じ。数字を立てる指定は TCY_PAGE_NUMBER_RULE で足す
  "arabic-tcy": ["inline", "decimal"],
  none: ["none", "decimal"],
};
const LEADER_VARS: Record<TocLeader, string> = {
  dots: "leader('.') ' '",
  ellipsis: "leader('…') ' '",
  none: "leader(' ') ' '",
};

const BLOCK_BEGIN =
  "/* nekonote-toc: begin — 目次（ネコノテAI の設定フォームが管理。begin〜end の間を手で編集するとフォームは読み取り専用になる） */";
const BLOCK_END = "/* nekonote-toc: end */";
const BLOCK_RE =
  /\/\* nekonote-toc: begin\b[\s\S]*?\/\* nekonote-toc: end \*\//;

const TOC_SCOPE = ":is(#toc, [role='doc-toc'])";
/** 書名（CLI が目次 nav の直前に出す h1）を隠す。プレビューの構造にも当たる形にしている */
const HIDE_BOOK_TITLE_RULE = `h1:has(+ ${TOC_SCOPE}) {\n  display: none;\n}`;
/**
 * ページ番号を縦中横にする（縦組みで算用数字が横倒しになるのを防ぐ）。theme-base はリーダーと
 * 番号を同じ ::after に出すが、Vivliostyle ではリーダーを保ったまま番号だけが1字分に組まれる。
 * 3桁以上は1字の幅に詰まる（試しビルドで確認済み）
 */
const TCY_PAGE_NUMBER_RULE = `${TOC_SCOPE} li > a::after {\n  text-combine-upright: all;\n}`;
/** リンクのない項目（id のない見出し）はページ番号が付かないため常に隠す（SPEC §5） */
const HIDE_LINKLESS_RULE = `${TOC_SCOPE} li:not(:has(a)) {\n  display: none;\n}`;

/**
 * entry のパス → CLI の目次が出すリンク先（`.md` → `.html`・encodeURI）。
 * 目次はワークスペース直下に生成され、各章は entry と同じ相対位置に置かれるため、
 * リンク先は entry のパスそのものになる。encodeURI は `"` と `\` もエスケープするので
 * CSS の文字列へそのまま入れてよい
 */
export function tocHref(entryPath: string): string {
  return encodeURI(entryPath.replace(/^\.\//, "").replace(/\.md$/, ".html"));
}

function hrefToEntryPath(href: string): string | null {
  try {
    return decodeURI(href).replace(/\.html$/, ".md");
  } catch {
    return null;
  }
}

function excludeRule(entryPath: string): string {
  const href = tocHref(entryPath);
  return `${TOC_SCOPE} li:has(> a:is([href="${href}"], [href^="${href}#"])) {\n  display: none;\n}`;
}

/** 設定から目次ブロックを組み立てる（読み取り時の照合にも使うため、出力は設定だけで決まる） */
export function buildTocBlock(style: TocStyle): string {
  const [display, counterStyle] = PAGE_NUMBER_VARS[style.pageNumber];
  const rules = [
    `:root {\n  --vs-toc--page-counter-display: ${display};\n  --vs-toc--page-counter-style: ${counterStyle};\n  --vs-toc--page-leader-content: ${LEADER_VARS[style.leader]};\n}`,
    ...(style.pageNumber === "arabic-tcy" ? [TCY_PAGE_NUMBER_RULE] : []),
    ...(style.showBookTitle ? [] : [HIDE_BOOK_TITLE_RULE]),
    HIDE_LINKLESS_RULE,
    ...style.excludedPaths.map(excludeRule),
  ];
  return [BLOCK_BEGIN, ...rules, BLOCK_END].join("\n");
}

function findKey<T extends string>(
  table: Record<T, unknown>,
  matches: (value: unknown) => boolean,
): T | null {
  const key = (Object.keys(table) as T[]).find((k) => matches(table[k]));
  return key ?? null;
}

/**
 * テーマCSSの目次ブロックを読む。
 * - ブロックがない → "absent"（フォームは DEFAULT_TOC_STYLE を表示し、保存時に追記する）
 * - 手で編集されている（組み立て直したものと一致しない） → null（読み取り専用）
 */
export function parseTocStyle(css: string): TocStyle | "absent" | null {
  const block = BLOCK_RE.exec(css)?.[0];
  if (block === undefined) return "absent";
  const varValue = (name: string) =>
    new RegExp(`${name}\\s*:\\s*([^;\\n]+);`).exec(block)?.[1].trim() ?? null;
  const display = varValue("--vs-toc--page-counter-display");
  const counterStyle = varValue("--vs-toc--page-counter-style");
  const leaderValue = varValue("--vs-toc--page-leader-content");
  const fromVars = findKey(
    PAGE_NUMBER_VARS,
    (value) =>
      Array.isArray(value) && value[0] === display && value[1] === counterStyle,
  );
  // 算用数字と縦中横は変数が同じなので、縦中横の指定の有無で見分ける
  const pageNumber =
    fromVars === "arabic" && block.includes(TCY_PAGE_NUMBER_RULE)
      ? "arabic-tcy"
      : fromVars;
  const leader = findKey(LEADER_VARS, (value) => value === leaderValue);
  if (pageNumber === null || leader === null) return null;
  const excludedPaths = extractTocExcludedPaths(block);
  if (excludedPaths === null) return null;
  const style: TocStyle = {
    showBookTitle: !block.includes(HIDE_BOOK_TITLE_RULE),
    pageNumber,
    leader,
    excludedPaths,
  };
  const normalize = (text: string) => text.replace(/\r\n/g, "\n").trim();
  return normalize(buildTocBlock(style)) === normalize(block) ? style : null;
}

/**
 * 目次ブロックから「目次から外す章」だけを取り出す（照合なしの緩い読み取り）。
 * 全体プレビュー用（手編集されたブロックでも、外した章はプレビューから外しておく）。
 * ブロックがなければ空配列、リンク先を復号できなければ null
 */
export function extractTocExcludedPaths(css: string): string[] | null {
  const block = BLOCK_RE.exec(css)?.[0];
  if (block === undefined) return [];
  const paths: string[] = [];
  for (const match of block.matchAll(/a:is\(\[href="([^"]+)"\]/g)) {
    const path = hrefToEntryPath(match[1]);
    if (path === null) return null;
    paths.push(path);
  }
  return paths;
}

/** テーマCSSへ目次ブロックを書き込む（あれば置換・なければ末尾へ追記） */
export function applyTocBlock(css: string, style: TocStyle): string {
  const block = buildTocBlock(style);
  if (BLOCK_RE.test(css)) {
    // 関数形式で `$&` 等の置換テンプレート展開を防ぐ（security-review 2026-07-16 L-1）
    return css.replace(BLOCK_RE, () => block);
  }
  const base = css.endsWith("\n") ? css : `${css}\n`;
  return `${base}\n${block}\n`;
}

/** 2つの目次スタイルが同じか（A6/B6 の食い違いの検出・差分表示に使う） */
export function sameTocStyle(a: TocStyle, b: TocStyle): boolean {
  return buildTocBlock(a) === buildTocBlock(b);
}

// ---- 全体プレビュー（SPEC §7） ----

/**
 * サーバーが返した目次の元情報に、テーマCSSの目次ブロックで外した章を反映する。
 * 目次ブロックは手編集されていても外した章だけは読む（プレビューを本ビルドに近づけるため）
 */
export function toPreviewToc(
  source: PreviewTocSource,
  themeCss: string,
  basePath: string,
): PreviewToc {
  const excluded = new Set(
    (extractTocExcludedPaths(themeCss) ?? []).flatMap((path) => {
      const repoPath = joinRepoPath(basePath, path);
      return repoPath === null ? [] : [repoPath];
    }),
  );
  const { entryPaths, ...rest } = source;
  return {
    ...rest,
    listedPaths: entryPaths.filter((path) => !excluded.has(path)),
  };
}
