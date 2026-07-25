'use client'

import { useEffect, useRef, useState } from 'react'

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { publishZennArticle, saveZennArticle } from '@/lib/actions/zenn'
import { zennArticleInputSchema } from '@/lib/schemas/zenn'
import { Button } from '@/components/ui/button'
import { FrontmatterForm } from '@/components/zenn/frontmatter-form'
import type { ZennFrontmatterValue } from '@/components/zenn/frontmatter-form'
import { PublishDialog } from '@/components/zenn/publish-dialog'
import { buildZennEditorExtensions } from '@/components/zenn/zenn-codemirror'
import { ZennPreview } from '@/components/zenn/zenn-preview'

/** slug 自動生成（Zenn仕様 12〜50字を満たす hex 14字。SPEC-zenn-integration §2） */
function generateSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 14)
}

/** カンマ（半角・全角・読点）区切りのトピック入力を配列化する */
function parseTopics(text: string): string[] {
  return text
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

/**
 * Zenn記事投稿ワークスペース（SPEC-zenn-integration §3.2）。
 * 記事本文はDBに持たず、保存＝Zenn連携リポジトリへのコミット。
 * 初回投稿後は同一画面での再保存（再コミット・baseSha楽観ロック）のみ可
 */
export function ZennWorkspace({ repo, initialSlug }: { repo: string; initialSlug: string }) {
  const [frontmatter, setFrontmatter] = useState<ZennFrontmatterValue>({
    title: '',
    emoji: '📝',
    type: 'tech',
    topicsText: '',
    slug: initialSlug,
    published: false,
  })
  const [body, setBody] = useState('')
  // 投稿済みなら blob SHA（楽観ロック基準）。null = 未投稿
  const [baseSha, setBaseSha] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const path = `articles/${frontmatter.slug}.md`

  // 未保存のまま離脱しそうなときの警告（IndexedDB待避はスコープ外。SPEC §9）
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 旧Chrome互換（preventDefault のみでは警告が出ない環境がある）
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function updateFrontmatter(patch: Partial<ZennFrontmatterValue>) {
    setFrontmatter((prev) => ({ ...prev, ...patch }))
    setDirty(true)
  }

  function buildInput() {
    return {
      slug: frontmatter.slug,
      title: frontmatter.title,
      emoji: frontmatter.emoji,
      type: frontmatter.type,
      topics: parseTopics(frontmatter.topicsText),
      published: frontmatter.published,
      body,
    }
  }

  /** 保存ボタン・Cmd+S。クライアント側で事前検証してから確認ダイアログを開く */
  function requestSave() {
    if (saving) return
    const check = zennArticleInputSchema.safeParse(buildInput())
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? '入力内容を確認してください')
      return
    }
    setError(null)
    setConfirmOpen(true)
  }

  /** 確認ダイアログの実行。初回=新規作成コミット、以降=baseSha楽観ロックの再コミット */
  async function handleConfirmedSave() {
    setConfirmOpen(false)
    setSaving(true)
    setError(null)
    try {
      const input = buildInput()
      const result = baseSha
        ? await saveZennArticle({ ...input, baseSha })
        : await publishZennArticle(input)
      if (!result.ok || !result.data) {
        const message = result.ok ? '保存に失敗しました' : result.error.message
        setError(message)
        toast.error(message)
        return
      }
      setBaseSha(result.data.blobSha)
      setDirty(false)
      toast(`${repo}/${path} にコミットしました`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">Zennへ投稿</h1>
        <span className="text-xs text-muted-foreground">連携リポジトリ: {repo}</span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={frontmatter.published}
              onChange={(e) => updateFrontmatter({ published: e.target.checked })}
            />
            公開する（published: true）
          </label>
          <Button size="sm" onClick={requestSave} disabled={saving}>
            {saving && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {saving ? 'コミット中…' : baseSha ? '再コミット' : '投稿する'}
          </Button>
        </div>
      </header>

      <div className="border-b border-border px-4 py-3 sm:px-6">
        <FrontmatterForm
          value={frontmatter}
          onChange={updateFrontmatter}
          slugLocked={baseSha !== null}
          onRegenerateSlug={() => updateFrontmatter({ slug: generateSlug() })}
        />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {baseSha && !dirty && (
          <p className="mt-2 text-xs text-muted-foreground">
            投稿済み: {repo}/{path}（編集して再コミットできます）
          </p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <div className="min-h-64 border-b border-border lg:border-b-0 lg:border-r">
          <ZennEditorPane
            initialContent=""
            onDocChange={(content) => {
              setBody(content)
              setDirty(true)
            }}
            onSaveRequest={requestSave}
          />
        </div>
        <div className="min-h-64">
          <ZennPreview body={body} />
        </div>
      </div>

      <PublishDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        repo={repo}
        path={path}
        published={frontmatter.published}
        isUpdate={baseSha !== null}
        onConfirm={() => void handleConfirmedSave()}
      />
    </div>
  )
}

/**
 * 入力ペイン。CodeMirror の生成・破棄のみを担う（components/editor/editor-pane.tsx と同型。
 * ハンドラは ref 経由で参照し、親の再レンダーでエディタを作り直さない）
 */
function ZennEditorPane({
  initialContent,
  onDocChange,
  onSaveRequest,
}: {
  initialContent: string
  onDocChange: (content: string) => void
  onSaveRequest: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handlersRef = useRef({ onDocChange, onSaveRequest })
  useEffect(() => {
    handlersRef.current = { onDocChange, onSaveRequest }
  }, [onDocChange, onSaveRequest])

  useEffect(() => {
    if (!containerRef.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: initialContent,
        extensions: buildZennEditorExtensions({
          onDocChange: (content) => handlersRef.current.onDocChange(content),
          onSaveRequest: () => handlersRef.current.onSaveRequest(),
        }),
      }),
      parent: containerRef.current,
    })
    return () => {
      view.destroy()
    }
    // initialContent は初期値のみ（変更で作り直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="h-full min-h-0" aria-label="記事本文の入力ペイン" />
}
