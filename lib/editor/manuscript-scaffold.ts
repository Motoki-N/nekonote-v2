// 原稿ファイルの雛形（SPEC-manuscript-bridge §5.2）。
// 縦書きエディタの新規章作成（lib/actions/editor/chapters.ts）とボードからの一括生成
// （lib/actions/manuscript-generate.ts）で共用する。
// "use server" ファイルは async 関数しか export できないため、純関数はこの層に置く

/** 章扉の既定タイトル（createChapter の従来文言。ファイル名だけ決めて作る経路で使う） */
export const DEFAULT_CHAPTER_TITLE = "新しい章";

/** タイトルが空のときの表示名（シーンの雛形コメント用） */
const UNTITLED = "（無題）";

// YAML のプレーンスカラーとして書けない文字（引用が要る）。先頭の `-` `?` も指示子扱いになる
const YAML_UNSAFE = /[:#"'\\[\]{},&*!|>%@`]/;

/**
 * frontmatter の値として書ける形に整える。
 * そのまま書ける文字列は引用符を付けない（既存 createChapter の出力をバイト単位で維持する）
 */
function toYamlValue(value: string): string {
  if (!YAML_UNSAFE.test(value) && !/^[-?]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * 新規章ファイルの雛形（SPEC-vertical-editor-phase2 §3.3。frontmatter ＋ `# 章タイトル`）。
 * タイトル未指定・空文字は従来どおり既定文言にする（createChapter の外部挙動を変えない）
 */
export function chapterScaffold(title?: string): string {
  const trimmed = (title ?? "").replace(/[\r\n]+/g, " ").trim();
  const heading = trimmed === "" ? DEFAULT_CHAPTER_TITLE : trimmed;
  return `---
title: ${toYamlValue(heading)}
---

# ${heading}

`;
}

/**
 * シーンファイルの雛形（SPEC-manuscript-bridge §5.2）。
 * VFM のコメント1行＋空行だけ——コメントは組版・入稿PDFに出ず、エディタのコメント一覧
 * （SPEC-vertical-editor-phase3 §3）に並んで執筆中の目印になる。
 * `<` `>` を落とすのは、タイトルに `-->` が含まれてもコメントが途中で閉じないようにするため
 */
export function sceneScaffold(title: string, sceneNumber: number): string {
  const label = title
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
  return `<!-- ${label === "" ? UNTITLED : label}（${sceneNumber}） -->

`;
}
