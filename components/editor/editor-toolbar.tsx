'use client'

import { useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { toast } from 'sonner'

import {
  getSelectedText,
  insertPageBreak,
  insertRubyText,
  insertWarichuText,
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
import type { WritingDirection } from '@/lib/editor/preview'

// ルビ記法 `{親文字|よみ}` に使えない文字（VFM記法の区切りと衝突する）
const RUBY_FORBIDDEN = /[{}|\n]/

// 割注は `<span>` の中身になるためHTMLとして解釈される文字を禁止する。
// `*` `_` `` ` `` `[` はVFMが前半・後半をまたいで強調・コード・リンク対として
// 解釈しマークアップのネストを壊しうるため併せて禁止する
const WARICHU_FORBIDDEN = /[<>&*_`[\n]/

/**
 * 入力補助ツールバー（SPEC-vertical-editor-phase3 §4、割注・改ページは Issue #23）。
 * 記法を知らなくてもルビ・傍点・縦中横・割注・改ページ・コメントが使える。
 * 挿入結果はすべて素のVFMテキスト（組版はテーマCSSの責務のまま）。
 * 傍点・縦中横は縦書きテーマ専用UIのため横書きテーマでは出さない（ルビは両方で有効。Issue #97）
 */
export function EditorToolbar({
  viewRef,
  direction,
  onImageRequest,
}: {
  viewRef: React.RefObject<EditorView | null>
  /** テーマの書字方向（縦書き専用ボタンの出し分けに使う） */
  direction: WritingDirection
  /** 画像挿入（SPEC §6）。未指定ならボタンを出さない */
  onImageRequest?: () => void
}) {
  const [rubyOpen, setRubyOpen] = useState(false)
  const [rubyBase, setRubyBase] = useState('')
  const [rubyReading, setRubyReading] = useState('')
  const [warichuOpen, setWarichuOpen] = useState(false)
  const [warichuFirst, setWarichuFirst] = useState('')
  const [warichuSecond, setWarichuSecond] = useState('')

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

  const openWarichu = () => {
    const view = viewRef.current
    if (!view) return
    // 選択範囲があれば前半・後半へ半分割してプリセット（割注は2行組みが基本形）
    const selected = getSelectedText(view)
    const chars = [...selected]
    const half = Math.ceil(chars.length / 2)
    setWarichuFirst(chars.slice(0, half).join(''))
    setWarichuSecond(chars.slice(half).join(''))
    setWarichuOpen(true)
  }

  const warichuInvalid =
    warichuFirst.trim() === '' ||
    WARICHU_FORBIDDEN.test(warichuFirst) ||
    WARICHU_FORBIDDEN.test(warichuSecond)

  const confirmWarichu = () => {
    const view = viewRef.current
    if (!view || warichuInvalid) return
    insertWarichuText(view, warichuFirst.trim(), warichuSecond.trim())
    setWarichuOpen(false)
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
      {direction === 'vertical' && (
        <>
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
        </>
      )}
      <ToolbarButton
        label="割注"
        title="割注を挿入（本文中に小さな2行組みの注記を入れる）"
        onClick={openWarichu}
      />
      <ToolbarButton
        label="改ページ"
        title="カーソル位置で改ページする（シーン転換など）"
        onClick={() => {
          const view = viewRef.current
          if (view) insertPageBreak(view)
        }}
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

      <Dialog open={warichuOpen} onOpenChange={setWarichuOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>割注を挿入</DialogTitle>
            <DialogDescription>
              本文中に小さな2行組みで挿入されます。後半を空にすると1行の小書きになります
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              confirmWarichu()
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              前半（1行目）
              <Input
                value={warichuFirst}
                onChange={(event) => setWarichuFirst(event.target.value)}
                placeholder="やまとことばで"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              後半（2行目）
              <Input
                value={warichuSecond}
                onChange={(event) => setWarichuSecond(event.target.value)}
                placeholder="いうところの"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWarichuOpen(false)}>
                キャンセル
              </Button>
              <Button type="submit" disabled={warichuInvalid}>
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
