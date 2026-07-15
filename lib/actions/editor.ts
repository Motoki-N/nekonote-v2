'use server'

import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { extractEntryPaths, extractThemePath, joinRepoPath } from '@/lib/editor/book-config'
import type { ThemeAssets } from '@/lib/editor/preview'
import { resolveThemeAssets } from '@/lib/editor/theme'
import { patCredentialProvider } from '@/lib/git/credentials'
import {
  createFileContent,
  getDefaultBranch,
  getFileContent,
  getManuscriptTree,
  putFileContent,
} from '@/lib/git/github'
import { enforceRateLimit } from '@/lib/rate-limit'
import { manuscriptFilePathSchema } from '@/lib/schemas/manuscript'
import { createClient } from '@/lib/supabase/server'

// 縦書きエディタの Server Actions（SPEC-vertical-editor-phase2）。
// 原稿の実体は常にGitHub（読み書きとも Contents API 経由・DBには置かない）

const uuidSchema = z.uuid()
const blobShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'SHAが不正です')
const commitMessageSchema = z.string().trim().min(1, 'コミットメッセージを入力してください').max(200)
// Contents API の読み込み上限（1MB）に合わせる。超えると保存後に自分で開けなくなる
const contentSchema = z.string().max(1_000_000, '本文が大きすぎます（上限1MB）')
// 新規章のファイル名（`manuscripts/` 配下固定・スラッシュ不可・`..` 不可。SPEC §3.3）
const chapterFileNameSchema = z
  .string()
  .regex(/^(?!.*\.\.)[0-9A-Za-z][0-9A-Za-z._-]{0,80}\.md$/, {
    error: 'ファイル名は英数字で始まる「NN-slug.md」形式で入力してください',
  })

type EditorContext = {
  userId: string
  repo: string
  basePath: string
  token: string
}

/** 認証＋プロジェクト所有確認（RLS越し取得）＋PAT取得。前提未達は AppError */
async function loadEditorContext(projectId: string): Promise<EditorContext> {
  const pid = uuidSchema.parse(projectId)
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new AppError('unauthorized', 'ログインが必要です')

  const { data: project, error } = await supabase
    .from('projects')
    .select('id, repo, base_path')
    .eq('id', pid)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')
  if (!project.repo) throw new AppError('validation', 'リポジトリが設定されていません')

  const credential = await patCredentialProvider.getCredential(supabase)
  if (!credential) throw new AppError('validation', 'GitHub PATが未登録です。設定から登録してください')

  return {
    userId: user.id,
    repo: project.repo,
    basePath: (project.base_path ?? '').replace(/\/$/, ''),
    token: credential.token,
  }
}

/** 章ファイルパスの検証（base_path 配下の manuscripts/*.md のみ許可） */
function validateChapterPath(basePath: string, filePath: string): string {
  const path = manuscriptFilePathSchema.parse(filePath)
  const prefix = basePath === '' ? '' : `${basePath}/`
  if (!path.startsWith(`${prefix}manuscripts/`) || !path.endsWith('.md')) {
    throw new AppError('validation', 'ファイルパスが不正です')
  }
  return path
}

export type EditorChapter = {
  /** リポジトリルートからのパス */
  path: string
  /** book.config.js の entry に載っているか（未登録は一覧末尾に印つき表示。SPEC §3.3） */
  inEntry: boolean
}

/** 章一覧を entry 順（正）＋entry未登録（ファイル名昇順・末尾）で返す */
async function listChapters(ctx: EditorContext): Promise<{
  chapters: EditorChapter[]
  themePath: string | null
}> {
  const tree = await getManuscriptTree(ctx.token, ctx.repo, ctx.basePath)
  const prefix = ctx.basePath === '' ? '' : `${ctx.basePath}/`
  const files = tree
    .map((entry) => entry.path)
    .filter((path) => path.startsWith(`${prefix}manuscripts/`) && path.endsWith('.md'))

  // book.config.js は実行せず文字列抽出（SPEC §3.3）。読めなければファイル名昇順フォールバック
  let entryPaths: string[] = []
  let themePath: string | null = null
  const configPath = joinRepoPath(ctx.basePath, 'book.config.js')
  if (configPath) {
    try {
      const config = await getFileContent(ctx.token, ctx.repo, configPath)
      entryPaths = extractEntryPaths(config.content)
      themePath = extractThemePath(config.content)
    } catch {
      // book.config.js がないリポジトリも許容する（テーマは既定・章順はファイル名昇順）
    }
  }

  const fileSet = new Set(files)
  const ordered: EditorChapter[] = []
  for (const entry of entryPaths) {
    const full = joinRepoPath(ctx.basePath, entry)
    if (full && fileSet.has(full)) {
      ordered.push({ path: full, inEntry: true })
      fileSet.delete(full)
    }
  }
  // entry 未登録の章は末尾へ（files はツリー取得時点でパス昇順）
  for (const path of files) {
    if (fileSet.has(path)) ordered.push({ path, inEntry: false })
  }
  return { chapters: ordered, themePath }
}

export type EditorWorkspaceData =
  | { gate: 'no_repo' }
  | { gate: 'no_pat' }
  | {
      gate: 'ok'
      repo: string
      /** デフォルトブランチ（Phase 2 はこのブランチのみ対象。IndexedDB待避キーにも使う） */
      branch: string
      basePath: string
      chapters: EditorChapter[]
      theme: ThemeAssets
    }

/** エディタの初期データ（章一覧・テーマCSS）。前提未達（repo/PAT）は gate で返す */
export async function getEditorWorkspace(
  projectId: string,
): Promise<ActionResult<EditorWorkspaceData>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const supabase = await createClient()

    // middleware・RLSに加えた明示チェック（SPEC-auth §3.3 の多層防御）
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const { data: project, error } = await supabase
      .from('projects')
      .select('id, repo, base_path')
      .eq('id', pid)
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')
    if (!project.repo) return { ok: true, data: { gate: 'no_repo' } }
    const credential = await patCredentialProvider.getCredential(supabase)
    if (!credential) return { ok: true, data: { gate: 'no_pat' } }

    const ctx: EditorContext = {
      userId: user.id,
      repo: project.repo,
      basePath: (project.base_path ?? '').replace(/\/$/, ''),
      token: credential.token,
    }
    const [branch, { chapters, themePath }] = await Promise.all([
      getDefaultBranch(ctx.token, ctx.repo),
      listChapters(ctx),
    ])
    const theme = await resolveThemeAssets(ctx.token, ctx.repo, ctx.basePath, themePath)
    return {
      ok: true,
      data: { gate: 'ok', repo: ctx.repo, branch, basePath: ctx.basePath, chapters, theme },
    }
  } catch (error) {
    return toActionError(error)
  }
}

export type ChapterData = {
  path: string
  content: string
  /** blob SHA（保存の楽観ロック基準・IndexedDB待避の baseSha） */
  sha: string
}

/** 章を開く（最新本文＋blob SHA）。復元・競合判定は呼び出し側が行う（SPEC §7） */
export async function openChapter(
  projectId: string,
  filePath: string,
): Promise<ActionResult<ChapterData>> {
  try {
    const ctx = await loadEditorContext(projectId)
    const path = validateChapterPath(ctx.basePath, filePath)
    const { content, sha } = await getFileContent(ctx.token, ctx.repo, path)
    return { ok: true, data: { path, content, sha } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 保存＝コミット（SPEC §6）。baseSha による楽観ロック。
 * リモートが先に更新されていると conflict が返る（クライアントはマージ支援へ。SPEC §8）
 */
export async function saveChapter(
  projectId: string,
  filePath: string,
  params: { content: string; baseSha: string; message: string },
): Promise<ActionResult<{ commitSha: string; blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId)
    // コスト暴走・暴発の抑止（security-audit の作法に合わせ書き込み系に適用）
    enforceRateLimit(ctx.userId, 'editor-save', { perMinute: 12, perDay: 600 })
    const path = validateChapterPath(ctx.basePath, filePath)
    const content = contentSchema.parse(params.content)
    const baseSha = blobShaSchema.parse(params.baseSha)
    const message = commitMessageSchema.parse(params.message)
    const result = await putFileContent(ctx.token, ctx.repo, path, {
      content,
      sha: baseSha,
      message,
    })
    return { ok: true, data: result }
  } catch (error) {
    return toActionError(error)
  }
}

/** 新規章の雛形（見出しフロントマター入り。SPEC §3.3） */
function chapterScaffold(): string {
  return `---
title: 新しい章
---

# 新しい章

`
}

/**
 * 新規章ファイルの作成＝コミット（SPEC §3.3）。`manuscripts/` 配下固定。
 * book.config.js の entry への追記は行わない（Phase 3 の設定フォーム化まで手動）
 */
export async function createChapter(
  projectId: string,
  fileName: string,
): Promise<ActionResult<ChapterData>> {
  try {
    const ctx = await loadEditorContext(projectId)
    enforceRateLimit(ctx.userId, 'editor-save', { perMinute: 12, perDay: 600 })
    const name = chapterFileNameSchema.parse(fileName)
    const path = joinRepoPath(ctx.basePath, 'manuscripts', name)
    if (!path) throw new AppError('validation', 'ファイル名が不正です')
    // 作成経路でも開く/保存と同じ検証を通す（多層防御）
    validateChapterPath(ctx.basePath, path)
    const content = chapterScaffold()
    const { blobSha } = await createFileContent(ctx.token, ctx.repo, path, {
      content,
      message: `執筆: ${name} を新規作成（ネコノテAI 縦書きエディタ）`,
    })
    return { ok: true, data: { path, content, sha: blobSha } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 全体プレビュー用に全章の本文を entry 順で返す（明示操作時のみ。SPEC §5.2）。
 * 目次ページ（{ rel: 'contents' }）はCLIビルド時の生成物のためプレビューには含まれない
 */
export async function getAllChapterContents(
  projectId: string,
): Promise<ActionResult<{ chapters: { path: string; content: string }[] }>> {
  try {
    const ctx = await loadEditorContext(projectId)
    const { chapters } = await listChapters(ctx)
    // 章数は高々数十の想定。5並列で順序を保って取得する
    const results: { path: string; content: string }[] = new Array(chapters.length)
    let index = 0
    async function worker() {
      while (index < chapters.length) {
        const i = index++
        const { content } = await getFileContent(ctx.token, ctx.repo, chapters[i].path)
        results[i] = { path: chapters[i].path, content }
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, chapters.length) }, worker))
    return { ok: true, data: { chapters: results } }
  } catch (error) {
    return toActionError(error)
  }
}
