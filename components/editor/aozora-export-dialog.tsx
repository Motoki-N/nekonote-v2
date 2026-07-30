'use client'

import { useMemo } from 'react'
import { Copy, Download } from 'lucide-react'
import { toast } from 'sonner'

import { aozoraFileName, toAozoraText } from '@/lib/editor/aozora'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * 青空文庫形式の書き出しダイアログ（SPEC-aozora-export §4）。
 * 開いている章の編集中の本文（未保存の編集も含む）を変換し、
 * コピー／.txtダウンロードで取り出す。原稿には一切手を加えない
 */
export function AozoraExportDialog({
  open,
  fileName,
  source,
  onOpenChange,
}: {
  open: boolean
  /** 章のファイル名（ダウンロード名の元。例: chapter01.md） */
  fileName: string
  /** 変換対象のVFM本文（ダイアログを開いた時点の編集中の内容） */
  source: string
  onOpenChange: (open: boolean) => void
}) {
  const converted = useMemo(() => (open ? toAozoraText(source) : ''), [open, source])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(converted)
      toast.success('クリップボードにコピーしました')
    } catch {
      toast.error('コピーに失敗しました。プレビューから直接選択してコピーしてください')
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([converted], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = aozoraFileName(fileName)
    anchor.click()
    // 同期で revoke するとダウンロード開始前にURLが無効化される環境がある（Safari等）
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>青空文庫形式で書き出し</DialogTitle>
          <DialogDescription>
            開いている章の本文（未保存の編集も含む）を青空文庫の注記形式へ変換します。
            原稿は変更されません
          </DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          value={converted}
          aria-label="変換結果のプレビュー"
          className="h-64 w-full resize-none rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none"
        />
        <p className="text-xs text-muted-foreground">
          投稿サイトが解釈するのは青空文庫注記の一部のみです（例: ルビのみ対応のサイトでは
          傍点・改ページ等の注記が素のテキストとして表示されます）。貼り付け先の対応記法を確認してください
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          <Button type="button" variant="outline" onClick={download}>
            <Download data-icon="inline-start" />
            .txt をダウンロード
          </Button>
          <Button type="button" onClick={() => void copy()}>
            <Copy data-icon="inline-start" />
            コピー
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
