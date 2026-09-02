"use server";

import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import {
  KUMI_VAR_NAMES,
  NOMBRE_SLOTS,
  NOMBRE_VAR_NAMES,
  buildNombreVars,
  extractCssVar,
  extractEntryPaths,
  extractStringValue,
  extractThemePath,
  joinRepoPath,
  parseEntryItems,
  parseNombreSettings,
  replaceCssVar,
  replaceEntryItems,
  replaceStringValue,
} from "@/lib/editor/book-config";
import type {
  EntryItem,
  KumiVarName,
  NombreSettings,
  NombreVarName,
  ThemeVarName,
} from "@/lib/editor/book-config";
import {
  OKUZUKE_LABELS,
  parseOkuzuke,
  replaceOkuzuke,
} from "@/lib/editor/okuzuke";
import type { OkuzukeData } from "@/lib/editor/okuzuke";
import { getFileContent, putFileContent } from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  blobShaSchema,
  branchNameSchema,
  parseBranch,
  loadEditorContext,
  validateChapterPath,
  listChapters,
} from "./context";

export type ThemeSettings = {
  /** 判型ラベル（設定ファイル名から。book.config.js=既定・book.config.b6.js=B6） */
  label: string;
  /** リポジトリルートからのCSSパス */
  cssPath: string;
  sha: string;
  /** 組み設定変数の現在値（見つからない変数は null＝そのフィールドは読み取り専用） */
  vars: Record<KumiVarName, string | null>;
  /**
   * ノンブル・柱の現在の設定（Issue #237）。
   * null = 変数がない、または手書きでカスタムされた値＝この区画は読み取り専用
   */
  nombre: NombreSettings | null;
};

export type BookSettingsData = {
  /** book.config.js。null = ファイルなし（フォーム全体を案内表示にする） */
  config: {
    path: string;
    sha: string;
    title: string | null;
    author: string | null;
    /** null = entry を解析できない（章順は読み取り専用） */
    entryItems: EntryItem[] | null;
  } | null;
  themes: ThemeSettings[];
  /** テンプレート構造を検出できた奥付章。null = フォーム化しない（直接編集を案内） */
  okuzuke: { path: string; sha: string; data: OkuzukeData } | null;
  /** entry へ追加できる章の候補（config 起点の相対パス・entry 未登録のもの） */
  entryCandidates: string[];
};

// entry の文字列要素（章パス）として受け付ける形（引用符付き・.md・トラバーサル拒否）
const ENTRY_LITERAL = /^(['"])(?!.*\.\.)[^'"`\\\n]+\.md\1$/;

/** 設定フォームの初期データ（config・テーマCSS・奥付をまとめて取得） */
export async function getBookSettings(
  projectId: string,
  branch?: string,
): Promise<ActionResult<BookSettingsData>> {
  try {
    const ctx = await loadEditorContext(projectId);
    const ref = parseBranch(branch);

    // book.config.js（なければフォームは案内表示のみ）
    const configPath = joinRepoPath(ctx.basePath, "book.config.js");
    let config: BookSettingsData["config"] = null;
    let configContent: string | null = null;
    if (configPath) {
      try {
        const file = await getFileContent(ctx.token, ctx.repo, configPath, ref);
        configContent = file.content;
        config = {
          path: configPath,
          sha: file.sha,
          title: extractStringValue(file.content, "title"),
          author: extractStringValue(file.content, "author"),
          entryItems: parseEntryItems(file.content),
        };
      } catch {
        config = null;
      }
    }

    // テーマCSS（既定＋B6。リポジトリ外を指すテーマは対象外）
    const themes: ThemeSettings[] = [];
    const themeSources: { label: string; content: string | null }[] = [
      { label: "既定（A6）", content: configContent },
    ];
    const b6Path = joinRepoPath(ctx.basePath, "book.config.b6.js");
    if (b6Path) {
      try {
        const b6 = await getFileContent(ctx.token, ctx.repo, b6Path, ref);
        themeSources.push({ label: "B6", content: b6.content });
      } catch {
        // B6設定はオプション
      }
    }
    for (const source of themeSources) {
      if (!source.content) continue;
      const themePath = extractThemePath(source.content);
      if (!themePath || !themePath.endsWith(".css")) continue;
      const cssPath = joinRepoPath(ctx.basePath, themePath);
      if (!cssPath) continue;
      if (themes.some((theme) => theme.cssPath === cssPath)) continue;
      try {
        const css = await getFileContent(ctx.token, ctx.repo, cssPath, ref);
        const vars = Object.fromEntries(
          KUMI_VAR_NAMES.map((name) => [
            name,
            extractCssVar(css.content, name),
          ]),
        ) as Record<KumiVarName, string | null>;
        const nombreVars = Object.fromEntries(
          NOMBRE_VAR_NAMES.map((name) => [
            name,
            extractCssVar(css.content, name),
          ]),
        ) as Record<NombreVarName, string | null>;
        themes.push({
          label: source.label,
          cssPath,
          sha: css.sha,
          vars,
          nombre: parseNombreSettings(nombreVars),
        });
      } catch {
        // テーマがnpmパッケージ等リポジトリ外の場合は組み設定フォームの対象外
      }
    }

    // 奥付（ファイル名の慣習 *okuzuke*.md で検出。SPEC-phase3 §7-4 のフェイルソフト）
    let okuzuke: BookSettingsData["okuzuke"] = null;
    const { chapters } = await listChapters(ctx, ref);
    const okuzukePath = chapters.find((chapter) =>
      /okuzuke[^/]*\.md$/i.test(chapter.path),
    )?.path;
    if (okuzukePath) {
      try {
        const file = await getFileContent(
          ctx.token,
          ctx.repo,
          okuzukePath,
          ref,
        );
        const data = parseOkuzuke(file.content);
        if (data) okuzuke = { path: okuzukePath, sha: file.sha, data };
      } catch {
        okuzuke = null;
      }
    }

    // entry 追加候補（entry 未登録の章。config 起点の相対パスで返す）
    const prefix = ctx.basePath === "" ? "" : `${ctx.basePath}/`;
    const registered = new Set(
      (config?.entryItems ?? []).flatMap((item) =>
        item.path ? [item.path] : [],
      ),
    );
    const entryCandidates = chapters
      .map((chapter) => chapter.path.slice(prefix.length))
      .filter((relPath) => !registered.has(relPath));

    return { ok: true, data: { config, themes, okuzuke, entryCandidates } };
  } catch (error) {
    return toActionError(error);
  }
}

const biblioValueSchema = z
  .string()
  .trim()
  .min(1, "値を入力してください")
  .max(100, "100字以内で入力してください")
  .refine((value) => !/['"`\n\\]/.test(value), {
    error: "引用符・改行は使えません",
  });

const saveBookConfigSchema = z.object({
  baseSha: blobShaSchema,
  title: biblioValueSchema.nullable(),
  author: biblioValueSchema.nullable(),
  /** null = entry は変更しない */
  entryRawItems: z.array(z.string().max(200)).max(200).nullable(),
  /** コミット先ブランチ（省略時はデフォルト。SPEC-phase5 §3.4） */
  branch: branchNameSchema.optional(),
});

/**
 * book.config.js の書誌・entry を書き換えてコミットする（SPEC-phase3 §7-1・7-2）。
 * 正規表現置換→抽出関数での検証→楽観ロック付きコミット。
 * entry の非文字列要素（目次差し込み等）は既存要素の並べ替えのみ許可（新規は受け付けない）
 */
export async function saveBookConfig(
  projectId: string,
  params: z.infer<typeof saveBookConfigSchema>,
): Promise<ActionResult<{ blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const { baseSha, title, author, entryRawItems, branch } =
      saveBookConfigSchema.parse(params);

    const configPath = joinRepoPath(ctx.basePath, "book.config.js");
    if (!configPath)
      throw new AppError("validation", "設定ファイルのパスが不正です");
    const current = await getFileContent(
      ctx.token,
      ctx.repo,
      configPath,
      branch,
    );
    if (current.sha !== baseSha) {
      throw new AppError(
        "conflict",
        "設定がリモートで更新されています。開き直してください",
      );
    }

    let updated = current.content;
    if (title !== null) {
      const replaced = replaceStringValue(updated, "title", title);
      if (!replaced)
        throw new AppError(
          "validation",
          "title の書き換えに対応できない構造です",
        );
      updated = replaced;
    }
    if (author !== null) {
      const replaced = replaceStringValue(updated, "author", author);
      if (!replaced)
        throw new AppError(
          "validation",
          "author の書き換えに対応できない構造です",
        );
      updated = replaced;
    }
    if (entryRawItems !== null) {
      const currentItems = parseEntryItems(current.content);
      if (!currentItems) {
        throw new AppError(
          "validation",
          "entry の書き換えに対応できない構造です",
        );
      }
      // 非文字列要素は「既存にあるものだけ・重複なし」を許可（クライアント由来のJS断片を混ぜない）
      const currentNonLiterals = currentItems
        .filter((item) => item.path === null)
        .map((item) => item.raw);
      for (const raw of entryRawItems) {
        if (ENTRY_LITERAL.test(raw)) {
          const path = raw.slice(1, -1);
          if (!joinRepoPath(ctx.basePath, path)) {
            throw new AppError("validation", `entry のパスが不正です: ${path}`);
          }
          continue;
        }
        const index = currentNonLiterals.indexOf(raw);
        if (index === -1) {
          throw new AppError(
            "validation",
            "entry に追加できない要素が含まれています",
          );
        }
        currentNonLiterals.splice(index, 1);
      }
      const replaced = replaceEntryItems(updated, entryRawItems);
      if (!replaced)
        throw new AppError(
          "validation",
          "entry の書き換えに対応できない構造です",
        );
      updated = replaced;
    }

    // 置換後の検証: 読み取り側と同じ抽出関数で期待値が読めること（SPEC-phase3 §7）
    if (title !== null && extractStringValue(updated, "title") !== title) {
      throw new AppError(
        "validation",
        "title の書き換え結果を検証できませんでした",
      );
    }
    if (author !== null && extractStringValue(updated, "author") !== author) {
      throw new AppError(
        "validation",
        "author の書き換え結果を検証できませんでした",
      );
    }
    if (entryRawItems !== null) {
      const expected = entryRawItems
        .filter((raw) => ENTRY_LITERAL.test(raw))
        .map((raw) => raw.slice(1, -1));
      const actual = extractEntryPaths(updated);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new AppError(
          "validation",
          "entry の書き換え結果を検証できませんでした",
        );
      }
    }

    const result = await putFileContent(ctx.token, ctx.repo, configPath, {
      content: updated,
      sha: baseSha,
      message: "設定: 書誌情報・章構成を更新（ネコノテAI 縦書きエディタ）",
      branch,
    });
    return { ok: true, data: { blobSha: result.blobSha } };
  } catch (error) {
    return toActionError(error);
  }
}

const kumiVarsSchema = z.object({
  fontSizePercent: z.number().min(30).max(200).nullable(),
  lineHeight: z.number().min(1).max(3).nullable(),
  lines: z.number().int().min(5).max(50).nullable(),
  charsPerLine: z.number().int().min(10).max(80).nullable(),
});

const saveThemeVarsSchema = z.object({
  cssPath: z.string().max(300),
  baseSha: blobShaSchema,
  vars: kumiVarsSchema,
  /** コミット先ブランチ（省略時はデフォルト。SPEC-phase5 §3.4） */
  branch: branchNameSchema.optional(),
});

/**
 * テーマCSSの :root 変数を置換してコミットする（組み設定とノンブル設定で共用）。
 * 対象CSSを config の theme が指すものに限定し、置換後に抽出し直して検証する
 */
async function commitThemeVars(
  ctx: Awaited<ReturnType<typeof loadEditorContext>>,
  params: {
    cssPath: string;
    baseSha: string;
    branch: string | undefined;
    replacements: [ThemeVarName, string][];
    message: string;
  },
): Promise<{ blobSha: string }> {
  const { cssPath, baseSha, branch, replacements, message } = params;

  // 対象CSSは config の theme が指すものに限定（任意パス書き換えの防止）
  const allowed = new Set<string>();
  for (const configName of ["book.config.js", "book.config.b6.js"]) {
    const path = joinRepoPath(ctx.basePath, configName);
    if (!path) continue;
    try {
      const config = await getFileContent(ctx.token, ctx.repo, path, branch);
      const themePath = extractThemePath(config.content);
      if (themePath) {
        const resolved = joinRepoPath(ctx.basePath, themePath);
        if (resolved && resolved.endsWith(".css")) allowed.add(resolved);
      }
    } catch {
      // 設定ファイルがないものはスキップ
    }
  }
  if (!allowed.has(cssPath)) {
    throw new AppError(
      "validation",
      "対象のテーマCSSが設定ファイルから参照されていません",
    );
  }

  const current = await getFileContent(ctx.token, ctx.repo, cssPath, branch);
  if (current.sha !== baseSha) {
    throw new AppError(
      "conflict",
      "テーマがリモートで更新されています。開き直してください",
    );
  }

  if (replacements.length === 0)
    throw new AppError("validation", "変更する値がありません");

  let updated = current.content;
  for (const [name, value] of replacements) {
    const replaced = replaceCssVar(updated, name, value);
    if (!replaced) {
      throw new AppError(
        "validation",
        `テーマCSSに ${name} が見つかりません（直接編集してください）`,
      );
    }
    updated = replaced;
  }
  for (const [name, value] of replacements) {
    if (extractCssVar(updated, name) !== value) {
      throw new AppError(
        "validation",
        "テーマCSSの書き換え結果を検証できませんでした",
      );
    }
  }

  return putFileContent(ctx.token, ctx.repo, cssPath, {
    content: updated,
    sha: baseSha,
    message,
    branch,
  });
}

/** 組み設定（テーマCSSの :root 変数）を書き換えてコミットする（SPEC-phase3 §7-3） */
export async function saveThemeVars(
  projectId: string,
  params: z.infer<typeof saveThemeVarsSchema>,
): Promise<ActionResult<{ blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const { cssPath, baseSha, vars, branch } =
      saveThemeVarsSchema.parse(params);

    const replacements: [ThemeVarName, string][] = [];
    if (vars.fontSizePercent !== null) {
      replacements.push([
        "--vs-font-size-on-print",
        `${vars.fontSizePercent}%`,
      ]);
    }
    if (vars.lineHeight !== null)
      replacements.push(["--vs-line-height", String(vars.lineHeight)]);
    if (vars.lines !== null)
      replacements.push(["--vs-theme--num-of-line", String(vars.lines)]);
    if (vars.charsPerLine !== null) {
      replacements.push([
        "--vs-theme--num-of-character",
        String(vars.charsPerLine),
      ]);
    }

    const result = await commitThemeVars(ctx, {
      cssPath,
      baseSha,
      branch,
      replacements,
      message: "設定: 組み設定（版面）を更新（ネコノテAI 縦書きエディタ）",
    });
    return { ok: true, data: { blobSha: result.blobSha } };
  } catch (error) {
    return toActionError(error);
  }
}

const saveNombreVarsSchema = z.object({
  cssPath: z.string().max(300),
  baseSha: blobShaSchema,
  settings: z.object({
    page: z.enum(NOMBRE_SLOTS),
    title: z.enum(NOMBRE_SLOTS),
  }),
  /** コミット先ブランチ（省略時はデフォルト。SPEC-phase5 §3.4） */
  branch: branchNameSchema.optional(),
});

/**
 * ノンブル・柱の設定（テーマCSSのスロット変数）を書き換えてコミットする
 * （SPEC-phase3 §7-5。Issue #237）。書き込む値は `buildNombreVars` が組み立てたものだけ
 */
export async function saveNombreVars(
  projectId: string,
  params: z.infer<typeof saveNombreVarsSchema>,
): Promise<ActionResult<{ blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const { cssPath, baseSha, settings, branch } =
      saveNombreVarsSchema.parse(params);

    const replacements = Object.entries(buildNombreVars(settings)) as [
      ThemeVarName,
      string,
    ][];
    const result = await commitThemeVars(ctx, {
      cssPath,
      baseSha,
      branch,
      replacements,
      message: "設定: ノンブル・柱を更新（ネコノテAI 縦書きエディタ）",
    });
    return { ok: true, data: { blobSha: result.blobSha } };
  } catch (error) {
    return toActionError(error);
  }
}

const okuzukeFieldSchema = z.object({
  label: z.enum(OKUZUKE_LABELS),
  value: z
    .string()
    .trim()
    .max(100, "100字以内で入力してください")
    .refine((value) => !/[<>&\n]/.test(value), {
      error: "タグ文字（< > &）は使えません",
    }),
});

const saveOkuzukeSchema = z.object({
  path: z.string().max(300),
  baseSha: blobShaSchema,
  /** コミット先ブランチ（省略時はデフォルト。SPEC-phase5 §3.4） */
  branch: branchNameSchema.optional(),
  dateText: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .refine((value) => !/[<>&\n]/.test(value), {
      error: "タグ文字（< > &）は使えません",
    })
    .nullable(),
  fields: z.array(okuzukeFieldSchema).max(OKUZUKE_LABELS.length),
});

/** 奥付章のテンプレート項目を書き換えてコミットする（SPEC-phase3 §7-4） */
export async function saveOkuzuke(
  projectId: string,
  params: z.infer<typeof saveOkuzukeSchema>,
): Promise<ActionResult<{ blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const {
      path: rawPath,
      baseSha,
      branch,
      dateText,
      fields,
    } = saveOkuzukeSchema.parse(params);
    const path = validateChapterPath(ctx.basePath, rawPath);

    const current = await getFileContent(ctx.token, ctx.repo, path, branch);
    if (current.sha !== baseSha) {
      throw new AppError(
        "conflict",
        "奥付がリモートで更新されています。開き直してください",
      );
    }
    if (!parseOkuzuke(current.content)) {
      throw new AppError(
        "validation",
        "奥付のテンプレート構造を検出できません（直接編集してください）",
      );
    }

    const updated = replaceOkuzuke(current.content, { dateText, fields });
    if (!updated)
      throw new AppError("validation", "奥付の書き換えに対応できない構造です");
    const verify = parseOkuzuke(updated);
    if (
      !verify ||
      fields.some(
        (field) =>
          verify.fields.find((v) => v.label === field.label)?.value !==
          field.value,
      ) ||
      (dateText !== null && verify.dateText !== dateText)
    ) {
      throw new AppError(
        "validation",
        "奥付の書き換え結果を検証できませんでした",
      );
    }

    const result = await putFileContent(ctx.token, ctx.repo, path, {
      content: updated,
      sha: baseSha,
      message: "設定: 奥付を更新（ネコノテAI 縦書きエディタ）",
      branch,
    });
    return { ok: true, data: { blobSha: result.blobSha } };
  } catch (error) {
    return toActionError(error);
  }
}
