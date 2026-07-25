import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'

// Zenn記事エディタ（CodeMirror 6）の最小セットアップ（SPEC-zenn-integration §3.2）。
// 縦書きエディタの components/editor/codemirror.ts はVFM固有記法（ルビ装飾等）前提のため
// 流用せず、横書きMarkdown用を別に持つ。色はテーマ用CSS変数のみ（プロジェクト規約）

const zennHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--primary)', fontWeight: 'bold' },
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.quote, color: 'var(--muted-foreground)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  { tag: tags.link, color: 'var(--primary)' },
])

const zennEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.8',
    padding: '16px 0',
    caretColor: 'var(--foreground)',
  },
  '.cm-line': { padding: '0 16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 18%, transparent)',
  },
  '.cm-scroller': { overflow: 'auto' },
})

/**
 * Zenn記事入力ペインの拡張一式。
 * onDocChange は打鍵ごとに呼ばれる（プレビューのデバウンスは呼び出し側の責務）
 */
export function buildZennEditorExtensions(handlers: {
  onDocChange: (content: string) => void
  /** Cmd/Ctrl+S。保存（投稿確認ダイアログ）を開く */
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
    syntaxHighlighting(zennHighlightStyle),
    EditorView.lineWrapping,
    zennEditorTheme,
    placeholder('本文をMarkdownで入力…（Zenn記法が使えます）'),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.onDocChange(update.state.doc.toString())
    }),
  ]
}
