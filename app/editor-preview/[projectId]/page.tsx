'use client'

import { use, useEffect, useRef, useState } from 'react'

import { PreviewPane } from '@/components/editor/preview-pane'
import { previewChannelName } from '@/lib/editor/preview-channel'
import type { PreviewChannelMessage } from '@/lib/editor/preview-channel'

/**
 * 分離プレビューウィンドウ（Issue #72）。
 * エディタから BroadcastChannel で受け取った組版済みHTMLを PreviewPane で表示する。
 * データ取得は行わない——HTML内の画像はエディタと同じ認証プロキシURLを指しており、
 * 同一ブラウザのCookieで解決される
 */
export default function DetachedPreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = use(params)
  const [html, setHtml] = useState<string | null>(null)
  const [typesetting, setTypesetting] = useState(false)
  const fullRef = useRef(false)
  const lastHtmlRef = useRef<string | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const channel = new BroadcastChannel(previewChannelName(projectId))
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<PreviewChannelMessage>) => {
      const message = event.data
      if (message.type === 'hello') {
        // エディタ側のリロード・再起動 → 再接続を申し出る（エディタが現在のHTMLを送り直す）
        channel.postMessage({ type: 'ready' } satisfies PreviewChannelMessage)
        return
      }
      if (message.type !== 'document') return
      fullRef.current = message.full
      document.title = `${message.title} — 縦書きプレビュー`
      // 同一HTMLの再送（ready への応答等）では iframe が再ロードされず onLoaded も
      // 来ないため、組版中表示を立てない
      if (message.html !== lastHtmlRef.current) {
        lastHtmlRef.current = message.html
        setHtml(message.html)
        setTypesetting(true)
      }
    }
    // エディタ側へ現在のプレビューの送信を求める（開いた直後・リロード時）
    channel.postMessage({ type: 'ready' } satisfies PreviewChannelMessage)
    const notifyClosed = () =>
      channel.postMessage({ type: 'closed' } satisfies PreviewChannelMessage)
    window.addEventListener('pagehide', notifyClosed)
    return () => {
      window.removeEventListener('pagehide', notifyClosed)
      channel.close()
      channelRef.current = null
    }
  }, [projectId])

  return (
    <div className="h-dvh min-h-0">
      {html === null ? (
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            エディタで章を開くと、ここに縦書きプレビューが表示されます
          </p>
        </div>
      ) : (
        <PreviewPane
          html={html}
          typesetting={typesetting}
          onLoaded={() => setTypesetting(false)}
          onPageCount={(total) =>
            channelRef.current?.postMessage({
              type: 'pages',
              total,
              full: fullRef.current,
            } satisfies PreviewChannelMessage)
          }
        />
      )}
    </div>
  )
}
