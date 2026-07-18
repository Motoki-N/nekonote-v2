'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BookOpen,
  BookOpenText,
  ExternalLink,
  FilePlus2,
  FileText,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelRight,
  PictureInPicture2,
  Save,
  Settings,
  SpellCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  createChapter,
  getAllChapterContents,
  getEditorWorkspace,
  openChapter,
  saveChapter,
  uploadImage,
} from '@/lib/actions/editor'
import type { EditorChapter, EditorWorkspaceData } from '@/lib/actions/editor'
import {
  openManuscriptFile,
  updateSuggestionStatus,
  type ManuscriptFileData,
} from '@/lib/actions/manuscripts'
import type { SuggestionStatus } from '@/lib/schemas/enums'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { extractComments } from '@/lib/editor/comments'
import type { ManuscriptComment } from '@/lib/editor/comments'
import {
  deleteDraft,
  draftKey,
  getDraft,
  listDraftKeys,
  setDraft,
} from '@/lib/editor/draft-store'
import type { Draft } from '@/lib/editor/draft-store'
import { fileToBase64, illustNotation, sanitizeImageFileName } from '@/lib/editor/image'
import { buildPreviewHtml } from '@/lib/editor/preview'
import { detachedPreviewUrl, previewChannelName } from '@/lib/editor/preview-channel'
import type { PreviewChannelMessage } from '@/lib/editor/preview-channel'
import { countManuscriptChars, estimatePages, extractKumiSettings } from '@/lib/editor/word-count'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useChrome } from '@/components/layout/app-chrome'
import { CritiquePanel } from '@/components/manuscript/critique-panel'
import { ProofreadPanel } from '@/components/manuscript/proofread-panel'
import { BuildDialog } from '@/components/editor/build-dialog'
import { EditorPane } from '@/components/editor/editor-pane'
import { EditorToolbar } from '@/components/editor/editor-toolbar'
import { ImageUploadDialog } from '@/components/editor/image-upload-dialog'
import type { IllustKind } from '@/components/editor/image-upload-dialog'
import { MergePane } from '@/components/editor/merge-pane'
import { NewChapterDialog } from '@/components/editor/new-chapter-dialog'
import { PreviewPane } from '@/components/editor/preview-pane'
import { SaveDialog } from '@/components/editor/save-dialog'
import { SettingsDialog } from '@/components/editor/settings-dialog'

// 待避（IndexedDB）とプレビュー再組版のデバウンス（SPEC-vertical-editor-phase2 §5.1・§7）
const DRAFT_DEBOUNCE_MS = 1000
const PREVIEW_DEBOUNCE_MS = 3000
// 字数カウントのデバウンス（SPEC-vertical-editor-phase3 §5）
const COUNT_DEBOUNCE_MS = 500

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
  initialFile,
}: {
  projectId: string
  workspace: EditorWorkspaceData | null
  workspaceError: string | null
  /** ?file= での初期章選択（原稿タブからの相互リンク。章一覧に無いパスは無視する。SPEC-phase4 §3.1） */
  initialFile: string | null
}) {
  // 設定フォームのコミット後にテーマ・章一覧を取り直すため state で持つ（初期値はサーバー）
  const [ws, setWs] = useState<EditorWorkspaceData | null>(workspace)
  const ok = ws && ws.gate === 'ok' ? ws : null

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [buildOpen, setBuildOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [typesetting, setTypesetting] = useState(false)
  const [fullPreview, setFullPreview] = useState(false)
  const [fullPreviewLoading, setFullPreviewLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(true)
  /** プレビューを別ウィンドウへ分離中か（Issue #72。分離中はインラインのプレビューを畳む） */
  const [detached, setDetached] = useState(false)
  /** 分離窓からの ready（初回・リロード）で現在のHTMLを送り直すためのトリガー */
  const [resendTick, setResendTick] = useState(0)
  const [ratio, setRatio] = useState(0.5)
  const [dragging, setDragging] = useState(false)
  /** 本文の字数（コメント・記法除外。SPEC-phase3 §5）。null は章未選択 */
  const [charCount, setCharCount] = useState<number | null>(null)
  /** Vivliostyle が組んだ実ページ数（編集で無効化→概算値へ戻す） */
  const [actualPages, setActualPages] = useState<number | null>(null)
  /** 編集中の章のコメント一覧（SPEC-phase3 §3） */
  const [comments, setComments] = useState<ManuscriptComment[]>([])
  const [sidebarTab, setSidebarTab] = useState<'chapters' | 'comments'>('chapters')
  /** 画像アップロードの対象（D&D またはツールバーから。SPEC-phase3 §6） */
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  /** 集中モード: 入力ペイン（＋開いていればプレビュー）以外のクロームをすべて隠す */
  const [focusMode, setFocusMode] = useState(false)
  /** エディタ内レビューパネル（Issue #18。校正は開いている章、講評は作品全体が対象） */
  const [reviewOpen, setReviewOpen] = useState<'proofread' | 'critique' | null>(null)
  /** 校正パネルに渡す原稿情報（openManuscriptFile の結果。コミット済み内容が正） */
  const [reviewFile, setReviewFile] = useState<ManuscriptFileData | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const { setHidden: setChromeHidden } = useChrome()

  // グローバルナビ＋プロジェクトヘッダーの表示を集中モードに同期（離脱時は必ず復帰させる）
  useEffect(() => {
    setChromeHidden(focusMode)
    return () => setChromeHidden(false)
  }, [focusMode, setChromeHidden])

  // Esc で集中モードを解除
  useEffect(() => {
    if (!focusMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusMode])

  const currentRef = useRef<CurrentChapter | null>(null)
  const contentRef = useRef('')
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const splitRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<Window | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  /** previewHtml と対になる表示名（組版時点で確定。章切替中に古いHTMLへ新タイトルが付くのを防ぐ） */
  const previewTitleRef = useRef('プレビュー')
  const editorViewRef = useRef<EditorView | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  /** 未保存編集ありで校正を押した場合の「保存後に校正パネルを開く」予約 */
  const pendingProofreadRef = useRef(false)
  /** レビューパネルを閉じたときに戻すプレビュー表示状態（開く前の値を覚える） */
  const prevPreviewOpenRef = useRef(true)

  /** 版面（行数×字詰め）: テーマCSSから抽出。ページ数概算に使う */
  const kumi = useMemo(() => (ok ? extractKumiSettings(ok.theme.inlineCss) : null), [ok])

  // compilePreview が設定コミット直後の新テーマを拾えるよう ref でも持つ
  const okRef = useRef(ok)
  useEffect(() => {
    okRef.current = ok
  }, [ok])

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
    const okNow = okRef.current
    if (!okNow || !current) return
    const html = buildPreviewHtml({
      chapters: [{ path: current.path, content: contentRef.current }],
      theme: okNow.theme,
      title: fileName(current.path),
      origin: window.location.origin,
      assetUrl,
    })
    previewTitleRef.current = fileName(current.path)
    setPreviewHtml(html)
    setTypesetting(true)
    setFullPreview(false)
  }, [assetUrl, fileName])

  /** 字数・コメント一覧を内容から再計算する（打鍵側はデバウンスして呼ぶ） */
  const refreshDerived = useCallback((content: string) => {
    setCharCount(countManuscriptChars(content))
    setComments(extractComments(content))
  }, [])
  const recount = useCallback(() => refreshDerived(contentRef.current), [refreshDerived])

  const onDocChange = useCallback(
    (content: string) => {
      const current = currentRef.current
      contentRef.current = content
      if (!current) return
      setDirty(content !== current.remoteContent)
      // 編集で実ページ数は古くなる → 概算値表示へ戻す（次の組版完了で再取得）
      setActualPages(null)
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      draftTimerRef.current = setTimeout(persistDraft, DRAFT_DEBOUNCE_MS)
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
      previewTimerRef.current = setTimeout(compilePreview, PREVIEW_DEBOUNCE_MS)
      if (countTimerRef.current) clearTimeout(countTimerRef.current)
      countTimerRef.current = setTimeout(recount, COUNT_DEBOUNCE_MS)
    },
    [persistDraft, compilePreview, recount],
  )

  // アンマウント時: タイマーを止め、待避を確定する
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
      if (countTimerRef.current) clearTimeout(countTimerRef.current)
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
        refreshDerived(data.content)
        setActualPages(null)

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
    [ok, projectId, flushDraft, keyFor, markDraft, compilePreview, refreshDerived],
  )

  // ?file= の初期章選択（初回のみ。章一覧との一致でのみ採用する多層防御。SPEC-phase4 §3.1）。
  // openChapterFlow は同期 setState を含むため、effect 本体から直接呼ばずタイマー経由で呼ぶ
  const initialChapterRef = useRef(
    initialFile && (ok?.chapters.some((chapter) => chapter.path === initialFile) ?? false)
      ? initialFile
      : null,
  )
  useEffect(() => {
    if (initialChapterRef.current === null) return
    const timer = setTimeout(() => {
      const path = initialChapterRef.current
      initialChapterRef.current = null
      if (path !== null) void openChapterFlow(path)
    }, 0)
    return () => clearTimeout(timer)
  }, [openChapterFlow])

  /** 復元バナー: 待避を取り込む（SPEC §7-2） */
  const restoreDraft = useCallback(() => {
    const current = currentRef.current
    if (!current || !restorePrompt) return
    contentRef.current = restorePrompt.content
    setDirty(restorePrompt.content !== current.remoteContent)
    refreshDerived(restorePrompt.content)
    setRestorePrompt(null)
    setEditorDoc(restorePrompt.content)
    setEditorEpoch((epoch) => epoch + 1)
    compilePreview()
  }, [restorePrompt, compilePreview, refreshDerived])

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

  // ---- エディタ内レビューパネル（Issue #18） ----

  /** レビューパネルを開く（lg以上ではプレビューと入れ替え、閉じたら元の表示状態へ戻す） */
  const openReviewPanel = useCallback(
    (panel: 'proofread' | 'critique') => {
      if (reviewOpen === null) prevPreviewOpenRef.current = previewOpen
      setReviewOpen(panel)
      setPreviewOpen(false)
    },
    [reviewOpen, previewOpen],
  )

  const closeReviewPanel = useCallback(() => {
    setReviewOpen(null)
    setReviewFile(null)
    setReviewError(null)
    // パネル表示中に明示操作（全体プレビュー等）で開き直していた場合は上書きしない
    setPreviewOpen((open) => open || prevPreviewOpenRef.current)
  }, [])

  /** 校正パネルを開く。校正はコミット済み内容が対象のため、未保存の編集は先に保存へ誘導する */
  const openProofread = useCallback(async () => {
    const current = currentRef.current
    if (!current) return
    if (contentRef.current !== current.remoteContent) {
      pendingProofreadRef.current = true
      toast.info('未保存の編集があります。保存（コミット）すると校正パネルを開きます')
      requestSave()
      return
    }
    openReviewPanel('proofread')
    // 前回開いた章の原稿情報が残っていると、フェッチ完了まで別の章の提案を誤操作できてしまう
    setReviewFile(null)
    setReviewLoading(true)
    setReviewError(null)
    try {
      const result = await openManuscriptFile(projectId, current.path)
      if (!result.ok || !result.data) {
        setReviewFile(null)
        setReviewError(result.ok ? '原稿情報の読み込みに失敗しました' : result.error.message)
        return
      }
      setReviewFile(result.data)
    } finally {
      setReviewLoading(false)
    }
  }, [projectId, requestSave, openReviewPanel])

  /** 提案の受入/拒否/保留（原稿タブと同じ作法で、成功時はローカルの提案一覧のみ差し替える） */
  const handleUpdateSuggestion = useCallback(async (id: string, status: SuggestionStatus) => {
    const result = await updateSuggestionStatus(id, status)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setReviewFile((prev) =>
      prev
        ? {
            ...prev,
            suggestions: prev.suggestions.map((s) => (s.id === id ? { ...s, status } : s)),
          }
        : prev,
    )
  }, [])

  /** 提案カードクリック → エディタの該当箇所を選択してスクロール */
  const locateInEditor = useCallback((originalText: string) => {
    const view = editorViewRef.current
    if (!view) return
    const doc = view.state.doc.toString()
    const idx = originalText === '' ? -1 : doc.indexOf(originalText)
    if (idx === -1) {
      toast.error('該当箇所がエディタ内に見つかりません（原稿が更新された可能性があります）')
      return
    }
    view.dispatch({
      selection: EditorSelection.range(idx, idx + originalText.length),
      effects: EditorView.scrollIntoView(idx, { y: 'center' }),
    })
    view.focus()
  }, [])

  /**
   * 校正完了・コミット完了後の取り直し。「まとめてコミット」「保留の書き戻し」はGitHubに
   * コミットを作るため、エディタが未編集ならリモート最新を開き直して baseSha を進める
   * （追従しないと次の保存が必ず競合フローに入る）
   */
  const refreshReview = useCallback(async () => {
    const current = currentRef.current
    if (!current) return
    const result = await openManuscriptFile(projectId, current.path)
    // 取得待ちの間に章が切り替わっていたら、古い章の情報で上書きしない
    if (currentRef.current?.path !== current.path) return
    if (!result.ok || !result.data) {
      toast.error(result.ok ? '原稿情報の再取得に失敗しました' : result.error.message)
      return
    }
    setReviewFile(result.data)
    if (result.data.content === current.remoteContent) return
    if (contentRef.current !== current.remoteContent) {
      // パネルを開いたまま編集が進んでいた場合。次の保存で差分の取り込みフローに入る
      toast.warning(
        '校正の反映で原稿が更新されました。未保存の編集は保存時に差分の取り込みが必要になります',
      )
      return
    }
    await openChapterFlow(current.path)
  }, [projectId, openChapterFlow])

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
            // 競合時は「保存後に校正パネルを開く」予約も落とす（後日の無関係な保存で開かないように）
            pendingProofreadRef.current = false
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
        // 校正ボタン起点の保存だった場合は、そのまま校正パネルを開く（Issue #18）
        if (pendingProofreadRef.current) {
          pendingProofreadRef.current = false
          void openProofread()
        }
      } finally {
        setSaving(false)
      }
    },
    [projectId, keyFor, markDraft, compilePreview, openProofread],
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
      refreshDerived(merged)
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
    [merge, keyFor, markDraft, compilePreview, refreshDerived],
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
      previewTitleRef.current = '全体プレビュー'
      setPreviewHtml(html)
      setTypesetting(true)
      setFullPreview(true)
      setPreviewOpen(true)
    } finally {
      setFullPreviewLoading(false)
    }
  }, [ok, projectId, flushDraft, assetUrl])

  /** 新規章の作成＝コミット（SPEC §3.3。entry へは自動追記される。SPEC-phase3 §7-2） */
  const handleCreateChapter = useCallback(
    async (name: string) => {
      setCreating(true)
      try {
        const result = await createChapter(projectId, name)
        if (!result.ok || !result.data) {
          toast.error(result.ok ? '章の作成に失敗しました' : result.error.message)
          return
        }
        const { path, inEntry } = result.data
        setChapters((prev) =>
          prev.some((chapter) => chapter.path === path) ? prev : [...prev, { path, inEntry }],
        )
        setNewChapterOpen(false)
        toast.success(
          inEntry
            ? '章を作成し、entry に追記してコミットしました'
            : '章を作成してコミットしました（entry への追記はできませんでした）',
        )
        await openChapterFlow(path)
      } finally {
        setCreating(false)
      }
    },
    [projectId, openChapterFlow],
  )

  /** 設定コミット後の再取得（章一覧の順序・テーマCSSに反映。SPEC-phase3 §7） */
  const refreshWorkspace = useCallback(async () => {
    const result = await getEditorWorkspace(projectId)
    if (result.ok && result.data) {
      setWs(result.data)
      if (result.data.gate === 'ok') {
        setChapters(result.data.chapters)
        okRef.current = result.data
      }
    }
  }, [projectId])

  const handleSettingsSaved = useCallback(() => {
    void refreshWorkspace().then(() => {
      // 新しいテーマ（組み設定）でプレビューを組み直す
      if (currentRef.current) compilePreview()
    })
  }, [refreshWorkspace, compilePreview])

  /**
   * 画像アップロードの実行（SPEC-phase3 §6・論点C）。
   * images/ へ即コミット → カーソル位置に挿入記法を追記（本文は通常の保存フロー）
   */
  const confirmImageUpload = useCallback(
    async ({ kind, caption }: { kind: IllustKind; caption: string }) => {
      const file = pendingImage
      if (!file) return
      setUploadingImage(true)
      try {
        const base64 = await fileToBase64(file)
        const result = await uploadImage(projectId, sanitizeImageFileName(file.name), base64)
        if (!result.ok || !result.data) {
          toast.error(result.ok ? '画像のアップロードに失敗しました' : result.error.message)
          return
        }
        const view = editorViewRef.current
        if (view) {
          const pos = view.state.selection.main.from
          // 挿絵は独立した段落として前後を空行で区切る
          const insert = `\n\n${illustNotation(result.data.fileName, kind, caption)}\n\n`
          view.dispatch({
            changes: { from: pos, insert },
            selection: EditorSelection.cursor(pos + insert.length),
            scrollIntoView: true,
            userEvent: 'input',
          })
          view.focus()
        }
        setPendingImage(null)
        toast.success(`画像 ${result.data.fileName} をコミットしました`)
      } catch {
        toast.error('画像の読み込みに失敗しました')
      } finally {
        setUploadingImage(false)
      }
    },
    [pendingImage, projectId],
  )

  /** コメント一覧から該当箇所へジャンプ（SPEC-phase3 §3。選択で一時的に目立たせる） */
  const jumpToComment = useCallback((comment: ManuscriptComment) => {
    const view = editorViewRef.current
    if (!view) return
    // 一覧はデバウンス更新のため、直後の編集でオフセットが範囲外になり得る
    const docLength = view.state.doc.length
    const from = Math.min(comment.from, docLength)
    const to = Math.min(comment.to, docLength)
    view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    })
    view.focus()
  }, [])

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

  // ---- プレビューの別ウィンドウ分離（Issue #72） ----

  // 分離窓との通信チャンネル。窓のリロード時の ready も拾えるよう、常時張っておく
  useEffect(() => {
    const channel = new BroadcastChannel(previewChannelName(projectId))
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<PreviewChannelMessage>) => {
      const message = event.data
      if (message.type === 'ready') {
        // 窓側の準備完了（URL直開き・リロード含む）→ 分離モードにして現在のHTMLを送る
        setDetached(true)
        setResendTick((tick) => tick + 1)
      } else if (message.type === 'pages') {
        // 実ページ数は編集章の部分プレビューのみ反映（インライン時と同じ条件）
        if (!message.full) setActualPages(message.total)
      } else if (message.type === 'closed') {
        setDetached(false)
      }
    }
    // リロード等で開いたままの分離窓があれば再接続させる（窓が ready を返す）
    channel.postMessage({ type: 'hello' } satisfies PreviewChannelMessage)
    return () => {
      channel.close()
      channelRef.current = null
      // エディタを離れたら分離窓も閉じる（宙に浮いた古いプレビューを残さない）
      popupRef.current?.close()
      popupRef.current = null
    }
  }, [projectId])

  // 分離中はプレビューHTMLの更新を窓へ送る（再組版は窓側の Viewer が行う）
  useEffect(() => {
    if (!detached || previewHtml === null) return
    channelRef.current?.postMessage({
      type: 'document',
      html: previewHtml,
      full: fullPreview,
      title: previewTitleRef.current,
    } satisfies PreviewChannelMessage)
  }, [detached, previewHtml, fullPreview, resendTick])

  // pagehide が飛ばない閉じ方（プロセス終了等）への保険として閉窓をポーリング検知
  useEffect(() => {
    if (!detached) return
    const timer = setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null
        setDetached(false)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [detached])

  const toggleDetachedPreview = useCallback(() => {
    if (detached) {
      popupRef.current?.close()
      popupRef.current = null
      setDetached(false)
      return
    }
    // 同名ウィンドウは再利用される（多重に開かない）。popup 指定でタブでなく独立ウィンドウに
    const popup = window.open(
      detachedPreviewUrl(projectId),
      `nekonote-preview-${projectId}`,
      'popup=yes,width=900,height=1000',
    )
    if (!popup) {
      toast.error('ポップアップがブロックされました。ブラウザの設定で許可してください')
      return
    }
    popupRef.current = popup
    setDetached(true)
  }, [detached, projectId])

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
  if (!ws || ws.gate === 'no_pat') {
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
  if (ws.gate === 'no_repo') {
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 集中モード中のフローティング操作（半透明。Escでも解除できる） */}
      {focusMode && (
        <div className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-md border border-border bg-background/80 p-1 shadow-sm backdrop-blur">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedPath || saving || merge !== null}
              onClick={requestSave}
            >
              <Save data-icon="inline-start" />
              保存
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="集中モードを終了（Esc）"
            title="集中モードを終了（Esc）"
            className="text-muted-foreground"
            onClick={() => setFocusMode(false)}
          >
            <Minimize2 />
          </Button>
        </div>
      )}
      {/* エディタツールバー */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5',
          focusMode && 'hidden',
        )}
      >
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
            {charCount !== null && (
              <span
                className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground"
                title={
                  actualPages !== null
                    ? 'ページ数はプレビューの組版結果（実測）です'
                    : 'ページ数は版面（行数×字詰め）からの概算です。プレビュー完了で実測値に置き換わります'
                }
              >
                {charCount.toLocaleString('ja-JP')}字・
                {actualPages !== null ? `${actualPages}ページ` : `約${estimatePages(charCount, kumi)}ページ`}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            章を選んで執筆をはじめてください（保存するとコミットされます）
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* エディタ内から校正・講評を直接起動（Issue #18。校正は開いている章が対象） */}
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedPath || chapterLoading || merge !== null}
            onClick={() => void openProofread()}
          >
            <SpellCheck data-icon="inline-start" />
            校正
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={chapters.length === 0}
            onClick={() => openReviewPanel('critique')}
          >
            <BookOpenText data-icon="inline-start" />
            講評
          </Button>
          {/* 原稿タブ（校正・講評）への相互リンク（編集中の章を開いたまま遷移。SPEC-phase4 §3.1） */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="原稿レビュー画面をひらく"
            title="原稿レビュー画面をひらく（編集中の章を開いたまま遷移）"
            className="text-muted-foreground"
            nativeButton={false}
            render={
              <Link
                href={`/projects/${projectId}/manuscript${
                  selectedPath ? `?file=${encodeURIComponent(selectedPath)}` : ''
                }`}
              >
                <ExternalLink />
              </Link>
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="書籍設定"
            title="書籍設定（書誌・章構成・組み設定・奥付）"
            className="text-muted-foreground"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBuildOpen(true)}>
            入稿ビルド
          </Button>
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
          {/* プレビューの別ウィンドウ分離（Issue #72）。狭い画面＋外部ディスプレイの
              使い方が主目的なので、インラインプレビューと違い lg 未満でも出す */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              detached ? 'プレビューをこのウィンドウに戻す' : 'プレビューを別ウィンドウで開く'
            }
            title={
              detached ? 'プレビューをこのウィンドウに戻す' : 'プレビューを別ウィンドウで開く'
            }
            className={cn('text-muted-foreground', detached && 'text-primary')}
            onClick={toggleDetachedPreview}
          >
            <PictureInPicture2 />
          </Button>
          {!detached && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={previewOpen ? 'プレビューを隠す' : 'プレビューを表示'}
              className="hidden text-muted-foreground lg:inline-flex"
              onClick={() => setPreviewOpen((open) => !open)}
            >
              <PanelRight />
            </Button>
          )}
          {/* 集中モード: ナビ・ヘッダー・章一覧・ツールバーを隠して執筆に専念する */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="集中モード（入力ペインのみを表示）"
            title="集中モード（Escで解除）"
            className="text-muted-foreground"
            disabled={selectedPath === null}
            onClick={() => setFocusMode(true)}
          >
            <Maximize2 />
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
        {/* 章一覧サイドバー（SPEC §3.3。集中モード中は隠す） */}
        {sidebarOpen && !focusMode && (
          <nav
            aria-label="章一覧"
            className={cn(
              'flex w-full shrink-0 flex-col overflow-y-auto border-border p-2 lg:flex lg:w-60 lg:border-r',
              selectedPath !== null && 'hidden',
            )}
          >
            {/* 章一覧／コメント一覧の切替タブ（SPEC-phase3 §3。コメントは章を開いているときのみ） */}
            {selectedPath !== null && (
              <div className="mb-1.5 grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
                {(
                  [
                    { key: 'chapters', label: '章' },
                    { key: 'comments', label: `コメント${comments.length > 0 ? ` ${comments.length}` : ''}` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={sidebarTab === tab.key}
                    onClick={() => setSidebarTab(tab.key)}
                    className={cn(
                      'rounded px-2 py-1 text-xs transition-colors',
                      sidebarTab === tab.key
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
            {sidebarTab === 'comments' && selectedPath !== null ? (
              comments.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  この章にコメントはありません（Cmd/Ctrl+/ で挿入できます）
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5" aria-label="コメント一覧">
                  {comments.map((comment) => (
                    <li key={`${comment.from}:${comment.to}`}>
                      <button
                        type="button"
                        onClick={() => jumpToComment(comment)}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary/50"
                      >
                        <span className="shrink-0 pt-px text-[10px] tabular-nums leading-4 text-muted-foreground">
                          L{comment.line}
                        </span>
                        <span className="min-w-0 break-all">{comment.summary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
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
                          onClick={() => {
                            // 校正パネルは開いていた章に紐づくため、章の切替で閉じる（講評は作品全体なので維持）
                            if (chapter.path !== selectedPath && reviewOpen === 'proofread') {
                              closeReviewPanel()
                            }
                            void openChapterFlow(chapter.path)
                          }}
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
              </>
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
                style={
                  previewOpen && !detached
                    ? { flexBasis: `${ratio * 100}%` }
                    : { flexBasis: '100%' }
                }
              >
                {/* モバイル: 一覧へ戻る（集中モード中は隠す） */}
                <div
                  className={cn(
                    'flex items-center gap-2 border-b border-border px-2 py-1 lg:hidden',
                    focusMode && 'hidden',
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="章一覧へ戻る"
                    className="text-muted-foreground"
                    onClick={() => {
                      flushDraft()
                      if (reviewOpen === 'proofread') closeReviewPanel()
                      setSelectedPath(null)
                      currentRef.current = null
                      setPreviewHtml(null)
                      setMerge(null)
                      setRestorePrompt(null)
                      setDirty(false)
                      setCharCount(null)
                      setActualPages(null)
                      setComments([])
                      setSidebarTab('chapters')
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
                  <>
                    <EditorToolbar
                      viewRef={editorViewRef}
                      onImageRequest={() => imageInputRef.current?.click()}
                    />
                    <div className="min-h-0 flex-1">
                      <EditorPane
                        key={`${selectedPath}:${editorEpoch}`}
                        initialContent={editorDoc}
                        onDocChange={onDocChange}
                        onSaveRequest={requestSave}
                        onImageDrop={setPendingImage}
                        viewRef={editorViewRef}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* 比率ドラッグ用の仕切り（デスクトップのみ） */}
              {previewOpen && !detached && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="ペイン幅の調整"
                  className="hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 lg:block"
                  onPointerDown={startDrag}
                />
              )}

              {previewOpen && !detached && (
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
                      // 実ページ数は編集章の部分プレビューのみ反映（全体プレビューは書籍全体の値になるため）
                      onPageCount={fullPreview ? undefined : setActualPages}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* エディタ内レビューパネル（Issue #18）。lg以上は右パネル、未満はボトムシート（原稿タブと同じ流儀） */}
        {reviewOpen === 'proofread' &&
          !focusMode &&
          (reviewFile === null ? (
            <aside
              aria-label="校正パネル"
              className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
            >
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
                {reviewLoading ? (
                  <Loader2
                    className="size-5 animate-spin text-muted-foreground"
                    aria-label="読み込み中"
                  />
                ) : (
                  <>
                    <p className="text-sm text-destructive">
                      {reviewError ?? '原稿情報の読み込みに失敗しました'}
                    </p>
                    <Button size="sm" variant="outline" onClick={closeReviewPanel}>
                      閉じる
                    </Button>
                  </>
                )}
              </div>
            </aside>
          ) : (
            <ProofreadPanel
              key={reviewFile.linkId}
              linkId={reviewFile.linkId}
              content={reviewFile.content}
              suggestions={reviewFile.suggestions}
              onUpdateStatus={handleUpdateSuggestion}
              onLocate={locateInEditor}
              onCompleted={refreshReview}
              onClose={closeReviewPanel}
            />
          ))}
        {reviewOpen === 'critique' && !focusMode && (
          <CritiquePanel projectId={projectId} onClose={closeReviewPanel} />
        )}
      </div>

      <SaveDialog
        open={saveDialogOpen}
        defaultMessage={
          selectedName ? `執筆: ${selectedName} を更新（ネコノテAI 縦書きエディタ）` : ''
        }
        saving={saving}
        onConfirm={(message) => void confirmSave(message)}
        onOpenChange={(open) => {
          setSaveDialogOpen(open)
          // 保存せず閉じたら「保存後に校正パネルを開く」予約も解除する
          if (!open) pendingProofreadRef.current = false
        }}
      />
      <NewChapterDialog
        open={newChapterOpen}
        creating={creating}
        onCreate={(name) => void handleCreateChapter(name)}
        onOpenChange={setNewChapterOpen}
      />
      <SettingsDialog
        projectId={projectId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={handleSettingsSaved}
        onOpenChapter={(path) => void openChapterFlow(path)}
      />
      <BuildDialog
        projectId={projectId}
        open={buildOpen}
        dirty={dirty || draftPaths.size > 0}
        onOpenChange={setBuildOpen}
      />
      {/* 種別・キャプションはファイルごとに初期化する（key） */}
      <ImageUploadDialog
        key={pendingImage ? `${pendingImage.name}:${pendingImage.lastModified}` : 'none'}
        file={pendingImage}
        uploading={uploadingImage}
        onConfirm={(params) => void confirmImageUpload(params)}
        onCancel={() => setPendingImage(null)}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          if (file) setPendingImage(file)
          event.target.value = ''
        }}
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
