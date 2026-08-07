'use client'

import { useMemo, useState } from 'react'
import { Copy, Download, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import {
  aozoraFileName,
  collectRubyWarnings,
  toSiteText,
  type ExportSite,
} from '@/lib/editor/aozora'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** 書き出し先サイトの選択肢と、変換内容の説明（SPEC-aozora-export §3.1・§4） */
const SITES: { value: ExportSite; label: string; note: string }[] = [
  {
    value: 'aozora',
    label: '青空文庫',
    note: '純粋な青空文庫注記で出力します。投稿サイトが解釈するのは注記の一部のみです（例: ルビのみ対応のサイトでは傍点・改ページ等の注記が素のテキストとして表示されます）',
  },
  {
    value: 'kakuyomu',
    label: 'カクヨム',
    note: '傍点をカクヨム記法《《…》》へ変換し、カクヨムが解釈できない注記（縦中横・改ページ・割注）は除去します（対象の本文は残ります）',
  },
  {
    value: 'narou',
    label: '小説家になろう',
    note: '傍点を慣習的な中黒ルビ（｜対象《・・》）で代用し、なろうが解釈できない注記（縦中横・改ページ・割注）は除去します（対象の本文は残ります）',
  },
]

/**
 * 投稿サイト用書き出しダイアログ（SPEC-aozora-export §4）。
 * 開いている章の編集中の本文（未保存の編集も含む）を、選択したサイトが
 * 解釈できる形式へ変換し、コピー／.txtダウンロードで取り出す。原稿には一切手を加えない
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
  const [site, setSite] = useState<ExportSite>('aozora')
  const converted = useMemo(() => (open ? toSiteText(source, site) : ''), [open, source, site])
  const warnings = useMemo(
    () => (open ? collectRubyWarnings(converted, site) : []),
    [open, converted, site],
  )

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
          <DialogTitle>投稿サイト用に書き出し</DialogTitle>
          <DialogDescription>
            開いている章の本文（未保存の編集も含む）を、選択したサイトが解釈できる形式へ変換します。
            原稿は変更されません
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="書き出し先サイト" className="flex gap-2">
          {SITES.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              size="sm"
              role="radio"
              aria-checked={site === value}
              variant={site === value ? 'default' : 'outline'}
              onClick={() => setSite(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <textarea
          readOnly
          value={converted}
          aria-label="変換結果のプレビュー"
          className="h-64 w-full resize-none rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none"
        />
        {warnings.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <TriangleAlert className="size-3.5" aria-hidden />
              文字数上限を超えるルビがあります（サイト側でルビとして解釈されません）
            </p>
            <ul className="list-inside list-disc space-y-0.5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {SITES.find(({ value }) => value === site)?.note}
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
