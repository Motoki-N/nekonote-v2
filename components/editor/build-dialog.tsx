'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createBuildTag, getBuildStatus, getBuildTagInfo } from '@/lib/actions/editor'
import type { BuildKind, BuildTagInfo } from '@/lib/actions/editor'
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

// ビルド種別ごとのタグ形式・文言（原稿リポジトリの build-pdf.yml / build-epub.yml に対応）
const KINDS: Record<
  BuildKind,
  { pattern: RegExp; label: string; tagLabel: string; placeholder: string; artifact: string }
> = {
  nyuko: {
    pattern: /^v[0-9A-Za-z._-]{1,30}-nyuko$/,
    label: '入稿PDF',
    tagLabel: '入稿タグ',
    placeholder: 'v1.0-nyuko',
    artifact: '入稿PDF（PDF/X-1a）',
  },
  epub: {
    pattern: /^v[0-9A-Za-z._-]{1,30}-epub$/,
    label: 'EPUB',
    tagLabel: 'EPUBタグ',
    placeholder: 'v1.0-epub',
    artifact: 'EPUB（電子書籍）',
  },
}

type Phase = 'form' | 'building' | 'done' | 'timeout'

/**
 * ビルドダイアログ（SPEC-vertical-editor-phase3 §8・EPUBは Issue #119）。
 * 中身はタグ作成の代行——`v*-nyuko` / `v*-epub` タグを作ると原稿リポジトリの
 * GitHub Actions が成果物（入稿PDF / EPUB）を生成して Release に添付する。
 * 完了検知は Release のポーリング
 */
export function BuildDialog({
  projectId,
  open,
  dirty,
  nonDefaultBranch,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  /** 未保存の編集があるか（タグはコミット済みのHEADに付くため警告を出す） */
  dirty: boolean
  /** 非デフォルトブランチを開いているか（ビルド対象はデフォルトHEADのみ。SPEC-phase5 §3.4） */
  nonDefaultBranch: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [info, setInfo] = useState<BuildTagInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [kind, setKind] = useState<BuildKind>('nyuko')
  const [tag, setTag] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [assets, setAssets] = useState<ReleaseAsset[]>([])
  const [starting, setStarting] = useState(false)
  const buildStartRef = useRef(0)
  // 初期情報ロード時に「いま選択中の種別」のタグ提案を入れるため（effect の依存に kind を
  // 入れると種別切替のたびに再フェッチしてしまう）。更新は selectKind 内でのみ行う
  const kindRef = useRef<BuildKind>('nyuko')

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
      setTag((current) => (current === '' ? data[kindRef.current].suggestedTag : current))
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

  const selectKind = (next: BuildKind) => {
    kindRef.current = next
    setKind(next)
    if (info) setTag(info[next].suggestedTag)
  }

  const start = async () => {
    setStarting(true)
    try {
      const result = await createBuildTag(projectId, tag.trim())
      if (!result.ok || !result.data) {
        toast.error(result.ok ? 'ビルドの開始に失敗しました' : result.error.message)
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
    // 空に戻す——phase が 'form' に戻ると初期情報が再フェッチされ、新しいタグ提案が充填される
    setTag('')
  }

  const actionsUrl = info ? `https://github.com/${info.repo}/actions` : null
  const tagInvalid = !KINDS[kind].pattern.test(tag.trim())
  // 完了表示はダイアログ内の種別選択でなく、実際に作成したタグの種別に従う
  const activeArtifact = activeTag?.endsWith('-epub') ? KINDS.epub.artifact : KINDS.nyuko.artifact

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ビルド</DialogTitle>
          <DialogDescription>
            タグを作成すると、GitHub Actions が{KINDS[kind].artifact}を生成して Release
            に添付します
          </DialogDescription>
        </DialogHeader>

        {phase === 'form' && (
          <div className="flex flex-col gap-3">
            {infoError && <p className="text-sm text-destructive">{infoError}</p>}
            <div className="flex gap-2">
              {(Object.keys(KINDS) as BuildKind[]).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={kind === k ? 'default' : 'outline'}
                  onClick={() => selectKind(k)}
                >
                  {KINDS[k].label}
                </Button>
              ))}
            </div>
            {nonDefaultBranch && (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                ビルドの対象はデフォルトブランチの最新コミットです。
                いま開いているブランチの内容は含まれません（PRをマージしてからビルドしてください）。
              </p>
            )}
            {dirty && (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                未保存の編集があります。タグはコミット済みの最新状態に付くため、
                いまの編集内容は成果物に含まれません。
              </p>
            )}
            <label className="flex flex-col gap-1 text-sm">
              {KINDS[kind].tagLabel}
              <Input
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder={KINDS[kind].placeholder}
              />
            </label>
            {info && info[kind].tags.length > 0 && (
              <p className="text-xs text-muted-foreground">
                これまでの{KINDS[kind].tagLabel}: {info[kind].tags.slice(0, 5).join(' / ')}
              </p>
            )}
            {tag.trim() !== '' && tagInvalid && (
              <p className="text-xs text-destructive">
                タグは「v0.3-{kind}」の形式で入力してください
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
              {activeArtifact}ができました（タグ {activeTag}）:
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
