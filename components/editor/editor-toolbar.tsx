'use client'

import { useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { toast } from 'sonner'

import {
  getSelectedText,
  insertRubyText,
  toggleVfmComment,
  wrapSelectionWithSpan,
} from '@/components/editor/codemirror'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

// ルビ記法 `{親文字|よみ}` に使えない文字（VFM記法の区切りと衝突する）
const RUBY_FORBIDDEN = /[{}|\n]/

/**
 * 入力補助ツールバー（SPEC-vertical-editor-phase3 §4）。
 * 記法を知らなくてもルビ・傍点・縦中横・コメントが使える。
 * 挿入結果はすべて素のVFMテキスト（組版はテーマCSSの責務のまま）
 */
export function EditorToolbar({
  viewRef,
  onImageRequest,
}: {
  viewRef: React.RefObject<EditorView | null>
  /** 画像挿入（SPEC §6）。未指定ならボタンを出さない */
  onImageRequest?: () => void
}) {
  const [rubyOpen, setRubyOpen] = useState(false)
  const [rubyBase, setRubyBase] = useState('')
  const [rubyReading, setRubyReading] = useState('')

  const openRuby = () => {
    const view = viewRef.current
    if (!view) return
    setRubyBase(getSelectedText(view))
    setRubyReading('')
    setRubyOpen(true)
  }

  const rubyInvalid =
    rubyBase.trim() === '' ||
    rubyReading.trim() === '' ||
    RUBY_FORBIDDEN.test(rubyBase) ||
    RUBY_FORBIDDEN.test(rubyReading)

  const confirmRuby = () => {
    const view = viewRef.current
    if (!view || rubyInvalid) return
    insertRubyText(view, rubyBase.trim(), rubyReading.trim())
    setRubyOpen(false)
  }

  const wrapSpan = (className: 'tenten' | 'tcy', label: string) => {
    const view = viewRef.current
    if (!view) return
    if (!wrapSelectionWithSpan(view, className)) {
      toast.info(`${label}を付ける範囲を選択してから押してください`)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
      <ToolbarButton label="ルビ" title="選択範囲にルビを振る（{親文字|よみ}）" onClick={openRuby} />
      <ToolbarButton
        label="傍点"
        title="選択範囲に傍点（圏点）を付ける"
        onClick={() => wrapSpan('tenten', '傍点')}
      />
      <ToolbarButton
        label="縦中横"
        title="選択範囲を縦中横にする（2〜3桁の半角英数向け）"
        onClick={() => wrapSpan('tcy', '縦中横')}
      />
      <ToolbarButton
        label="コメント"
        title="コメントの挿入・解除（Cmd/Ctrl+/。プレビュー・PDFには出ません）"
        onClick={() => {
          const view = viewRef.current
          if (view) toggleVfmComment(view)
        }}
      />
      {onImageRequest && (
        <ToolbarButton label="画像" title="画像を挿入（images/ へコミットされます）" onClick={onImageRequest} />
      )}

      <Dialog open={rubyOpen} onOpenChange={setRubyOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ルビを振る</DialogTitle>
            <DialogDescription>
              本文には {'{親文字|よみ}'} の形で挿入されます（VFM標準記法）
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              confirmRuby()
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              親文字
              <Input
                value={rubyBase}
                onChange={(event) => setRubyBase(event.target.value)}
                placeholder="漢字"
                autoFocus={rubyBase === ''}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              よみ
              <Input
                value={rubyReading}
                onChange={(event) => setRubyReading(event.target.value)}
                placeholder="かんじ"
                autoFocus={rubyBase !== ''}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRubyOpen(false)}>
                キャンセル
              </Button>
              <Button type="submit" disabled={rubyInvalid}>
                挿入する
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ToolbarButton({
  label,
  title,
  onClick,
}: {
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      title={title}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}
