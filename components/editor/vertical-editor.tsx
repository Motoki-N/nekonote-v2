'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BookOpen,
  FilePlus2,
  FileText,
  Info,
  Loader2,
  PanelLeft,
  PanelRight,
  Save,
  Settings,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  createChapter,
  getAllChapterContents,
  openChapter,
  saveChapter,
} from '@/lib/actions/editor'
import type { EditorChapter, EditorWorkspaceData } from '@/lib/actions/editor'
import {
  deleteDraft,
  draftKey,
  getDraft,
  listDraftKeys,
  setDraft,
} from '@/lib/editor/draft-store'
import type { Draft } from '@/lib/editor/draft-store'
import { buildPreviewHtml } from '@/lib/editor/preview'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EditorPane } from '@/components/editor/editor-pane'
import { MergePane } from '@/components/editor/merge-pane'
import { NewChapterDialog } from '@/components/editor/new-chapter-dialog'
import { PreviewPane } from '@/components/editor/preview-pane'
import { SaveDialog } from '@/components/editor/save-dialog'

// 待避（IndexedDB）とプレビュー再組版のデバウンス（SPEC-vertical-editor-phase2 §5.1・§7）
const DRAFT_DEBOUNCE_MS = 1000
const PREVIEW_DEBOUNCE_MS = 3000

/** 開いている章の書き込み基準。打鍵ごとに触るため state ではなく ref で持つ */
type CurrentChapter = {
  path: string
  /** 楽観ロックの基準 blob SHA（保存成功・マージ取り込みで前進） */
  baseSha: string
  /** 基準SHA時点のリモート本文（未保存判定・待避クリーンアップ用） */
  remoteContent: string
}

type MergeState = {
  remoteContent: string
  remoteSha: string
  localContent: string
}

/**
 * 縦書きエディタの本体（SPEC-vertical-editor-phase2 §3）。
 * 左=章一覧・中=入力ペイン（CodeMirror）・右=縦書きプレビュー（Vivliostyle）
 */
export function VerticalEditor({
  projectId,
  workspace,
  workspaceError,
}: {
  projectId: string
  workspace: EditorWorkspaceData | null
  workspaceError: string | null
}) {
  const ok = workspace && workspace.gate === 'ok' ? workspace : null

  const [chapters, setChapters] = useState<EditorChapter[]>(ok?.chapters ?? [])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [chapterLoading, setChapterLoading] = useState(false)
  const [chapterError, setChapterError] = useState<string | null>(null)
  /** エディタの作り直し用（章切替・復元・マージ取り込みでインクリメント） */
  const [editorEpoch, setEditorEpoch] = useState(0)
  /** エディタ作り直し時の初期本文（以後の打鍵は contentRef が正） */
  const [editorDoc, setEditorDoc] = useState('')
  const [dirty, setDirty] = useState(false)
  const [draftPaths, setDraftPaths] = useState<ReadonlySet<string>>(new Set())
  const [restorePrompt, setRestorePrompt] = useState<Draft | null>(null)
  const [merge, setMerge] = useState<MergeState | null>(null)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newChapterOpen, setNewChapterOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [typesetting, setTypesetting] = useState(false)
  const [fullPreview, setFullPreview] = useState(false)
  const [fullPreviewLoading, setFullPreviewLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [ratio, setRatio] = useState(0.5)
  const [dragging, setDragging] = useState(false)

  const currentRef = useRef<CurrentChapter | null>(null)
  const contentRef = useRef('')
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const splitRef = useRef<HTMLDivElement>(null)

  const keyFor = useCallback(
    (path: string) => (ok ? draftKey(ok.repo, ok.branch, path) : path),
    [ok],
  )

  // 未保存待避のある章に印をつける（SPEC §3.3）
  useEffect(() => {
    if (!ok) return
    const prefix = `${ok.repo}:${ok.branch}:`
    listDraftKeys(prefix)
      .then((keys) => setDraftPaths(new Set(keys.map((key) => key.slice(prefix.length)))))
      .catch(() => {
        // IndexedDB が使えない環境では印なしで動かす（待避はキャッシュ。正はGitHub）
      })
  }, [ok])

  const markDraft = useCallback((path: string, has: boolean) => {
    setDraftPaths((prev) => {
      if (prev.has(path) === has) return prev
      const next = new Set(prev)
      if (has) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  /** 現在の内容で待避を即時確定する（デバウンス中の分を落とさない） */
  const persistDraft = useCallback(() => {
    const current = currentRef.current
    if (!current) return
    const content = contentRef.current
    const key = keyFor(current.path)
    if (content === current.remoteContent) {
      deleteDraft(key).catch(() => {})
      markDraft(current.path, false)
    } else {
      setDraft(key, { content, baseSha: current.baseSha, updatedAt: Date.now() }).catch(() => {})
      markDraft(current.path, true)
    }
  }, [keyFor, markDraft])

  const flushDraft = useCallback(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current)
      draftTimerRef.current = null
    }
    persistDraft()
  }, [persistDraft])

  /** リポジトリルートのパス → 画像プロキシURL（SPEC §5.3。base_path 起点の相対に直して渡す） */
  const assetUrl = useCallback(
    (repoPath: string) => {
      const basePath = ok?.basePath ?? ''
      const relative =
        basePath !== '' && repoPath.startsWith(`${basePath}/`)
          ? repoPath.slice(basePath.length + 1)
          : repoPath
      return `${window.location.origin}/api/editor/asset?projectId=${projectId}&path=${encodeURIComponent(relative)}`
    },
    [ok, projectId],
  )

  const fileName = useCallback((path: string) => path.split('/').pop() ?? path, [])

  /** 部分プレビューの再組版（デバウンス済みの呼び出しのみ想定。SPEC §5.1） */
  const compilePreview = useCallback(() => {
    const current = currentRef.current
    if (!ok || !current) return
    const html = buildPreviewHtml({
      chapters: [{ path: current.path, content: contentRef.current }],
      theme: ok.theme,
      title: fileName(current.path),
      origin: window.location.origin,
      assetUrl,
    })
    setPreviewHtml(html)
    setTypesetting(true)
    setFullPreview(false)
  }, [ok, assetUrl, fileName])

  const onDocChange = useCallback(
    (content: string) => {
      const current = currentRef.current
      contentRef.current = content
      if (!current) return
      setDirty(content !== current.remoteContent)
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      draftTimerRef.current = setTimeout(persistDraft, DRAFT_DEBOUNCE_MS)
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
      previewTimerRef.current = setTimeout(compilePreview, PREVIEW_DEBOUNCE_MS)
    },
    [persistDraft, compilePreview],
  )

  // アンマウント時: タイマーを止め、待避を確定する
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
      persistDraft()
    }
  }, [persistDraft])

  /** 章を開く（SPEC §7 復元フロー込み） */
  const openChapterFlow = useCallback(
    async (path: string) => {
      if (!ok) return
      flushDraft()
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
      setSelectedPath(path)
      setChapterLoading(true)
      setChapterError(null)
      setRestorePrompt(null)
      setMerge(null)
      setDirty(false)
      try {
        const result = await openChapter(projectId, path)
        if (!result.ok || !result.data) {
          setChapterError(result.ok ? '章の読み込みに失敗しました' : result.error.message)
          currentRef.current = null
          return
        }
        const data = result.data
        currentRef.current = { path: data.path, baseSha: data.sha, remoteContent: data.content }
        contentRef.current = data.content

        const draft = await getDraft(keyFor(path)).catch(() => null)
        if (draft && draft.content !== data.content) {
          if (draft.baseSha !== data.sha) {
            // 待避中に他所が更新 → 競合フロー（SPEC §7-3 → §8）
            setMerge({
              remoteContent: data.content,
              remoteSha: data.sha,
              localContent: draft.content,
            })
          } else {
            setRestorePrompt(draft)
          }
        } else if (draft) {
          // リモートと同一の待避は不要（正は常にGitHub）
          deleteDraft(keyFor(path)).catch(() => {})
          markDraft(path, false)
        }
        setEditorDoc(data.content)
        setEditorEpoch((epoch) => epoch + 1)
        compilePreview()
      } finally {
        setChapterLoading(false)
      }
    },
    [ok, projectId, flushDraft, keyFor, markDraft, compilePreview],
  )

  /** 復元バナー: 待避を取り込む（SPEC §7-2） */
  const restoreDraft = useCallback(() => {
    const current = currentRef.current
    if (!current || !restorePrompt) return
    contentRef.current = restorePrompt.content
    setDirty(restorePrompt.content !== current.remoteContent)
    setRestorePrompt(null)
    setEditorDoc(restorePrompt.content)
    setEditorEpoch((epoch) => epoch + 1)
    compilePreview()
  }, [restorePrompt, compilePreview])

  /** 復元バナー: 待避を破棄する */
  const discardDraft = useCallback(() => {
    const current = currentRef.current
    if (!current) return
    deleteDraft(keyFor(current.path)).catch(() => {})
    markDraft(current.path, false)
    setRestorePrompt(null)
  }, [keyFor, markDraft])

  const requestSave = useCallback(() => {
    if (!currentRef.current || saving) return
    flushDraft()
    setSaveDialogOpen(true)
  }, [saving, flushDraft])

  /** 保存＝コミット（SPEC §6）。conflict はマージ支援へ（SPEC §8-1） */
  const confirmSave = useCallback(
    async (message: string) => {
      const current = currentRef.current
      if (!current) return
      setSaving(true)
      try {
        const result = await saveChapter(projectId, current.path, {
          content: contentRef.current,
          baseSha: current.baseSha,
          message,
        })
        if (!result.ok || !result.data) {
          if (!result.ok && result.error.code === 'conflict') {
            setSaveDialogOpen(false)
            const remote = await openChapter(projectId, current.path)
            if (remote.ok && remote.data) {
              setMerge({
                remoteContent: remote.data.content,
                remoteSha: remote.data.sha,
                localContent: contentRef.current,
              })
              toast.error('原稿がリモートで更新されています。差分を確認して取り込んでください')
            } else {
              toast.error('リモートの最新取得に失敗しました。もう一度保存してください')
            }
            return
          }
          toast.error(result.ok ? '保存に失敗しました' : result.error.message)
          return
        }
        // 新しい blob SHA を基準に進める（再取得なしの自己更新。SPEC §6）
        currentRef.current = {
          ...current,
          baseSha: result.data.blobSha,
          remoteContent: contentRef.current,
        }
        setDirty(false)
        deleteDraft(keyFor(current.path)).catch(() => {})
        markDraft(current.path, false)
        setSaveDialogOpen(false)
        toast.success('コミットしました')
        compilePreview()
      } finally {
        setSaving(false)
      }
    },
    [projectId, keyFor, markDraft, compilePreview],
  )

  /** マージ結果を編集へ取り込む（リモートSHAが新しい基準になる。SPEC §8） */
  const adoptMerge = useCallback(
    (merged: string) => {
      const current = currentRef.current
      if (!current || !merge) return
      currentRef.current = {
        ...current,
        baseSha: merge.remoteSha,
        remoteContent: merge.remoteContent,
      }
      contentRef.current = merged
      const isDirty = merged !== merge.remoteContent
      setDirty(isDirty)
      const key = keyFor(current.path)
      if (isDirty) {
        setDraft(key, { content: merged, baseSha: merge.remoteSha, updatedAt: Date.now() }).catch(
          () => {},
        )
        markDraft(current.path, true)
      } else {
        deleteDraft(key).catch(() => {})
        markDraft(current.path, false)
      }
      setMerge(null)
      setEditorDoc(merged)
      setEditorEpoch((epoch) => epoch + 1)
      compilePreview()
    },
    [merge, keyFor, markDraft, compilePreview],
  )

  /** ローカル編集を破棄してリモート最新を開き直す */
  const discardLocalForMerge = useCallback(() => {
    const current = currentRef.current
    if (!current) return
    deleteDraft(keyFor(current.path)).catch(() => {})
    markDraft(current.path, false)
    setMerge(null)
    void openChapterFlow(current.path)
  }, [keyFor, markDraft, openChapterFlow])

  /** 全体プレビュー（明示操作。SPEC §5.2） */
  const startFullPreview = useCallback(async () => {
    if (!ok) return
    flushDraft()
    setFullPreviewLoading(true)
    try {
      const result = await getAllChapterContents(projectId)
      if (!result.ok || !result.data) {
        toast.error(result.ok ? '全章の取得に失敗しました' : result.error.message)
        return
      }
      // 開いている章は編集中の内容を使う（保存前でも全体を確認できるように）
      const current = currentRef.current
      const chapterContents = result.data.chapters.map((chapter) =>
        current && chapter.path === current.path
          ? { path: chapter.path, content: contentRef.current }
          : chapter,
      )
      const html = buildPreviewHtml({
        chapters: chapterContents,
        theme: ok.theme,
        title: '全体プレビュー',
        origin: window.location.origin,
        assetUrl,
      })
      setPreviewHtml(html)
      setTypesetting(true)
      setFullPreview(true)
      setPreviewOpen(true)
    } finally {
      setFullPreviewLoading(false)
    }
  }, [ok, projectId, flushDraft, assetUrl])

  /** 新規章の作成＝コミット（SPEC §3.3） */
  const handleCreateChapter = useCallback(
    async (name: string) => {
      setCreating(true)
      try {
        const result = await createChapter(projectId, name)
        if (!result.ok || !result.data) {
          toast.error(result.ok ? '章の作成に失敗しました' : result.error.message)
          return
        }
        const path = result.data.path
        // entry へは自動追記しないため「entry未登録」として一覧の末尾に足す（SPEC §3.3）
        setChapters((prev) =>
          prev.some((chapter) => chapter.path === path)
            ? prev
            : [...prev, { path, inEntry: false }],
        )
        setNewChapterOpen(false)
        toast.success('章を作成してコミットしました')
        await openChapterFlow(path)
      } finally {
        setCreating(false)
      }
    },
    [projectId, openChapterFlow],
  )

  /** ペイン比率のドラッグ可変（SPEC §3.2） */
  const startDrag = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const container = splitRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    setDragging(true)
    const onMove = (e: PointerEvent) => {
      const next = (e.clientX - rect.left) / rect.width
      setRatio(Math.min(0.8, Math.max(0.25, next)))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  // ---- 前提未達（repo/PAT）の誘導表示（原稿タブと同じ作法） ----
  if (workspaceError) {
    return (
      <GuidanceCard>
        <p className="text-sm text-destructive">{workspaceError}</p>
        <p className="text-sm text-muted-foreground">
          PATの有効期限・対象リポジトリ設定と、プロジェクトのリポジトリ名を確認してください。
        </p>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings">設定をひらく</Link>}
        />
      </GuidanceCard>
    )
  }
  if (!workspace || workspace.gate === 'no_pat') {
    return (
      <GuidanceCard>
        <p className="text-sm text-foreground">
          エディタでの執筆には GitHub PAT の登録が必要です。
        </p>
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link href="/settings">
              <Settings data-icon="inline-start" />
              設定でPATを登録する
            </Link>
          }
        />
      </GuidanceCard>
    )
  }
  if (workspace.gate === 'no_repo') {
    return (
      <GuidanceCard>
        <p className="text-sm text-foreground">原稿リポジトリが設定されていません。</p>
        <p className="text-sm text-muted-foreground">
          ヘッダーの編集ボタン（鉛筆アイコン）から「原稿リポジトリ（owner/repo）」を設定してください。
        </p>
      </GuidanceCard>
    )
  }

  const selectedName = selectedPath ? fileName(selectedPath) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* エディタツールバー */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={sidebarOpen ? '章一覧を隠す' : '章一覧を表示'}
          className="text-muted-foreground"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <PanelLeft />
        </Button>
        {selectedName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="min-w-0 break-all">{selectedName}</span>
            {dirty && (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                role="status"
                aria-label="未保存の編集があります"
                title="未保存の編集があります"
              />
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            章を選んで執筆をはじめてください（保存するとコミットされます）
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={fullPreviewLoading || chapters.length === 0}
            onClick={() => void startFullPreview()}
          >
            {fullPreviewLoading ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <BookOpen data-icon="inline-start" />
            )}
            全体プレビュー
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={previewOpen ? 'プレビューを隠す' : 'プレビューを表示'}
            className="hidden text-muted-foreground lg:inline-flex"
            onClick={() => setPreviewOpen((open) => !open)}
          >
            <PanelRight />
          </Button>
          <Button
            size="sm"
            disabled={!selectedPath || !dirty || saving || merge !== null}
            onClick={requestSave}
          >
            <Save data-icon="inline-start" />
            保存
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 章一覧サイドバー（SPEC §3.3） */}
        {sidebarOpen && (
          <nav
            aria-label="章一覧"
            className={cn(
              'w-full shrink-0 overflow-y-auto border-border p-2 lg:block lg:w-60 lg:border-r',
              selectedPath !== null && 'hidden',
            )}
          >
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-xs text-muted-foreground">全{chapters.length}章</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="新しい章ファイルを作成"
                className="text-muted-foreground"
                onClick={() => setNewChapterOpen(true)}
              >
                <FilePlus2 />
              </Button>
            </div>
            {chapters.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                manuscripts/ 配下に章ファイル（.md）が見つかりません
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {chapters.map((chapter) => (
                  <li key={chapter.path}>
                    <button
                      type="button"
                      onClick={() => void openChapterFlow(chapter.path)}
                      aria-current={selectedPath === chapter.path ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        selectedPath === chapter.path
                          ? 'bg-secondary text-secondary-foreground'
                          : 'text-foreground hover:bg-secondary/50',
                      )}
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 break-all">{fileName(chapter.path)}</span>
                      {(draftPaths.has(chapter.path) ||
                        (chapter.path === selectedPath && dirty)) && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-primary"
                          title="未保存の待避があります"
                        />
                      )}
                      {!chapter.inEntry && (
                        <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
                          entry未登録
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        )}

        {/* 入力＋プレビュー（SPEC §3.2） */}
        <div
          ref={splitRef}
          className={cn(
            'min-w-0 flex-1 flex-col lg:flex-row',
            selectedPath === null && sidebarOpen ? 'hidden lg:flex' : 'flex',
          )}
        >
          {selectedPath === null ? (
            <p className="p-6 text-sm text-muted-foreground">
              左の一覧から章を選ぶと執筆をはじめられます
            </p>
          ) : (
            <>
              <div
                className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-none"
                style={previewOpen ? { flexBasis: `${ratio * 100}%` } : { flexBasis: '100%' }}
              >
                {/* モバイル: 一覧へ戻る */}
                <div className="flex items-center gap-2 border-b border-border px-2 py-1 lg:hidden">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="章一覧へ戻る"
                    className="text-muted-foreground"
                    onClick={() => {
                      flushDraft()
                      setSelectedPath(null)
                      currentRef.current = null
                      setPreviewHtml(null)
                      setMerge(null)
                      setRestorePrompt(null)
                      setDirty(false)
                      setSidebarOpen(true)
                    }}
                  >
                    <ArrowLeft />
                  </Button>
                  <span className="text-xs text-muted-foreground">章一覧へ戻る</span>
                </div>

                {restorePrompt && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground">
                    <Info className="size-4 shrink-0" />
                    <span className="min-w-0">
                      未保存の編集があります（
                      {new Date(restorePrompt.updatedAt).toLocaleString('ja-JP')} 時点）
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={discardDraft}>
                        破棄する
                      </Button>
                      <Button size="sm" onClick={restoreDraft}>
                        復元する
                      </Button>
                    </span>
                  </div>
                )}

                {chapterLoading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2
                      className="size-5 animate-spin text-muted-foreground"
                      aria-label="読み込み中"
                    />
                  </div>
                ) : chapterError ? (
                  <p className="p-4 text-sm text-destructive">{chapterError}</p>
                ) : merge ? (
                  <MergePane
                    remoteContent={merge.remoteContent}
                    localContent={merge.localContent}
                    onAdopt={adoptMerge}
                    onDiscardLocal={discardLocalForMerge}
                  />
                ) : (
                  <div className="min-h-0 flex-1">
                    <EditorPane
                      key={`${selectedPath}:${editorEpoch}`}
                      initialContent={editorDoc}
                      onDocChange={onDocChange}
                      onSaveRequest={requestSave}
                    />
                  </div>
                )}
              </div>

              {/* 比率ドラッグ用の仕切り（デスクトップのみ） */}
              {previewOpen && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="ペイン幅の調整"
                  className="hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 lg:block"
                  onPointerDown={startDrag}
                />
              )}

              {previewOpen && (
                <div
                  className={cn(
                    'hidden min-h-0 min-w-0 flex-1 flex-col border-border lg:flex',
                    dragging && 'pointer-events-none select-none',
                  )}
                >
                  {fullPreview && (
                    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
                      <Info className="size-3.5 shrink-0" />
                      <span className="min-w-0">
                        全体プレビュー（目次ページは入稿ビルドでのみ生成されます。扉・奥付の専用様式は章単体プレビューで確認してください）
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto shrink-0"
                        onClick={compilePreview}
                      >
                        編集中の章に戻る
                      </Button>
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <PreviewPane
                      html={previewHtml}
                      typesetting={typesetting}
                      onLoaded={() => setTypesetting(false)}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <SaveDialog
        open={saveDialogOpen}
        defaultMessage={
          selectedName ? `執筆: ${selectedName} を更新（ネコノテAI 縦書きエディタ）` : ''
        }
        saving={saving}
        onConfirm={(message) => void confirmSave(message)}
        onOpenChange={setSaveDialogOpen}
      />
      <NewChapterDialog
        open={newChapterOpen}
        creating={creating}
        onCreate={(name) => void handleCreateChapter(name)}
        onOpenChange={setNewChapterOpen}
      />
    </div>
  )
}

function GuidanceCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-start gap-3 rounded-lg border border-border bg-card p-4">
        {children}
      </div>
    </div>
  )
}
