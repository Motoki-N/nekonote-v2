import "server-only";

import type { ZennArticle } from "@/lib/schemas/zenn";

/**
 * Zenn記事ファイル（frontmatter＋本文）の合成（SPEC-zenn-integration §5）。
 * YAML 1.2 はJSONの上位集合なので、文字列・配列を JSON.stringify の
 * 二重引用符スカラー/フロー配列として出力すれば、コロン・引用符・絵文字・
 * バックスラッシュを含む値でも常に正しいYAMLになる（js-yaml等の依存は足さない）
 */
export function buildZennArticleFile(article: ZennArticle): string {
  return [
    "---",
    `title: ${JSON.stringify(article.title)}`,
    `emoji: ${JSON.stringify(article.emoji)}`,
    `type: ${JSON.stringify(article.type)}`,
    `topics: ${JSON.stringify(article.topics)}`,
    `published: ${article.published}`,
    "---",
    "",
    article.body,
  ].join("\n");
}
