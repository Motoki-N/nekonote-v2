'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createBuildTag, getBuildStatus, getBuildTagInfo } from '@/lib/actions/editor'
import type { BuildTagInfo } from '@/lib/actions/editor'
import type { ReleaseAsset } from '@/lib/git/github'
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

// Release ポーリングの間隔と打ち切り（SPEC-vertical-editor-phase3 §8・論点B）
const POLL_INTERVAL_MS = 30_000
const POLL_TIMEOUT_MS = 15 * 60_000

const TAG_PATTERN = /^v[0-9A-Za-z._-]{1,30}-nyuko$/

type Phase = 'form' | 'building' | 'done' | 'timeout'

/**
 * 入稿ビルドダイアログ（SPEC-vertical-editor-phase3 §8）。
 * 中身はタグ作成の代行——`v*-nyuko` タグを作ると原稿リポジトリの GitHub Actions が
 * 入稿PDF（PDF/X-1a）を生成して Release に添付する。完了検知は Release のポーリング
 */
export function BuildDialog({
  projectId,
  open,
  dirty,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  /** 未保存の編集があるか（タグはコミット済みのHEADに付くため警告を出す） */
  dirty: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [info, setInfo] = useState<BuildTagInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [assets, setAssets] = useState<ReleaseAsset[]>([])
  const [starting, setStarting] = useState(false)
  const buildStartRef = useRef(0)

  // 初期情報（既存タグ・次タグ提案）。ビルド進行中の再オープンでは取り直さない
  useEffect(() => {
    if (!open || phase !== 'form') return
    let cancelled = false
    void getBuildTagInfo(projectId).then((result) => {
      if (cancelled) return
      if (!result.ok || !result.data) {
        setInfoError(result.ok ? 'タグ情報の取得に失敗しました' : result.error.message)
        return
      }
      const data = result.data
      setInfoError(null)
      setInfo(data)
      setTag((current) => (current === '' ? data.suggestedTag : current))
    })
    return () => {
      cancelled = true
    }
  }, [open, phase, projectId])

  // Release のポーリング（開いている間のみ。閉じても Actions のビルド自体は進む）
  useEffect(() => {
    if (!open || phase !== 'building' || !activeTag) return
    let cancelled = false
    const tick = () => {
      void getBuildStatus(projectId, activeTag).then((result) => {
        if (cancelled) return
        if (result.ok && result.data && result.data.state === 'done') {
          setAssets(result.data.assets)
          setPhase('done')
          return
        }
        if (Date.now() - buildStartRef.current > POLL_TIMEOUT_MS) setPhase('timeout')
      })
    }
    const interval = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [open, phase, activeTag, projectId])

  const start = async () => {
    setStarting(true)
    try {
      const result = await createBuildTag(projectId, tag.trim())
      if (!result.ok || !result.data) {
        toast.error(result.ok ? '入稿ビルドの開始に失敗しました' : result.error.message)
        return
      }
      buildStartRef.current = Date.now()
      setActiveTag(result.data.tag)
      setPhase('building')
      toast.success(`タグ ${result.data.tag} を作成しました。Actions がビルドを開始します`)
    } finally {
      setStarting(false)
    }
  }

  const reset = () => {
    setPhase('form')
    setActiveTag(null)
    setAssets([])
    setTag('')
  }

  const actionsUrl = info ? `https://github.com/${info.repo}/actions` : null
  const tagInvalid = !TAG_PATTERN.test(tag.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>入稿ビルド</DialogTitle>
          <DialogDescription>
            入稿タグを作成すると、GitHub Actions が入稿PDF（PDF/X-1a）を生成して Release
            に添付します
          </DialogDescription>
        </DialogHeader>

        {phase === 'form' && (
          <div className="flex flex-col gap-3">
            {infoError && <p className="text-sm text-destructive">{infoError}</p>}
            {dirty && (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                未保存の編集があります。タグはコミット済みの最新状態に付くため、
                いまの編集内容はPDFに含まれません。
              </p>
            )}
            <label className="flex flex-col gap-1 text-sm">
              入稿タグ
              <Input
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="v1.0-nyuko"
              />
            </label>
            {info && info.nyukoTags.length > 0 && (
              <p className="text-xs text-muted-foreground">
                これまでの入稿タグ: {info.nyukoTags.slice(0, 5).join(' / ')}
              </p>
            )}
            {tag.trim() !== '' && tagInvalid && (
              <p className="text-xs text-destructive">
                タグは「v0.3-nyuko」の形式で入力してください
              </p>
            )}
          </div>
        )}

        {phase === 'building' && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin" />
              ビルド中… タグ {activeTag}
            </p>
            <p className="text-xs text-muted-foreground">
              組版には数分かかります（30秒ごとに Release を確認しています）。
              このダイアログを閉じてもビルドは進みます。
            </p>
            {actionsUrl && <ActionsLink url={actionsUrl} />}
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground">
              入稿PDFができました（タグ {activeTag}）:
            </p>
            <ul className="flex flex-col gap-1">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <a
                    href={`/api/editor/build-asset?projectId=${projectId}&assetId=${asset.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
                  >
                    <Download className="size-3.5 shrink-0" />
                    {asset.name}
                    <span className="text-xs text-muted-foreground">
                      {(asset.sizeBytes / 1024 / 1024).toFixed(1)}MB
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === 'timeout' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">
              15分以内にビルドの完了を確認できませんでした。失敗している可能性があります。
            </p>
            {actionsUrl && <ActionsLink url={actionsUrl} />}
          </div>
        )}

        <DialogFooter>
          {phase === 'form' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                キャンセル
              </Button>
              <Button type="button" disabled={starting || tagInvalid} onClick={() => void start()}>
                {starting && <Loader2 data-icon="inline-start" className="animate-spin" />}
                タグを作成してビルド開始
              </Button>
            </>
          ) : (
            <>
              {(phase === 'done' || phase === 'timeout') && (
                <Button type="button" variant="outline" onClick={reset}>
                  新しいビルドへ
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                閉じる
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ActionsLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      <ExternalLink className="size-3" />
      GitHub の Actions ページで進行状況を見る
    </a>
  )
}
