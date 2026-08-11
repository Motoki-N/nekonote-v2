import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { AppError } from "@/lib/errors";

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
