import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { AppError } from "@/lib/errors";
import {
  convertTypesettingStyle,
  type TypesettingStyle,
} from "@/lib/editor/typesetting-style";

// 原稿リポジトリテンプレートの読み込み＋作品情報への置換（SPEC-repo-setup §4.2）。
// 実体は docs/templates/manuscript-repo/（単一情報源。Vercel では next.config.ts の
// outputFileTracingIncludes でバンドルに含める）

const TEMPLATE_DIR = path.join(
  process.cwd(),
  "docs",
  "templates",
  "manuscript-repo",
);

// 検証用に画像をGit管理から外す設定。実作品では挿絵をGit管理するため展開しない（manual §8 手順3）
const EXCLUDED_PATHS = new Set(["images/.gitignore"]);

export type TemplateFile = {
  /** リポジトリルートからのパス（区切りは / ） */
  path: string;
  content: string;
};

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...(await listFilesRecursive(full)));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

/**
 * テンプレート全ファイルを読み、サンプルの作品情報を置換して返す。
 * テンプレート側がこの目印（竜の巣・灰谷 汀・ryu-no-su）を維持することが前提
 */
export async function loadManuscriptTemplate(params: {
  title: string;
  author: string;
  slug: string;
}): Promise<TemplateFile[]> {
  const files = await listFilesRecursive(TEMPLATE_DIR).catch(() => null);
  if (!files || files.length === 0) {
    throw new AppError("internal", "テンプレートの読み込みに失敗しました");
  }
  // 1パスで置換する（直列の replaceAll だと、置換後のタイトル等に別の目印が
  // 含まれる場合に再置換されてしまう）
  const replacements: Record<string, string> = {
    竜の巣: params.title,
    "灰谷 汀": params.author,
    "ryu-no-su": params.slug,
    "manuscript-repo-template": params.slug,
  };
  const marker = /竜の巣|灰谷 汀|ryu-no-su|manuscript-repo-template/g;
  const results: TemplateFile[] = [];
  for (const file of files) {
    const relPath = path.relative(TEMPLATE_DIR, file).split(path.sep).join("/");
    if (EXCLUDED_PATHS.has(relPath)) continue;
    const raw = await fs.readFile(file, "utf8");
    results.push({
      path: relPath,
      content: raw.replaceAll(marker, (m) => replacements[m]),
    });
  }
  return results.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

/**
 * テンプレートの指定ファイルを、作品情報を置換せずにそのまま読む（SPEC-horizontal-typesetting §5）。
 * 組版スタイルの切替で、移行先のテーマ等を既存リポジトリへ追加するときに使う。
 * パスはテンプレートルート起点で、呼び出し側が定数表から組み立てたものに限る。存在しないものは含めない
 */
export async function loadTemplateFiles(
  paths: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    paths.map(async (relPath) => {
      try {
        return [
          relPath,
          await fs.readFile(path.join(TEMPLATE_DIR, relPath), "utf8"),
        ] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

/**
 * 展開するテンプレート（縦書き）を指定の組版スタイルへ変換する（SPEC-horizontal-typesetting §5.2）。
 * 既存リポジトリの切替と同じ変換関数を通すことで、新規作成と切替の結果を一致させる
 */
export function applyTypesettingStyle(
  files: TemplateFile[],
  style: TypesettingStyle,
): TemplateFile[] {
  if (style === "vertical") return files;
  const current = Object.fromEntries(files.map((f) => [f.path, f.content]));
  const result = convertTypesettingStyle({
    files: current,
    template: current,
    from: "vertical",
    to: style,
  });
  // テンプレートは縦書き単一のため、変換できないのはテンプレート側の不整合
  if (!result.ok || result.warnings.length > 0) {
    console.error("テンプレートの組版スタイル変換に失敗:", result);
    throw new AppError(
      "internal",
      "テンプレートの組版スタイル変換に失敗しました",
    );
  }
  const next = { ...current };
  for (const change of result.changes) {
    if (change.kind === "delete") delete next[change.path];
    else next[change.path] = change.after ?? "";
  }
  return Object.entries(next)
    .map(([filePath, content]) => ({ path: filePath, content }))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
}
