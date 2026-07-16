import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
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
 * 入力ペインの拡張一式。
 * onDocChange は打鍵ごとに呼ばれる（待避・プレビューのデバウンスは呼び出し側の責務）
 */
export function buildEditorExtensions(handlers: {
  onDocChange: (content: string) => void
  /** Cmd/Ctrl+S。保存ダイアログを開く（SPEC §6） */
  onSaveRequest: () => void
}): Extension[] {
  return [
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
