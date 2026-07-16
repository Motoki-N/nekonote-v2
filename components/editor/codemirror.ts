import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  placeholder,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'

// 入力ペイン（CodeMirror 6）の共通セットアップ（SPEC-vertical-editor-phase2 §4）。
// 横書きプレーンテキスト＋Markdownハイライトを土台に、VFM固有記法（ルビ）を装飾で重ねる。
// 色はテーマ用CSS変数のみ（プロジェクト規約）

/** ルビ記法 `{漢字|かんじ}` の装飾（VFM標準記法） */
const rubyDecorator = new MatchDecorator({
  regexp: /\{[^{}|\n]+\|[^{}|\n]+\}/g,
  decoration: Decoration.mark({ class: 'cm-vfm-ruby' }),
})

const rubyHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = rubyDecorator.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = rubyDecorator.updateDeco(update, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

// Markdown構文（見出し等）とHTMLコメントの色。lang-markdown はHTMLをネスト解析するため
// `<!-- -->` は tags.comment として拾える
const vfmHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--primary)', fontWeight: 'bold' },
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.quote, color: 'var(--muted-foreground)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.9',
    padding: '16px 0',
    caretColor: 'var(--foreground)',
  },
  '.cm-line': { padding: '0 16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 18%, transparent)',
  },
  '.cm-vfm-ruby': {
    color: 'var(--primary)',
    backgroundColor: 'color-mix(in oklab, var(--primary) 8%, transparent)',
    borderRadius: '3px',
  },
  '.cm-scroller': { overflow: 'auto' },
})

/**
 * コメントのトグル（SPEC-vertical-editor-phase3 §3。`Cmd/Ctrl+/`・ツールバー共用）。
 * 選択範囲を `<!-- -->` で包む／既にコメントなら外す／未選択なら空コメントを挿入して
 * カーソルを中に置く。没にした文章の保留（行コメント）にも使える（親SPEC §4.5）
 */
export function toggleVfmComment(view: EditorView): boolean {
  const spec = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to)
    if (/^<!--[\s\S]*-->$/.test(selected)) {
      const inner = selected.replace(/^<!--[ ]?/, '').replace(/[ ]?-->$/, '')
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      }
    }
    if (range.empty) {
      return {
        changes: { from: range.from, insert: '<!--  -->' },
        range: EditorSelection.cursor(range.from + 5),
      }
    }
    const wrapped = `<!-- ${selected} -->`
    return {
      changes: { from: range.from, to: range.to, insert: wrapped },
      range: EditorSelection.range(range.from, range.from + wrapped.length),
    }
  })
  view.dispatch(spec, { scrollIntoView: true, userEvent: 'input' })
  view.focus()
  return true
}

/** 主選択範囲のテキスト（ルビ入力補助の親文字プリセット用） */
export function getSelectedText(view: EditorView): string {
  const range = view.state.selection.main
  return view.state.sliceDoc(range.from, range.to)
}

/**
 * 選択範囲を `<span class="...">` で包む（傍点 `.tenten`・縦中横 `.tcy`。SPEC-phase3 §4）。
 * HTML直書き記法は Phase 1 のサンプル原稿でプレビュー・入稿PDF両方の組版を実証済み。
 * 選択がなければ何もせず false（呼び出し側が案内を出す）
 */
export function wrapSelectionWithSpan(view: EditorView, className: 'tenten' | 'tcy'): boolean {
  if (view.state.selection.main.empty) return false
  const spec = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to)
    const wrapped = `<span class="${className}">${selected}</span>`
    return {
      changes: { from: range.from, to: range.to, insert: wrapped },
      range: EditorSelection.range(range.from, range.from + wrapped.length),
    }
  })
  view.dispatch(spec, { scrollIntoView: true, userEvent: 'input' })
  view.focus()
  return true
}

/** 主選択範囲（未選択ならカーソル位置）をルビ記法 `{親文字|よみ}` で置き換える */
export function insertRubyText(view: EditorView, base: string, reading: string): void {
  const range = view.state.selection.main
  const insert = `{${base}|${reading}}`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length),
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/**
 * 入力ペインの拡張一式。
 * onDocChange は打鍵ごとに呼ばれる（待避・プレビューのデバウンスは呼び出し側の責務）
 */
export function buildEditorExtensions(handlers: {
  onDocChange: (content: string) => void
  /** Cmd/Ctrl+S。保存ダイアログを開く（SPEC §6） */
  onSaveRequest: () => void
  /** 画像ファイルのドロップ（SPEC-phase3 §6。カーソルはドロップ位置へ移動済みで呼ばれる） */
  onImageDrop?: (file: File) => void
}): Extension[] {
  const imageDropHandlers = EditorView.domEventHandlers({
    dragover: (event) => {
      if (handlers.onImageDrop && event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
        return true
      }
      return false
    },
    drop: (event, view) => {
      const file = event.dataTransfer?.files?.[0]
      if (!handlers.onImageDrop || !file || !file.type.startsWith('image/')) return false
      event.preventDefault()
      // 挿入記法はドロップ位置に入れる
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos !== null) view.dispatch({ selection: EditorSelection.cursor(pos) })
      handlers.onImageDrop(file)
      return true
    },
  })
  return [
    imageDropHandlers,
    history(),
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          handlers.onSaveRequest()
          return true
        },
      },
      { key: 'Mod-/', preventDefault: true, run: toggleVfmComment },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(vfmHighlightStyle),
    rubyHighlight,
    EditorView.lineWrapping,
    editorTheme,
    placeholder('本文をVFM（Markdown）で入力…'),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.onDocChange(update.state.doc.toString())
    }),
  ]
}
