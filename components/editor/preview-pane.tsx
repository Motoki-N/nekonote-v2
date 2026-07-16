'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'

import { viewerUrl } from '@/lib/editor/preview'

/**
 * プレビューペイン（SPEC-vertical-editor-phase2 §5.1）。
 * 組版済みHTMLをBlob URL化し、自前ホストの Vivliostyle Viewer（iframe）に読ませる。
 * iframe内の組版CSSは書籍テーマが正であり、アプリのライト/ダークに追従させない（規約の例外）
 */
export function PreviewPane({
  html,
  typesetting,
  onLoaded,
  onPageCount,
}: {
  /** 組版対象の完成HTML。null はまだ章を開いていない状態 */
  html: string | null
  /** 組版中インジケータ（親が変換開始で立て、iframe ロードで下ろす） */
  typesetting: boolean
  onLoaded: () => void
  /** 組版が落ち着いた時点の実ページ数（SPEC-phase3 §5。取得できない環境では呼ばれない） */
  onPageCount?: (pages: number) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // 読み込み完了前に revoke すると Viewer の取得が失敗するため、旧URLはロード完了まで保持する
  const currentUrlRef = useRef<string | null>(null)
  const staleUrlsRef = useRef<string[]>([])
  const pagePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onPageCountRef = useRef(onPageCount)
  useEffect(() => {
    onPageCountRef.current = onPageCount
  }, [onPageCount])

  /**
   * 実ページ数の取得: Viewer は自前ホスト（同一オリジン）なので iframe 内の
   * ページ番号表示を読める。組版は非同期・段階的に進むため、Viewer のステータスが
   * complete になるまで待ってから総ページ数を報告する（途中の値で確定させない）
   */
  const startPagePolling = useCallback(() => {
    if (pagePollRef.current) clearInterval(pagePollRef.current)
    let ticks = 0
    pagePollRef.current = setInterval(() => {
      ticks += 1
      const doc = iframeRef.current?.contentDocument
      const status = doc
        ?.querySelector('[data-vivliostyle-viewer-viewport]')
        ?.getAttribute('data-vivliostyle-viewer-status')
      if (status === 'complete') {
        // Viewer は表示外ページを間引くことがあるため、コンテナ数でなく総ページ表示を読む
        const total = Number(doc?.querySelector('#vivliostyle-total-pages')?.textContent ?? '')
        if (pagePollRef.current) clearInterval(pagePollRef.current)
        pagePollRef.current = null
        if (Number.isInteger(total) && total > 0) onPageCountRef.current?.(total)
        return
      }
      // 最長60秒で打ち切り（巨大原稿・組版失敗時にポーリングを残さない）
      if (ticks >= 120) {
        if (pagePollRef.current) clearInterval(pagePollRef.current)
        pagePollRef.current = null
      }
    }, 500)
  }, [])

  useEffect(() => {
    if (html === null || !iframeRef.current) return
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    if (currentUrlRef.current) staleUrlsRef.current.push(currentUrlRef.current)
    currentUrlRef.current = url
    iframeRef.current.src = viewerUrl(url)
  }, [html])

  useEffect(() => {
    const stale = staleUrlsRef.current
    return () => {
      for (const url of stale) URL.revokeObjectURL(url)
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current)
      if (pagePollRef.current) clearInterval(pagePollRef.current)
    }
  }, [])

  const handleLoad = useCallback(() => {
    for (const url of staleUrlsRef.current) URL.revokeObjectURL(url)
    staleUrlsRef.current = []
    onLoaded()
    startPagePolling()
  }, [onLoaded, startPagePolling])

  return (
    <div className="relative h-full min-h-0">
      {html === null ? (
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">章を開くと縦書きプレビューが表示されます</p>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          title="縦書きプレビュー"
          className="h-full w-full border-0"
          onLoad={handleLoad}
        />
      )}
      {typesetting && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm ring-1 ring-border">
            <Loader2 className="size-3 animate-spin" />
            組版中…
          </span>
        </div>
      )}
    </div>
  )
}
