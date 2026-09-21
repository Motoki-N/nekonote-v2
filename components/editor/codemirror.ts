import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
} from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  placeholder,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// 入力ペイン（CodeMirror 6）の共通セットアップ（SPEC-vertical-editor-phase2 §4）。
// 横書きプレーンテキスト＋Markdownハイライトを土台に、VFM固有記法（ルビ）を装飾で重ねる。
// 色はテーマ用CSS変数のみ（プロジェクト規約）

/** ルビ記法 `{漢字|かんじ}` の装飾（VFM標準記法） */
const rubyDecorator = new MatchDecorator({
  regexp: /\{[^{}|\n]+\|[^{}|\n]+\}/g,
  decoration: Decoration.mark({ class: "cm-vfm-ruby" }),
});

const rubyHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = rubyDecorator.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = rubyDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** 字下げなしの改行（行末の半角スペース2つ以上）の装飾（Issue #248） */
const hardBreakMark = Decoration.mark({ class: "cm-vfm-hard-break" });

/**
 * 可視範囲の各行を走査し、行末の半角スペース2つ以上に装飾を付ける。
 * ルビと違い行末アンカーで判定するため、MatchDecorator（チャンク単位で正規表現を
 * 回す）ではなく行単位で見る——可視範囲は行境界とは限らず、チャンクの切れ目を
 * 行末と誤認しうるため
 */
function hardBreakDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const match = / {2,}$/.exec(line.text);
      // 空白だけの行は段落の区切りであって `<br>` にはならないので対象外。
      // 空白の判定は半角スペースとタブのみ（全角スペースだけの行は本文行として
      // 扱われ `<br>` が出るため、`trim()` では落としすぎる）。
      // 逆に、段落の最終行のように `<br>` にならない位置の2スペースにも印は出す
      // ——「あるはずのないスペースが残っている」ことに気付くのも本Issueの目的
      if (match && /[^ \t]/.test(line.text.slice(0, match.index))) {
        builder.add(line.from + match.index, line.to, hardBreakMark);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

// 行末の半角スペース2つ＝字下げなしの改行（`<br>`）は、そのままでは画面に何も出ず
// 入れ忘れ・消し込みに気付けない。ドキュメントの文字列は変えずに印だけを重ねる
const hardBreakHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hardBreakDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = hardBreakDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// Markdown構文（見出し等）とHTMLコメントの色。lang-markdown はHTMLをネスト解析するため
// `<!-- -->` は tags.comment として拾える
const vfmHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--primary)", fontWeight: "bold" },
  { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.quote, color: "var(--muted-foreground)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "15px",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-content": {
    fontFamily: "var(--font-sans)",
    lineHeight: "1.9",
    padding: "16px 0",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0 16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor: "color-mix(in oklab, var(--primary) 18%, transparent)",
    },
  ".cm-vfm-ruby": {
    color: "var(--primary)",
    backgroundColor: "color-mix(in oklab, var(--primary) 8%, transparent)",
    borderRadius: "3px",
  },
  // 字下げなしの改行（Issue #248）。スペース自体を地色で見せ、末尾に印を出す。
  // 印は疑似要素なので原稿の文字列には入らない
  ".cm-vfm-hard-break": {
    backgroundColor: "color-mix(in oklab, var(--primary) 16%, transparent)",
    borderRadius: "3px",
  },
  ".cm-vfm-hard-break::after": {
    content: '"↵"',
    color: "var(--muted-foreground)",
    fontSize: "0.85em",
  },
  ".cm-scroller": { overflow: "auto" },

  // 検索置換パネル（Issue #263）。CodeMirror の既定色はテーマに追従しないため、
  // 枠・入力欄・ボタン・一致のハイライトをすべてCSS変数で上書きする（プロジェクト規約）
  ".cm-panels": {
    backgroundColor: "var(--card)",
    color: "var(--card-foreground)",
    borderColor: "var(--border)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 8px", fontFamily: "var(--font-sans)" },
  ".cm-panel.cm-search label": { fontSize: "12px" },
  ".cm-textfield": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "3px 6px",
    fontFamily: "var(--font-sans)",
  },
  ".cm-textfield:focus-visible": {
    outline: "2px solid var(--ring)",
    outlineOffset: "-1px",
  },
  ".cm-button": {
    backgroundColor: "var(--secondary)",
    backgroundImage: "none",
    color: "var(--secondary-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "3px 8px",
    fontFamily: "var(--font-sans)",
  },
  ".cm-button:hover": {
    backgroundColor: "color-mix(in oklab, var(--secondary) 80%, var(--accent))",
  },
  ".cm-panel.cm-search [name='close']": {
    color: "var(--muted-foreground)",
    fontSize: "16px",
    padding: "0 4px",
  },
  // 正規表現チェックボックスは出さない。全ファイル置換（置換ダイアログ）が
  // 単純な文字列置換のみを扱うため、開いている章だけ挙動が変わるのを避ける
  ".cm-panel.cm-search label:has(input[name='re'])": { display: "none" },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklab, var(--primary) 45%, transparent)",
  },
});

/**
 * 検索置換パネルの日本語化（Issue #263）。
 * `@codemirror/search` の標準パネルは英語のため phrases で差し替える
 */
const searchPhrases = EditorState.phrases.of({
  Find: "検索",
  Replace: "置換",
  next: "次へ",
  previous: "前へ",
  all: "すべて",
  "match case": "大文字小文字を区別",
  "by word": "単語単位",
  regexp: "正規表現",
  replace: "置換",
  "replace all": "すべて置換",
  close: "閉じる",
  "current match": "現在の一致",
  "replaced $ matches": "$件を置換しました",
  "replaced match on line $": "$行目を置換しました",
  "on line": "行目",
});

/** 検索パネルを開く（ツールバーの「検索」ボタンから。`Cmd/Ctrl+F` と同じ動作） */
export function openSearch(view: EditorView): boolean {
  openSearchPanel(view);
  return true;
}

/**
 * コメントのトグル（SPEC-vertical-editor-phase3 §3。`Cmd/Ctrl+/`・ツールバー共用）。
 * 選択範囲を `<!-- -->` で包む／既にコメントなら外す／未選択なら空コメントを挿入して
 * カーソルを中に置く。没にした文章の保留（行コメント）にも使える（親SPEC §4.5）
 */
export function toggleVfmComment(view: EditorView): boolean {
  const spec = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    if (/^<!--[\s\S]*-->$/.test(selected)) {
      const inner = selected.replace(/^<!--[ ]?/, "").replace(/[ ]?-->$/, "");
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }
    if (range.empty) {
      return {
        changes: { from: range.from, insert: "<!--  -->" },
        range: EditorSelection.cursor(range.from + 5),
      };
    }
    const wrapped = `<!-- ${selected} -->`;
    return {
      changes: { from: range.from, to: range.to, insert: wrapped },
      range: EditorSelection.range(range.from, range.from + wrapped.length),
    };
  });
  view.dispatch(spec, { scrollIntoView: true, userEvent: "input" });
  view.focus();
  return true;
}

/** 主選択範囲のテキスト（ルビ入力補助の親文字プリセット用） */
export function getSelectedText(view: EditorView): string {
  const range = view.state.selection.main;
  return view.state.sliceDoc(range.from, range.to);
}

/**
 * 選択範囲を `<span class="...">` で包む（傍点 `.tenten`・縦中横 `.tcy`。SPEC-phase3 §4）。
 * HTML直書き記法は Phase 1 のサンプル原稿でプレビュー・入稿PDF両方の組版を実証済み。
 * 選択がなければ何もせず false（呼び出し側が案内を出す）
 */
export function wrapSelectionWithSpan(
  view: EditorView,
  className: "tenten" | "tcy",
): boolean {
  if (view.state.selection.main.empty) return false;
  const spec = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const wrapped = `<span class="${className}">${selected}</span>`;
    return {
      changes: { from: range.from, to: range.to, insert: wrapped },
      range: EditorSelection.range(range.from, range.from + wrapped.length),
    };
  });
  view.dispatch(spec, { scrollIntoView: true, userEvent: "input" });
  view.focus();
  return true;
}

/**
 * 主選択範囲（未選択ならカーソル位置）を割注記法で置き換える（Issue #23）。
 * 純CSSでは任意テキストを2行に自動分割できないため、前半・後半を
 * `<span class="warichu"><span>前半</span><span>後半</span></span>` と明示する。
 * 後半が空なら1行の小書きとして挿入する
 */
export function insertWarichuText(
  view: EditorView,
  first: string,
  second: string,
): void {
  const range = view.state.selection.main;
  const inner =
    second === ""
      ? `<span>${first}</span>`
      : `<span>${first}</span><span>${second}</span>`;
  const insert = `<span class="warichu">${inner}</span>`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

/**
 * カーソル位置に改ページ指定 `<div class="page-break"></div>` を独立行として挿入する（Issue #23）。
 * VFMのHTMLブロックとして扱わせるため前後を空行で区切る（既にある空行は増やさない）。
 * 選択範囲があっても本文は削除せず、カーソル側の端（head）へ挿入する
 */
export function insertPageBreak(view: EditorView): void {
  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const before = doc.sliceString(Math.max(0, pos - 2), pos);
  const after = doc.sliceString(pos, Math.min(doc.length, pos + 2));
  const prefix =
    pos === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const suffix =
    pos === doc.length || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  const insert = `${prefix}<div class="page-break"></div>${suffix}`;
  view.dispatch({
    changes: { from: pos, insert },
    selection: EditorSelection.cursor(pos + insert.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

/** 主選択範囲（未選択ならカーソル位置）をルビ記法 `{親文字|よみ}` で置き換える */
export function insertRubyText(
  view: EditorView,
  base: string,
  reading: string,
): void {
  const range = view.state.selection.main;
  const insert = `{${base}|${reading}}`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

/**
 * 入力ペインの拡張一式。
 * onDocChange は打鍵ごとに呼ばれる（待避・プレビューのデバウンスは呼び出し側の責務）
 */
export function buildEditorExtensions(handlers: {
  onDocChange: (content: string) => void;
  /** Cmd/Ctrl+S。保存ダイアログを開く（SPEC §6） */
  onSaveRequest: () => void;
  /** 画像ファイルのドロップ（SPEC-phase3 §6。カーソルはドロップ位置へ移動済みで呼ばれる） */
  onImageDrop?: (file: File) => void;
  /** 主選択範囲のテキスト変更通知（選択範囲の校正。SPEC-proofread-selection §3） */
  onSelectionChange?: (selectedText: string) => void;
}): Extension[] {
  const imageDropHandlers = EditorView.domEventHandlers({
    dragover: (event) => {
      if (handlers.onImageDrop && event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    drop: (event, view) => {
      const file = event.dataTransfer?.files?.[0];
      if (!handlers.onImageDrop || !file || !file.type.startsWith("image/"))
        return false;
      event.preventDefault();
      // 挿入記法はドロップ位置に入れる
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null)
        view.dispatch({ selection: EditorSelection.cursor(pos) });
      handlers.onImageDrop(file);
      return true;
    },
  });
  return [
    imageDropHandlers,
    history(),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          handlers.onSaveRequest();
          return true;
        },
      },
      { key: "Mod-/", preventDefault: true, run: toggleVfmComment },
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    // 開いている章の検索置換（Issue #263）。全ファイル置換は別ダイアログの担当。
    // パネルは本文の上に出す（下端だとプレビューとの境目で見失いやすい）
    search({ top: true }),
    searchPhrases,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(vfmHighlightStyle),
    rubyHighlight,
    hardBreakHighlight,
    EditorView.lineWrapping,
    editorTheme,
    placeholder("本文をVFM（Markdown）で入力…"),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.onDocChange(update.state.doc.toString());
      if (
        handlers.onSelectionChange &&
        (update.selectionSet || update.docChanged)
      ) {
        const range = update.state.selection.main;
        handlers.onSelectionChange(update.state.sliceDoc(range.from, range.to));
      }
    }),
  ];
}
