// 組版スタイル（縦書き・文庫 ⇄ 横書き・技術書）の定義と変換（SPEC-horizontal-typesetting §3・§5）。
// 初期セットアップ（案A）と書籍設定からの切替（案B）が同じ変換関数を使い、結果を常に一致させる。
// 書字方向の単一情報源は原稿リポジトリのまま（アプリは対応表だけを知っている）。
// "use server" ファイルは async 関数しか export できないため、純関数はこの層に置く

import {
  extractStringValue,
  extractThemePath,
  replaceStringValue,
} from "@/lib/editor/book-config";

export const TYPESETTING_STYLES = ["vertical", "horizontal"] as const;
export type TypesettingStyle = (typeof TYPESETTING_STYLES)[number];

type StyleSet = {
  /** UI 表示名 */
  label: string;
  primary: { label: string; size: string; theme: string; token: string };
  secondary: {
    label: string;
    config: string;
    size: string;
    theme: string;
    token: string;
  };
  epub: { theme: string; readingProgression: "rtl" | "ltr" };
  /** ワークフロー中の判型表記（主判型・第2判型。長いものから並べる＝置換順） */
  workflowLabels: [primary: string[], secondary: string[]];
  /** 設定ファイルのコメント中の表記（book.config.js の判型・EPUB のページ送り）。スタイル間で同じ順に対応させる */
  commentLabels: string[];
};

/** スタイルセットの対応表（SPEC §3）。パスはプロジェクトルート（base_path）起点 */
export const STYLE_SETS: Record<TypesettingStyle, StyleSet> = {
  vertical: {
    label: "縦書き（文庫）",
    primary: {
      label: "A6",
      size: "105mm,148mm",
      theme: "./themes/theme-bunko-a6.css",
      token: "a6",
    },
    secondary: {
      label: "B6",
      config: "book.config.b6.js",
      size: "128mm,182mm",
      theme: "./themes/theme-b6.css",
      token: "b6",
    },
    epub: { theme: "./themes/theme-epub.css", readingProgression: "rtl" },
    workflowLabels: [
      ["文庫判 A6", "A6版"],
      ["B6判", "B6版"],
    ],
    commentLabels: ["文庫判（A6）", "B6ビルド", "縦書きのページ送り（右→左）"],
  },
  horizontal: {
    label: "横書き（技術書）",
    primary: {
      label: "A5",
      size: "148mm,210mm",
      theme: "./themes/theme-techbook-a5.css",
      token: "a5",
    },
    secondary: {
      label: "B5",
      config: "book.config.b5.js",
      size: "182mm,257mm",
      theme: "./themes/theme-techbook-b5.css",
      token: "b5",
    },
    epub: {
      theme: "./themes/theme-epub-horizontal.css",
      readingProgression: "ltr",
    },
    workflowLabels: [
      ["A5判", "A5版"],
      ["B5判", "B5版"],
    ],
    commentLabels: ["A5判", "B5ビルド", "横書きのページ送り（左→右）"],
  },
};

export const PRIMARY_CONFIG = "book.config.js";
export const EPUB_CONFIG = "book.config.epub.js";
export const WORKFLOW_PATH = ".github/workflows/build-pdf.yml";
const PACKAGE_JSON = "package.json";
const PACKAGE_LOCK = "package-lock.json";
const TECHBOOK_PACKAGE = "@vivliostyle/theme-techbook";
const TECHBOOK_LOCK_KEY = `node_modules/${TECHBOOK_PACKAGE}`;

/** `./themes/x.css` と `themes/x.css` を同一視する */
function normalizeRelPath(path: string): string {
  return path.replace(/^\.\//, "");
}

/** テーマのリポジトリ相対パス（`./` なし。ファイルの読み書きに使う） */
export function themeFilePath(theme: string): string {
  return normalizeRelPath(theme);
}

/**
 * book.config.js の内容から現在の組版スタイルを判定する（SPEC §3）。
 * theme が対応表の主判型テーマと一致しなければ custom（アプリからは切り替えない）
 */
export function detectTypesettingStyle(
  configContent: string,
): TypesettingStyle | "custom" {
  const theme = extractThemePath(configContent);
  if (!theme) return "custom";
  return (
    TYPESETTING_STYLES.find(
      (style) =>
        normalizeRelPath(STYLE_SETS[style].primary.theme) ===
        normalizeRelPath(theme),
    ) ?? "custom"
  );
}

/** 第2判型の設定ファイル（全スタイル分）。書籍設定がテーマCSSの書き換えを許可する設定ファイルに使う */
export const SECONDARY_CONFIGS: string[] = TYPESETTING_STYLES.map(
  (style) => STYLE_SETS[style].secondary.config,
);

/**
 * 書籍設定が読む第2判型の設定ファイル（現在のスタイルのもの。custom は存在するものを順に探す）
 */
export function secondaryConfigsFor(
  style: TypesettingStyle | "custom",
): string[] {
  return style === "custom"
    ? SECONDARY_CONFIGS
    : [STYLE_SETS[style].secondary.config];
}

/** 書籍設定に出す判型名（custom は判型を断定しない） */
export function sizeLabelsFor(style: TypesettingStyle | "custom"): {
  primary: string;
  secondary: string;
} {
  return style === "custom"
    ? { primary: "既定", secondary: "第2判型" }
    : {
        primary: `既定（${STYLE_SETS[style].primary.label}）`,
        secondary: STYLE_SETS[style].secondary.label,
      };
}

/** 変換・切替で読む可能性のあるファイル（プロジェクトルート起点）。書き換え対象はこの中に限る */
export const TYPESETTING_CANDIDATE_PATHS: string[] = [
  PRIMARY_CONFIG,
  EPUB_CONFIG,
  WORKFLOW_PATH,
  PACKAGE_JSON,
  PACKAGE_LOCK,
  ...TYPESETTING_STYLES.flatMap((style) => [
    STYLE_SETS[style].secondary.config,
    themeFilePath(STYLE_SETS[style].primary.theme),
    themeFilePath(STYLE_SETS[style].secondary.theme),
    themeFilePath(STYLE_SETS[style].epub.theme),
  ]),
];

/** 移行先で追加しうるテンプレートファイル（テンプレートから内容を取る） */
export function templatePathsFor(to: TypesettingStyle): string[] {
  const set = STYLE_SETS[to];
  return [
    themeFilePath(set.primary.theme),
    themeFilePath(set.secondary.theme),
    themeFilePath(set.epub.theme),
    set.secondary.config,
    PACKAGE_LOCK,
  ];
}

export type TypesettingChange = {
  path: string;
  kind: "modify" | "add" | "delete";
  /** modify / delete の変更前（add は null） */
  before: string | null;
  /** modify / add の変更後（delete は null） */
  after: string | null;
};

export type TypesettingProblem = { path: string; reason: string };

export type TypesettingConversion =
  | { ok: true; changes: TypesettingChange[]; warnings: string[] }
  | { ok: false; problems: TypesettingProblem[] };

/**
 * 出力ファイル名の判型トークン（`-a6.pdf` / `-a6-press.pdf`）に一致する正規表現。
 * 出力名の文脈に限るのは、slug やアクションの SHA 固定に含まれる `a6` 等を巻き込まないため
 * （security-review 2026-11-01 Low）
 */
function sizeTokenPattern(token: string): RegExp {
  return new RegExp(`-${token}(?=\\.pdf|-press\\.pdf)`, "g");
}

/** 判型トークン（`-a6.pdf` / `-a6-press.pdf` の `a6` 等）を置換する。置換件数も返す */
function replaceSizeTokens(
  source: string,
  pairs: [from: string, to: string][],
): { result: string; count: number } {
  let count = 0;
  let result = source;
  for (const [from, to] of pairs) {
    result = result.replace(sizeTokenPattern(from), () => {
      count++;
      return `-${to}`;
    });
  }
  return { result, count };
}

/** ワークフロー中の判型表記を置換する（主判型・第2判型をそれぞれ長いものから） */
function replaceWorkflowLabels(
  source: string,
  from: StyleSet,
  to: StyleSet,
): string {
  let result = source;
  for (const index of [0, 1] as const) {
    from.workflowLabels[index].forEach((label, i) => {
      result = result.replaceAll(label, to.workflowLabels[index][i]);
    });
  }
  return result;
}

/** 設定ファイルのコメント中の判型表記・第2判型のファイル名を揃える（値の置換とは独立。見つからなければ何もしない） */
function replaceCommentLabels(
  source: string,
  from: StyleSet,
  to: StyleSet,
): string {
  let result = source.replaceAll(from.secondary.config, to.secondary.config);
  from.commentLabels.forEach((label, i) => {
    result = result.replaceAll(label, to.commentLabels[i]);
  });
  return result;
}

/** 文字列リテラルの値を順に置換する。どれか1つでも置換できなければ null */
function replaceValues(
  source: string,
  values: [key: Parameters<typeof replaceStringValue>[1], value: string][],
): string | null {
  let result: string | null = source;
  for (const [key, value] of values) {
    if (result === null) return null;
    result = replaceStringValue(result, key, value);
  }
  return result;
}

/** JSON を元の末尾改行の有無を保って書き出す（インデントは npm と同じ2スペース） */
function stringifyJsonLike(original: string, value: unknown): string {
  return JSON.stringify(value, null, 2) + (original.endsWith("\n") ? "\n" : "");
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}

/**
 * 組版スタイルを変換する（SPEC §5.1）。
 * files: リポジトリ内の現在のファイル（プロジェクトルート起点のパス → 内容。存在するものだけ）
 * template: テンプレートの該当ファイル（templatePathsFor(to) の内容。作品情報の置換前でよい）
 * EPUB 以外のどれか1つでも変換できなければ ok: false（全か無か）
 */
export function convertTypesettingStyle(params: {
  files: Record<string, string>;
  template: Record<string, string>;
  from: TypesettingStyle;
  to: TypesettingStyle;
}): TypesettingConversion {
  const { files, template } = params;
  const from = STYLE_SETS[params.from];
  const to = STYLE_SETS[params.to];
  if (params.from === params.to)
    return {
      ok: false,
      problems: [
        { path: PRIMARY_CONFIG, reason: "すでにこの組版スタイルです" },
      ],
    };

  const changes: TypesettingChange[] = [];
  const problems: TypesettingProblem[] = [];
  const warnings: string[] = [];
  const modify = (path: string, after: string) => {
    if (files[path] !== after)
      changes.push({ path, kind: "modify", before: files[path], after });
  };
  const sizePairs: [string, string][] = [
    [from.primary.token, to.primary.token],
    [from.secondary.token, to.secondary.token],
  ];

  // ---- book.config.js（判型・テーマ・出力名）
  const config = files[PRIMARY_CONFIG];
  let slug: string | null = null;
  if (config === undefined) {
    problems.push({ path: PRIMARY_CONFIG, reason: "ファイルがありません" });
  } else if (detectTypesettingStyle(config) !== params.from) {
    problems.push({
      path: PRIMARY_CONFIG,
      reason: `theme が ${from.label}の既定テーマ（${from.primary.theme}）ではありません`,
    });
  } else {
    slug =
      config.match(
        new RegExp(`output/([a-z0-9][a-z0-9-]*)-${from.primary.token}\\.pdf`),
      )?.[1] ?? null;
    const replaced = replaceValues(config, [
      ["theme", to.primary.theme],
      ["size", to.primary.size],
    ]);
    const tokens = replaced ? replaceSizeTokens(replaced, sizePairs) : null;
    if (!tokens || tokens.count === 0) {
      problems.push({
        path: PRIMARY_CONFIG,
        reason: `theme・size・出力ファイル名（-${from.primary.token}.pdf）を書き換えられない構造です`,
      });
    } else {
      modify(PRIMARY_CONFIG, replaceCommentLabels(tokens.result, from, to));
    }
  }

  // ---- 第2判型の設定（旧ファイルを削除して新ファイルを作る）
  const oldSecondary = files[from.secondary.config];
  if (files[to.secondary.config] !== undefined) {
    problems.push({
      path: to.secondary.config,
      reason: "移行先の第2判型の設定ファイルが既にあります",
    });
  } else if (oldSecondary !== undefined) {
    const replaced = replaceValues(oldSecondary, [
      ["size", to.secondary.size],
      ["theme", to.secondary.theme],
    ]);
    const tokens = replaced ? replaceSizeTokens(replaced, sizePairs) : null;
    if (!tokens || tokens.count === 0) {
      problems.push({
        path: from.secondary.config,
        reason: `size・theme・出力ファイル名（-${from.secondary.token}.pdf）を書き換えられない構造です`,
      });
    } else {
      // コメントの判型表記（「B6判ビルド設定」等）とワークスペース名も揃える
      const after = tokens.result
        .replaceAll(`${from.secondary.label}判`, `${to.secondary.label}判`)
        .replace(
          `.vivliostyle-${from.secondary.token}`,
          `.vivliostyle-${to.secondary.token}`,
        );
      changes.push({
        path: from.secondary.config,
        kind: "delete",
        before: oldSecondary,
        after: null,
      });
      changes.push({
        path: to.secondary.config,
        kind: "add",
        before: null,
        after,
      });
    }
  } else {
    // 第2判型の設定がない（手で消した等）→ テンプレートから作る
    const base = template[to.secondary.config];
    if (base === undefined || slug === null) {
      problems.push({
        path: to.secondary.config,
        reason:
          "第2判型の設定ファイルを作れません（出力ファイル名を読み取れません）",
      });
    } else {
      changes.push({
        path: to.secondary.config,
        kind: "add",
        before: null,
        after: base.replaceAll("ryu-no-su", slug),
      });
    }
  }

  // ---- 判型テーマ・EPUBテーマ（移行先がなければテンプレートから追加。あれば前回の調整を保持）
  for (const theme of [to.primary.theme, to.secondary.theme, to.epub.theme]) {
    const path = themeFilePath(theme);
    if (files[path] !== undefined) continue;
    const content = template[path];
    if (content === undefined) {
      problems.push({ path, reason: "テンプレートにテーマがありません" });
    } else {
      changes.push({ path, kind: "add", before: null, after: content });
    }
  }

  // ---- EPUB 設定（変換できなければ EPUB だけスキップ。EPUB はオプション）
  const epub = files[EPUB_CONFIG];
  if (epub !== undefined) {
    const theme = extractThemePath(epub);
    const replaced =
      theme !== null &&
      normalizeRelPath(theme) === normalizeRelPath(from.epub.theme) &&
      extractStringValue(epub, "readingProgression") ===
        from.epub.readingProgression
        ? replaceValues(epub, [
            ["theme", to.epub.theme],
            ["readingProgression", to.epub.readingProgression],
          ])
        : null;
    if (replaced === null) {
      warnings.push(
        `${EPUB_CONFIG} は想定と違う構造のため書き換えません（EPUB は手動で切り替えてください）`,
      );
    } else {
      modify(EPUB_CONFIG, replaceCommentLabels(replaced, from, to));
    }
  }

  // ---- 入稿ビルドのワークフロー（トークン置換＋検証。全文一致は求めない）
  const workflow = files[WORKFLOW_PATH];
  if (workflow !== undefined) {
    const renamed = workflow.replaceAll(
      from.secondary.config,
      to.secondary.config,
    );
    const { result } = replaceSizeTokens(renamed, sizePairs);
    const after = replaceWorkflowLabels(result, from, to);
    // 置き換え残しの検査も、判型を表す文脈（出力名・設定ファイル名・判型表記）だけを見る
    const leftover =
      sizeTokenPattern(from.primary.token).test(after) ||
      sizeTokenPattern(from.secondary.token).test(after) ||
      after.includes(from.secondary.config) ||
      from.workflowLabels.flat().some((label) => after.includes(label));
    if (
      leftover ||
      !sizeTokenPattern(to.primary.token).test(after) ||
      !after.includes(to.secondary.config)
    ) {
      problems.push({
        path: WORKFLOW_PATH,
        reason: `判型（${from.primary.label}・${from.secondary.label}）の記述を想定どおりに置き換えられません`,
      });
    } else {
      modify(WORKFLOW_PATH, after);
    }
  }

  // ---- package.json（check:pages の出力名・theme-techbook の依存）と lock
  const pkgText = files[PACKAGE_JSON];
  if (pkgText !== undefined) {
    let pkg: {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } | null = null;
    try {
      pkg = JSON.parse(pkgText);
    } catch {
      problems.push({ path: PACKAGE_JSON, reason: "JSON として読めません" });
    }
    if (pkg) {
      const checkPages = pkg.scripts?.["check:pages"];
      if (pkg.scripts && checkPages !== undefined)
        pkg.scripts["check:pages"] = replaceSizeTokens(
          checkPages,
          sizePairs,
        ).result;

      // theme-techbook は横書きへの切替時に足すだけで、縦書きへ戻しても消さない（SPEC §10）
      const needsTechbook =
        params.to === "horizontal" &&
        pkg.devDependencies?.[TECHBOOK_PACKAGE] === undefined &&
        pkg.dependencies?.[TECHBOOK_PACKAGE] === undefined;
      if (needsTechbook) {
        const lockResult = addTechbookToLock(
          files[PACKAGE_LOCK],
          template[PACKAGE_LOCK],
        );
        if ("problem" in lockResult) {
          problems.push({ path: PACKAGE_LOCK, reason: lockResult.problem });
        } else {
          pkg.devDependencies = sortKeys({
            ...pkg.devDependencies,
            [TECHBOOK_PACKAGE]: lockResult.spec,
          });
          if (lockResult.lock !== null) modify(PACKAGE_LOCK, lockResult.lock);
        }
      }
      modify(PACKAGE_JSON, stringifyJsonLike(pkgText, pkg));
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, changes, warnings };
}

/**
 * package-lock.json に theme-techbook のエントリをテンプレートの lock からコピーする（SPEC §5.1）。
 * 依存（theme-base 等）のバージョンがリポジトリの lock と一致するときだけ行う（npm ci を壊さない）。
 * lock がないリポジトリは package.json だけを書き換える（lock: null）
 */
function addTechbookToLock(
  lockText: string | undefined,
  templateLockText: string | undefined,
): { spec: string; lock: string | null } | { problem: string } {
  type LockEntry = { version?: string; dependencies?: Record<string, string> };
  type Lock = {
    lockfileVersion?: number;
    packages?: Record<
      string,
      LockEntry & { devDependencies?: Record<string, string> }
    >;
  };
  let templateLock: Lock;
  try {
    templateLock = JSON.parse(templateLockText ?? "");
  } catch {
    return { problem: "テンプレートの package-lock.json を読めません" };
  }
  const entry = templateLock.packages?.[TECHBOOK_LOCK_KEY];
  const spec =
    templateLock.packages?.[""]?.devDependencies?.[TECHBOOK_PACKAGE] ?? null;
  if (!entry?.version || spec === null)
    return {
      problem:
        "テンプレートの package-lock.json に theme-techbook がありません",
    };
  if (lockText === undefined) return { spec, lock: null };

  let lock: Lock;
  try {
    lock = JSON.parse(lockText);
  } catch {
    return { problem: "JSON として読めません" };
  }
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""])
    return {
      problem:
        "lockfileVersion 3 ではないため自動で追記できません（`npm i -D @vivliostyle/theme-techbook` を実行してください）",
    };
  if (lock.packages[TECHBOOK_LOCK_KEY])
    return {
      problem:
        "theme-techbook が lock にだけあり package.json にありません（`npm i -D @vivliostyle/theme-techbook` で揃えてください）",
    };
  for (const [name, version] of Object.entries(entry.dependencies ?? {})) {
    if (lock.packages[`node_modules/${name}`]?.version !== version)
      return {
        problem: `${name} のバージョンがテンプレートと異なるため自動で追記できません（\`npm i -D @vivliostyle/theme-techbook\` を実行してください）`,
      };
  }
  const root = lock.packages[""];
  root.devDependencies = sortKeys({
    ...root.devDependencies,
    [TECHBOOK_PACKAGE]: spec,
  });
  // packages のキー順は npm の出力（ルート先頭・以降はパス順）に揃える
  const packages = Object.fromEntries(
    Object.entries({ ...lock.packages, [TECHBOOK_LOCK_KEY]: entry }).sort(
      ([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "en")),
    ),
  );
  return { spec, lock: stringifyJsonLike(lockText, { ...lock, packages }) };
}
