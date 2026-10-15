import { stringify } from "@vivliostyle/vfm";

// 組版プレビューのHTML生成（SPEC-vertical-editor-phase2 §5）。
// 編集中テキストの組版はブラウザ内で完結させる（VFM変換→テーマCSS注入→Blob URL→Viewer）。
// 書字方向（縦書き/横書き）はテーマCSS由来であり、プレビューはテーマに追従する（Issue #97）。
// このモジュールはクライアントで実行される純関数のみを置く

export type PreviewChapter = {
  /** リポジトリルート（base_path）からのパス。画像相対パスの解決基準になる */
  path: string;
  content: string;
};

/** テーマの書字方向。縦書き専用UI（傍点・縦中横）の出し分けに使う（Issue #97） */
export type WritingDirection = "vertical" | "horizontal";

/** テーマCSSの取得結果（サーバー側で @import 解決済み。lib/actions/editor.ts が組み立てる） */
export type ThemeAssets = {
  /** アプリがホストする組版CSSのパス（/vivliostyle/themes/...）。<link> として注入する */
  stylesheetPaths: string[];
  /** リポジトリ由来のCSS（判型・パーツ定義）。<style> として注入する */
  inlineCss: string;
  /** テーマの書字方向（対応表メタ情報またはCSS検出による判定） */
  direction: WritingDirection;
};

/** 全体プレビューの目次の元情報（サーバーが book.config.js から組み立てる。SPEC-toc-settings §7） */
export type PreviewTocSource = {
  /** 差し込む位置（全体プレビューの章配列のインデックス。この章の直前に入る） */
  position: number;
  /** 目次の見出し（toc.title） */
  title: string;
  /** 載せる見出しの深さ（toc.sectionDepth） */
  depth: number;
  /** 書名（CLI が目次ページの先頭に h1 で出す） */
  bookTitle: string;
  /** entry に載っている章のパス（リポジトリルートから。entry 順） */
  entryPaths: string[];
};

/** buildPreviewHtml に渡す目次（PreviewTocSource から外した章を除いたもの） */
export type PreviewToc = Omit<PreviewTocSource, "entryPaths"> & {
  /** 目次に載せる章のパス（リポジトリルートから） */
  listedPaths: string[];
};

/** 先頭のYAMLフロントマターから `class:` を取り出す（扉・奥付の body クラス。VFM仕様準拠の簡易版） */
export function extractBodyClass(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const line = match[1].match(/^class:\s*(.+)$/m);
  if (!line) return null;
  const value = line[1].trim().replace(/^['"]|['"]$/g, "");
  // クラス名として妥当なもののみ（HTML属性へ埋め込むため英数とハイフン等に限定）
  return /^[\w][\w\s-]*$/.test(value) ? value : null;
}

/**
 * 章の見出しを取り出す（フロントマターの `title:` → 先頭の H1 の順。VFM の `<title>` と同じ規則）。
 * 柱（`env(doc-title)`）が参照するため、プレビューでも入稿ビルドと同じ文字列を出すのに使う（Issue #237）
 */
export function extractChapterTitle(markdown: string): string | null {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter) {
    const line = frontmatter[1].match(/^title:\s*(.+)$/m);
    if (line) {
      const value = line[1].trim().replace(/^['"]|['"]$/g, "");
      if (value !== "") return value;
    }
  }
  const body = frontmatter ? markdown.slice(frontmatter[0].length) : markdown;
  // コードブロック内の `# ...` は見出しではない（VFM も拾わない）
  const withoutFences = body.replace(/^```[\s\S]*?^```[^\n]*$/gm, "");
  const heading = withoutFences.match(/^#\s+(.+)$/m);
  if (!heading) return null;
  // VFM の <title> はテキストのみになるため、強調・コードのマーカーを落とす。
  // ルビ `{親文字|るび}` も親文字だけにする（<title> にルビは入らない。目次の項目名にも使う。Issue #307）
  const text = heading[1]
    .replace(/\{([^{}|]+)\|[^{}]*\}/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
  return text === "" ? null : text;
}

/**
 * 章ファイルからの相対パスをリポジトリルート基準に正規化する。
 * ルート外へ出るパス（`..` が残る）は null
 */
export function resolveRepoPath(
  chapterPath: string,
  relativeSrc: string,
): string | null {
  const dir = chapterPath.split("/").slice(0, -1);
  const parts = [...dir, ...relativeSrc.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join("/");
}

/**
 * VFM変換後HTMLの <img src> を認証プロキシURLへ書き換える（§5.3）。
 * PATがないブラウザからはリポジトリの画像を直接取得できないため。
 * http(s)/data はそのまま、解決できない相対パスもそのまま残す（Viewer側で自然に404になる）
 */
function rewriteImageSrc(
  html: string,
  chapterPath: string,
  assetUrl: (repoPath: string) => string,
): string {
  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)(")/g,
    (whole, before: string, src: string, after: string) => {
      if (/^(?:https?:|data:|blob:)/.test(src)) return whole;
      const repoPath = resolveRepoPath(chapterPath, src);
      if (!repoPath) return whole;
      return `${before}${escapeHtmlAttr(assetUrl(repoPath))}${after}`;
    },
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** 全体プレビューで再現する目次ページのセクションのクラス（改ページのシムが参照する） */
const TOC_SECTION_CLASS = "nekonote-toc-preview";

/**
 * 章のHTML断片の id と、それを参照する章内リンク（`href="#..."`・aria の id 参照）に
 * 接頭辞を付ける。章をまたいだ参照は本ビルドでも別文書なので、章内だけで閉じればよい
 */
function scopeIds(html: string, prefix: string): string {
  return html
    .replace(
      /(\s)id="([^"]*)"/g,
      (_whole, space: string, id: string) => `${space}id="${prefix}${id}"`,
    )
    .replace(
      /(\shref=")#([^"]*)"/g,
      (_whole, head: string, id: string) => `${head}#${prefix}${id}"`,
    )
    .replace(
      /(\saria-(?:labelledby|describedby)=")([^"]*)"/g,
      (_whole, head: string, ids: string) =>
        `${head}${ids
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => `${prefix}${id}`)
          .join(" ")}"`,
    );
}

/**
 * 章の先頭要素の id を返す（なければ付ける）。目次の「章」項目のリンク先にする。
 * 本ビルドでは章ファイルへのリンク＝章の先頭ページなので、それに合わせる
 */
function ensureChapterAnchor(
  fragment: string,
  fallbackId: string,
): { html: string; id: string } {
  const match = /^(\s*(?:<!--[\s\S]*?-->\s*)*)<([a-zA-Z][\w-]*)([^>]*)>/.exec(
    fragment,
  );
  if (!match) {
    // 要素がない（空の章）: 空の要素を置いてリンク先にする
    return {
      html: `<div id="${fallbackId}"></div>${fragment}`,
      id: fallbackId,
    };
  }
  const existing = /\sid="([^"]*)"/.exec(match[3]);
  if (existing) return { html: fragment, id: existing[1] };
  const [whole, lead, tag, attrs] = match;
  return {
    html: `${lead}<${tag} id="${fallbackId}"${attrs}>${fragment.slice(whole.length)}`,
    id: fallbackId,
  };
}

type TocHeading = {
  level: number;
  id: string | null;
  html: string;
  children: TocHeading[];
};

/** 章のHTMLから見出しを取り出し、CLI と同じ規則で入れ子にする（blockquote 内は除く） */
function collectHeadings(fragment: string): TocHeading[] {
  const withoutQuotes = fragment.replace(
    /<blockquote\b[\s\S]*?<\/blockquote>/g,
    "",
  );
  const flat = [
    ...withoutQuotes.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g),
  ].map((match) => ({
    level: Number(match[1]),
    id: /\sid="([^"]*)"/.exec(match[2])?.[1] ?? null,
    html: match[3],
  }));
  const traverse = (heads: typeof flat): TocHeading[] => {
    if (heads.length === 0) return [];
    const [head, ...tail] = heads;
    let next = tail.findIndex((h) => h.level <= head.level);
    if (next === -1) next = tail.length;
    return [
      { ...head, children: traverse(tail.slice(0, next)) },
      ...traverse(tail.slice(next)),
    ];
  };
  return traverse(flat);
}

/** 見出しの入れ子を `<ol>` にする（深さを超える見出しは載せない＝CLI の sectionDepth と同じ） */
function renderSectionList(sections: TocHeading[], depth: number): string {
  const nodes = sections.filter((section) => section.level <= depth);
  if (nodes.length === 0) return "";
  const items = nodes.map((node) => {
    // id のない見出しはリンクにしない（CLI と同じ。テーマの目次ブロックが隠す）
    const label = node.id
      ? `<a href="#${escapeHtmlAttr(node.id)}">${node.html}</a>`
      : `<span>${node.html}</span>`;
    return `<li data-section-level="${node.level}">${label}${renderSectionList(node.children, depth)}</li>`;
  });
  return `<ol>${items.join("")}</ol>`;
}

/**
 * 目次ページのセクションを組み立てる（SPEC-toc-settings §7）。構造は CLI が生成する目次文書
 * （`<h1>書名</h1><nav id="toc" role="doc-toc"><h2>見出し</h2><ol>…`）と同じにし、
 * テーマの目次スタイルと目次ブロックがそのまま当たるようにする。
 * ページ番号はテーマの target-counter() が同じ文書内のリンク先から引く。
 * 章の先頭にリンク先の id を付けるため、sections（章のHTML）を書き換える
 */
function buildTocSection(
  chapters: PreviewChapter[],
  sections: string[],
  toc: PreviewToc,
): string {
  const listed = new Set(toc.listedPaths);
  const items: string[] = [];
  chapters.forEach((chapter, index) => {
    if (!listed.has(chapter.path)) return;
    const anchor = ensureChapterAnchor(sections[index], `c${index}-chapter`);
    sections[index] = anchor.html;
    const headings = toc.depth >= 1 ? collectHeadings(anchor.html) : [];
    const children = renderSectionList(headings, toc.depth);
    // 章に H1 が1つだけなら、章の項目をその H1 の項目に置き換える（CLI と同じ）
    if (headings.length === 1 && headings[0].level === 1) {
      items.push(children.replace(/^<ol>|<\/ol>$/g, ""));
      return;
    }
    const chapterTitle =
      extractChapterTitle(chapter.content) ??
      (chapter.path.split("/").pop() ?? chapter.path).replace(/\.md$/, "");
    items.push(
      `<li><a href="#${escapeHtmlAttr(anchor.id)}">${escapeHtml(chapterTitle)}</a>${children}</li>`,
    );
  });
  return `<section class="${TOC_SECTION_CLASS}">
<h1>${escapeHtml(toc.bookTitle)}</h1>
<nav id="toc" role="doc-toc"><h2>${escapeHtml(toc.title)}</h2><ol>${items.join("")}</ol></nav>
</section>`;
}

/**
 * 章群を組版用の単一HTMLへ変換する。
 * - 1章のみ: フロントマターの `class:` を body へ反映（扉・奥付の専用様式が当たる）
 * - 複数章（全体プレビュー）: 章ごとに独立ドキュメントになる本ビルドとの差を
 *   「章境の改ページ」シムで補う。body クラス依存の様式（扉・奥付）は当たらない（UIで注記）
 */
export function buildPreviewHtml(params: {
  chapters: PreviewChapter[];
  theme: ThemeAssets;
  title: string;
  /** アプリのオリジン（Blob URL文書内では相対URLが解決できないため絶対URLにする） */
  origin: string;
  assetUrl: (repoPath: string) => string;
  /** 全体プレビューに差し込む目次（SPEC-toc-settings §7）。なければ目次ページを作らない */
  toc?: PreviewToc | null;
}): string {
  const { chapters, theme, title, origin, assetUrl, toc } = params;
  const isSingle = chapters.length === 1;

  const sections = chapters.map((chapter, index) => {
    const fragment = rewriteImageSrc(
      stringify(chapter.content, { partial: true }),
      chapter.path,
      assetUrl,
    );
    // 全体プレビューは全章を1つのHTMLにするため、章ごとに id を区別する
    // （同名の見出し・脚注番号の衝突を避け、目次のリンク先を一意にする）
    return isSingle ? fragment : scopeIds(fragment, `c${index}-`);
  });
  if (!isSingle && toc) {
    const tocSection = buildTocSection(chapters, sections, toc);
    sections.splice(
      Math.min(Math.max(0, toc.position), sections.length),
      0,
      tocSection,
    );
  }

  const bodyClass = isSingle ? extractBodyClass(chapters[0].content) : null;
  // リポジトリ由来のCSSが </style> で <style> を破ってタグ注入するのを防ぐ
  // （security-review M-2。`<\/` はCSS文字列としては等価なエスケープ）
  const safeInlineCss = theme.inlineCss.replace(/<\/(style)/gi, "<\\/$1");
  const links = theme.stylesheetPaths
    .map(
      (path) =>
        `<link rel="stylesheet" href="${escapeHtmlAttr(`${origin}${path}`)}">`,
    )
    .join("\n");
  // 本ビルドでは entry の各mdが独立ドキュメント＝章境が必ず改ページになる。単一HTML化した
  // 全体プレビューでも同じページ割りになるようにする（テーマ本体には手を入れない）
  const multiChapterShim = isSingle
    ? ""
    : `<style>body > section.level1, body > section.${TOC_SECTION_CLASS} { break-before: page; }</style>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${links}
<style>
${safeInlineCss}
</style>
${multiChapterShim}
</head>
<body${bodyClass ? ` class="${escapeHtmlAttr(bodyClass)}"` : ""}>
${sections.join("\n")}
</body>
</html>
`;
}

/**
 * 自前ホストの Vivliostyle Viewer でBlob URLの文書を開くURL（§5.1）。
 * `#src=` はエンコードしない——Viewerはハッシュを復号せずに解決するため、
 * エンコードすると相対パス扱いになり404になる（スパイクで実地確認）。
 * Blob URLは `&`/`#` を含まないのでそのまま連結して安全。
 *
 * `fragment` は Viewer が現在位置として自身のハッシュに書き出す EPUB CFI（`f=` パラメータ）。
 * 再組版でViewerを読み込み直しても表示位置を保つために引き継ぐ（Issue #256）
 */
export function viewerUrl(
  documentUrl: string,
  fragment?: string | null,
): string {
  const base = `/vivliostyle/viewer/index.html#src=${documentUrl}&bookMode=false&renderAllPages=true`;
  // Viewer が書き出した値をそのまま渡す（Viewer側でエンコード済み）。想定外の文字列で
  // ハッシュを壊さないよう、CFIの書式に合うものだけを通す
  return fragment && isViewerFragment(fragment)
    ? `${base}&f=${fragment}`
    : base;
}

/** `f=` の値が EPUB CFI として妥当か（`&`/`#` はハッシュの区切りなので許さない） */
function isViewerFragment(fragment: string): boolean {
  return /^epubcfi\([^\s&#]*\)$/.test(fragment);
}

/**
 * Viewer のハッシュ（`#src=...&f=epubcfi(...)`）から現在の表示位置を取り出す。
 * Viewer はページ移動のたびに `f=` を書き換えるため、これが「いま見ているところ」になる
 */
export function fragmentFromViewerHash(hash: string): string | null {
  const match = hash.match(/[#&]f=([^&]*)/);
  if (!match) return null;
  return isViewerFragment(match[1]) ? match[1] : null;
}
