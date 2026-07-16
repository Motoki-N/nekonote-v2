'use server'

import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import {
  KUMI_VAR_NAMES,
  extractCssVar,
  extractEntryPaths,
  extractStringValue,
  extractThemePath,
  joinRepoPath,
  parseEntryItems,
  replaceCssVar,
  replaceEntryItems,
  replaceStringValue,
} from '@/lib/editor/book-config'
import type { EntryItem, KumiVarName } from '@/lib/editor/book-config'
import { OKUZUKE_LABELS, parseOkuzuke, replaceOkuzuke } from '@/lib/editor/okuzuke'
import type { OkuzukeData } from '@/lib/editor/okuzuke'
import type { ThemeAssets } from '@/lib/editor/preview'
import { resolveThemeAssets } from '@/lib/editor/theme'
import { patCredentialProvider } from '@/lib/git/credentials'
import {
  createBinaryFileContent,
  createFileContent,
  createTagRef,
  getBranchHeadSha,
  getDefaultBranch,
  getFileContent,
  getManuscriptTree,
  getReleaseByTag,
  listTags,
  putFileContent,
} from '@/lib/git/github'
import type { ReleaseAsset } from '@/lib/git/github'
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
 * 作成後、book.config.js の entry へ自動追記する（SPEC-phase3 §7-2。
 * config がない・解析できない等で追記に失敗しても章の作成自体は成功のまま返す）
 */
export async function createChapter(
  projectId: string,
  fileName: string,
): Promise<ActionResult<ChapterData & { inEntry: boolean }>> {
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
    const inEntry = await appendChapterToEntry(ctx, name)
    return { ok: true, data: { path, content, sha: blobSha, inEntry } }
  } catch (error) {
    return toActionError(error)
  }
}

/** entry への自動追記（ベストエフォート。失敗しても呼び出し側は「entry未登録」扱いで続行） */
async function appendChapterToEntry(ctx: EditorContext, fileName: string): Promise<boolean> {
  try {
    const configPath = joinRepoPath(ctx.basePath, 'book.config.js')
    if (!configPath) return false
    const config = await getFileContent(ctx.token, ctx.repo, configPath)
    const items = parseEntryItems(config.content)
    if (!items) return false
    const relPath = `manuscripts/${fileName}`
    if (items.some((item) => item.path === relPath)) return true
    const updated = replaceEntryItems(config.content, [
      ...items.map((item) => item.raw),
      `'${relPath}'`,
    ])
    // 置換後に読み取り側と同じ抽出関数で検証してからコミット（SPEC-phase3 §7）
    if (!updated || !extractEntryPaths(updated).includes(relPath)) return false
    await putFileContent(ctx.token, ctx.repo, configPath, {
      content: updated,
      sha: config.sha,
      message: `設定: ${fileName} を entry に追加（ネコノテAI 縦書きエディタ）`,
    })
    return true
  } catch {
    return false
  }
}

// ---- 設定フォーム（SPEC-vertical-editor-phase3 §7） ----

export type ThemeSettings = {
  /** 判型ラベル（設定ファイル名から。book.config.js=既定・book.config.b6.js=B6） */
  label: string
  /** リポジトリルートからのCSSパス */
  cssPath: string
  sha: string
  /** 組み設定変数の現在値（見つからない変数は null＝そのフィールドは読み取り専用） */
  vars: Record<KumiVarName, string | null>
}

export type BookSettingsData = {
  /** book.config.js。null = ファイルなし（フォーム全体を案内表示にする） */
  config: {
    path: string
    sha: string
    title: string | null
    author: string | null
    /** null = entry を解析できない（章順は読み取り専用） */
    entryItems: EntryItem[] | null
  } | null
  themes: ThemeSettings[]
  /** テンプレート構造を検出できた奥付章。null = フォーム化しない（直接編集を案内） */
  okuzuke: { path: string; sha: string; data: OkuzukeData } | null
  /** entry へ追加できる章の候補（config 起点の相対パス・entry 未登録のもの） */
  entryCandidates: string[]
}

// entry の文字列要素（章パス）として受け付ける形（引用符付き・.md・トラバーサル拒否）
const ENTRY_LITERAL = /^(['"])(?!.*\.\.)[^'"`\\\n]+\.md\1$/

/** 設定フォームの初期データ（config・テーマCSS・奥付をまとめて取得） */
export async function getBookSettings(projectId: string): Promise<ActionResult<BookSettingsData>> {
  try {
    const ctx = await loadEditorContext(projectId)

    // book.config.js（なければフォームは案内表示のみ）
    const configPath = joinRepoPath(ctx.basePath, 'book.config.js')
    let config: BookSettingsData['config'] = null
    let configContent: string | null = null
    if (configPath) {
      try {
        const file = await getFileContent(ctx.token, ctx.repo, configPath)
        configContent = file.content
        config = {
          path: configPath,
          sha: file.sha,
          title: extractStringValue(file.content, 'title'),
          author: extractStringValue(file.content, 'author'),
          entryItems: parseEntryItems(file.content),
        }
      } catch {
        config = null
      }
    }

    // テーマCSS（既定＋B6。リポジトリ外を指すテーマは対象外）
    const themes: ThemeSettings[] = []
    const themeSources: { label: string; content: string | null }[] = [
      { label: '既定（A6）', content: configContent },
    ]
    const b6Path = joinRepoPath(ctx.basePath, 'book.config.b6.js')
    if (b6Path) {
      try {
        const b6 = await getFileContent(ctx.token, ctx.repo, b6Path)
        themeSources.push({ label: 'B6', content: b6.content })
      } catch {
        // B6設定はオプション
      }
    }
    for (const source of themeSources) {
      if (!source.content) continue
      const themePath = extractThemePath(source.content)
      if (!themePath || !themePath.endsWith('.css')) continue
      const cssPath = joinRepoPath(ctx.basePath, themePath)
      if (!cssPath) continue
      if (themes.some((theme) => theme.cssPath === cssPath)) continue
      try {
        const css = await getFileContent(ctx.token, ctx.repo, cssPath)
        const vars = Object.fromEntries(
          KUMI_VAR_NAMES.map((name) => [name, extractCssVar(css.content, name)]),
        ) as Record<KumiVarName, string | null>
        themes.push({ label: source.label, cssPath, sha: css.sha, vars })
      } catch {
        // テーマがnpmパッケージ等リポジトリ外の場合は組み設定フォームの対象外
      }
    }

    // 奥付（ファイル名の慣習 *okuzuke*.md で検出。SPEC-phase3 §7-4 のフェイルソフト）
    let okuzuke: BookSettingsData['okuzuke'] = null
    const { chapters } = await listChapters(ctx)
    const okuzukePath = chapters.find((chapter) =>
      /okuzuke[^/]*\.md$/i.test(chapter.path),
    )?.path
    if (okuzukePath) {
      try {
        const file = await getFileContent(ctx.token, ctx.repo, okuzukePath)
        const data = parseOkuzuke(file.content)
        if (data) okuzuke = { path: okuzukePath, sha: file.sha, data }
      } catch {
        okuzuke = null
      }
    }

    // entry 追加候補（entry 未登録の章。config 起点の相対パスで返す）
    const prefix = ctx.basePath === '' ? '' : `${ctx.basePath}/`
    const registered = new Set(
      (config?.entryItems ?? []).flatMap((item) => (item.path ? [item.path] : [])),
    )
    const entryCandidates = chapters
      .map((chapter) => chapter.path.slice(prefix.length))
      .filter((relPath) => !registered.has(relPath))

    return { ok: true, data: { config, themes, okuzuke, entryCandidates } }
  } catch (error) {
    return toActionError(error)
  }
}

const biblioValueSchema = z
  .string()
  .trim()
  .min(1, '値を入力してください')
  .max(100, '100字以内で入力してください')
  .refine((value) => !/['"`\n\\]/.test(value), { error: '引用符・改行は使えません' })

const saveBookConfigSchema = z.object({
  baseSha: blobShaSchema,
  title: biblioValueSchema.nullable(),
  author: biblioValueSchema.nullable(),
  /** null = entry は変更しない */
  entryRawItems: z.array(z.string().max(200)).max(200).nullable(),
})

/**
 * book.config.js の書誌・entry を書き換えてコミットする（SPEC-phase3 §7-1・7-2）。
 * 正規表現置換→抽出関数での検証→楽観ロック付きコミット。
 * entry の非文字列要素（目次差し込み等）は既存要素の並べ替えのみ許可（新規は受け付けない）
 */
export async function saveBookConfig(
  projectId: string,
  params: z.infer<typeof saveBookConfigSchema>,
): Promise<ActionResult<{ blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId)
    enforceRateLimit(ctx.userId, 'editor-save', { perMinute: 12, perDay: 600 })
    const { baseSha, title, author, entryRawItems } = saveBookConfigSchema.parse(params)

    const configPath = joinRepoPath(ctx.basePath, 'book.config.js')
    if (!configPath) throw new AppError('validation', '設定ファイルのパスが不正です')
    const current = await getFileContent(ctx.token, ctx.repo, configPath)
    if (current.sha !== baseSha) {
      throw new AppError('conflict', '設定がリモートで更新されています。開き直してください')
    }

    let updated = current.content
    if (title !== null) {
      const replaced = replaceStringValue(updated, 'title', title)
      if (!replaced) throw new AppError('validation', 'title の書き換えに対応できない構造です')
      updated = replaced
    }
    if (author !== null) {
      const replaced = replaceStringValue(updated, 'author', author)
      if (!replaced) throw new AppError('validation', 'author の書き換えに対応できない構造です')
      updated = replaced
    }
    if (entryRawItems !== null) {
      const currentItems = parseEntryItems(current.content)
      if (!currentItems) {
        throw new AppError('validation', 'entry の書き換えに対応できない構造です')
      }
      // 非文字列要素は「既存にあるものだけ・重複なし」を許可（クライアント由来のJS断片を混ぜない）
      const currentNonLiterals = currentItems
        .filter((item) => item.path === null)
        .map((item) => item.raw)
      for (const raw of entryRawItems) {
        if (ENTRY_LITERAL.test(raw)) {
          const path = raw.slice(1, -1)
          if (!joinRepoPath(ctx.basePath, path)) {
            throw new AppError('validation', `entry のパスが不正です: ${path}`)
          }
          continue
        }
        const index = currentNonLiterals.indexOf(raw)
        if (index === -1) {
          throw new AppError('validation', 'entry に追加できない要素が含まれています')
        }
        currentNonLiterals.splice(index, 1)
      }
      const replaced = replaceEntryItems(updated, entryRawItems)
      if (!replaced) throw new AppError('validation', 'entry の書き換えに対応できない構造です')
      updated = replaced
    }

    // 置換後の検証: 読み取り側と同じ抽出関数で期待値が読めること（SPEC-phase3 §7）
    if (title !== null && extractStringValue(updated, 'title') !== title) {
      throw new AppError('validation', 'title の書き換え結果を検証できませんでした')
    }
    if (author !== null && extractStringValue(updated, 'author') !== author) {
      throw new AppError('validation', 'author の書き換え結果を検証できませんでした')
    }
    if (entryRawItems !== null) {
      const expected = entryRawItems
        .filter((raw) => ENTRY_LITERAL.test(raw))
        .map((raw) => raw.slice(1, -1))
      const actual = extractEntryPaths(updated)
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new AppError('validation', 'entry の書き換え結果を検証できませんでした')
      }
    }

    const result = await putFileContent(ctx.token, ctx.repo, configPath, {
      content: updated,
      sha: baseSha,
      message: '設定: 書誌情報・章構成を更新（ネコノテAI 縦書きエディタ）',
    })
    return { ok: true, data: { blobSha: result.blobSha } }
  } catch (error) {
    return toActionError(error)
  }
}

const kumiVarsSchema = z.object({
  fontSizePercent: z.number().min(30).max(200).nullable(),
  lineHeight: z.number().min(1).max(3).nullable(),
  lines: z.number().int().min(5).max(50).nullable(),
  charsPerLine: z.number().int().min(10).max(80).nullable(),
})

const saveThemeVarsSchema = z.object({
  cssPath: z.string().max(300),
  baseSha: blobShaSchema,
  vars: kumiVarsSchema,
})

/** 組み設定（テーマCSSの :root 変数）を書き換えてコミットする（SPEC-phase3 §7-3） */
export async function saveThemeVars(
  projectId: string,
  params: z.infer<typeof saveThemeVarsSchema>,
): Promise<ActionResult<{ blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId)
    enforceRateLimit(ctx.userId, 'editor-save', { perMinute: 12, perDay: 600 })
    const { cssPath, baseSha, vars } = saveThemeVarsSchema.parse(params)

    // 対象CSSは config の theme が指すものに限定（任意パス書き換えの防止）
    const allowed = new Set<string>()
    for (const configName of ['book.config.js', 'book.config.b6.js']) {
      const path = joinRepoPath(ctx.basePath, configName)
      if (!path) continue
      try {
        const config = await getFileContent(ctx.token, ctx.repo, path)
        const themePath = extractThemePath(config.content)
        if (themePath) {
          const resolved = joinRepoPath(ctx.basePath, themePath)
          if (resolved && resolved.endsWith('.css')) allowed.add(resolved)
        }
      } catch {
        // 設定ファイルがないものはスキップ
      }
    }
    if (!allowed.has(cssPath)) {
      throw new AppError('validation', '対象のテーマCSSが設定ファイルから参照されていません')
    }

    const current = await getFileContent(ctx.token, ctx.repo, cssPath)
    if (current.sha !== baseSha) {
      throw new AppError('conflict', 'テーマがリモートで更新されています。開き直してください')
    }

    const replacements: [KumiVarName, string][] = []
    if (vars.fontSizePercent !== null) {
      replacements.push(['--vs-font-size-on-print', `${vars.fontSizePercent}%`])
    }
    if (vars.lineHeight !== null) replacements.push(['--vs-line-height', String(vars.lineHeight)])
    if (vars.lines !== null) replacements.push(['--vs-theme--num-of-line', String(vars.lines)])
    if (vars.charsPerLine !== null) {
      replacements.push(['--vs-theme--num-of-character', String(vars.charsPerLine)])
    }
    if (replacements.length === 0) throw new AppError('validation', '変更する値がありません')

    let updated = current.content
    for (const [name, value] of replacements) {
      const replaced = replaceCssVar(updated, name, value)
      if (!replaced) {
        throw new AppError('validation', `テーマCSSに ${name} が見つかりません（直接編集してください）`)
      }
      updated = replaced
    }
    for (const [name, value] of replacements) {
      if (extractCssVar(updated, name) !== value) {
        throw new AppError('validation', '組み設定の書き換え結果を検証できませんでした')
      }
    }

    const result = await putFileContent(ctx.token, ctx.repo, cssPath, {
      content: updated,
      sha: baseSha,
      message: '設定: 組み設定（版面）を更新（ネコノテAI 縦書きエディタ）',
    })
    return { ok: true, data: { blobSha: result.blobSha } }
  } catch (error) {
    return toActionError(error)
  }
}

const okuzukeFieldSchema = z.object({
  label: z.enum(OKUZUKE_LABELS),
  value: z
    .string()
    .trim()
    .max(100, '100字以内で入力してください')
    .refine((value) => !/[<>&\n]/.test(value), { error: 'タグ文字（< > &）は使えません' }),
})

const saveOkuzukeSchema = z.object({
  path: z.string().max(300),
  baseSha: blobShaSchema,
  dateText: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .refine((value) => !/[<>&\n]/.test(value), { error: 'タグ文字（< > &）は使えません' })
    .nullable(),
  fields: z.array(okuzukeFieldSchema).max(OKUZUKE_LABELS.length),
})

/** 奥付章のテンプレート項目を書き換えてコミットする（SPEC-phase3 §7-4） */
export async function saveOkuzuke(
  projectId: string,
  params: z.infer<typeof saveOkuzukeSchema>,
): Promise<ActionResult<{ blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId)
    enforceRateLimit(ctx.userId, 'editor-save', { perMinute: 12, perDay: 600 })
    const { path: rawPath, baseSha, dateText, fields } = saveOkuzukeSchema.parse(params)
    const path = validateChapterPath(ctx.basePath, rawPath)

    const current = await getFileContent(ctx.token, ctx.repo, path)
    if (current.sha !== baseSha) {
      throw new AppError('conflict', '奥付がリモートで更新されています。開き直してください')
    }
    if (!parseOkuzuke(current.content)) {
      throw new AppError('validation', '奥付のテンプレート構造を検出できません（直接編集してください）')
    }

    const updated = replaceOkuzuke(current.content, { dateText, fields })
    if (!updated) throw new AppError('validation', '奥付の書き換えに対応できない構造です')
    const verify = parseOkuzuke(updated)
    if (
      !verify ||
      fields.some((field) => verify.fields.find((v) => v.label === field.label)?.value !== field.value) ||
      (dateText !== null && verify.dateText !== dateText)
    ) {
      throw new AppError('validation', '奥付の書き換え結果を検証できませんでした')
    }

    const result = await putFileContent(ctx.token, ctx.repo, path, {
      content: updated,
      sha: baseSha,
      message: '設定: 奥付を更新（ネコノテAI 縦書きエディタ）',
    })
    return { ok: true, data: { blobSha: result.blobSha } }
  } catch (error) {
    return toActionError(error)
  }
}

// ---- 画像アップロード（SPEC-vertical-editor-phase3 §6） ----

// 拡張子allowlistは画像プロキシ（/api/editor/asset）と同一に保つ
const imageFileNameSchema = z
  .string()
  .regex(/^(?!.*\.\.)[0-9A-Za-z][0-9A-Za-z._-]{0,80}\.(png|jpe?g|webp|gif)$/, {
    error: '画像ファイル名が不正です（英数字始まり・png/jpg/jpeg/webp/gif のみ）',
  })
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const imageBase64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: '画像データが不正です' })
  // base64は元サイズの約4/3。デコード前に長さで粗く弾く（正確な検査はデコード後）
  .max(Math.ceil((MAX_IMAGE_BYTES / 3) * 4) + 8, { error: '画像が大きすぎます（上限10MB）' })

/**
 * 画像を `images/` へ即コミットする（SPEC-phase3 §6・論点C）。
 * 同名ファイルがある場合は `-2` からの連番でリネームして再試行する。
 * 挿入記法の追記はクライアント（エディタ）の責務
 */
export async function uploadImage(
  projectId: string,
  fileName: string,
  base64Content: string,
): Promise<ActionResult<{ repoPath: string; fileName: string }>> {
  try {
    const ctx = await loadEditorContext(projectId)
    enforceRateLimit(ctx.userId, 'editor-upload', { perMinute: 6, perDay: 100 })
    const name = imageFileNameSchema.parse(fileName)
    const content = imageBase64Schema.parse(base64Content)
    if (Buffer.from(content, 'base64').length > MAX_IMAGE_BYTES) {
      throw new AppError('validation', '画像が大きすぎます（上限10MB）')
    }

    const dot = name.lastIndexOf('.')
    const stem = name.slice(0, dot)
    const ext = name.slice(dot)
    // 同名衝突は連番リネームで自動回避（最大5回。使い勝手優先で聞き返さない）
    for (let attempt = 1; attempt <= 5; attempt++) {
      const candidate = attempt === 1 ? name : `${stem}-${attempt}${ext}`
      const path = joinRepoPath(ctx.basePath, 'images', candidate)
      if (!path) throw new AppError('validation', '画像ファイル名が不正です')
      try {
        await createBinaryFileContent(ctx.token, ctx.repo, path, {
          base64Content: content,
          message: `執筆: 挿絵 ${candidate} を追加（ネコノテAI 縦書きエディタ）`,
        })
        return { ok: true, data: { repoPath: path, fileName: candidate } }
      } catch (error) {
        if (error instanceof AppError && error.code === 'conflict') continue
        throw error
      }
    }
    throw new AppError('conflict', '同名の画像が既に多数あります。ファイル名を変えてください')
  } catch (error) {
    return toActionError(error)
  }
}

// ---- 入稿ビルド（SPEC-vertical-editor-phase3 §8） ----

// 原稿リポジトリの Actions ワークフローのトリガー（`v*-nyuko` タグ push）に合わせる
const buildTagSchema = z.string().regex(/^v[0-9A-Za-z._-]{1,30}-nyuko$/, {
  error: 'タグは「v0.3-nyuko」の形式で入力してください',
})

/** 既存の入稿タグから次のタグ名を提案する（v{major}.{minor}-nyuko の minor をインクリメント） */
function suggestNextTag(tags: string[]): string {
  let best: [number, number] | null = null
  for (const tag of tags) {
    const match = tag.match(/^v(\d+)\.(\d+)-nyuko$/)
    if (!match) continue
    const version: [number, number] = [Number(match[1]), Number(match[2])]
    if (!best || version[0] > best[0] || (version[0] === best[0] && version[1] > best[1])) {
      best = version
    }
  }
  return best ? `v${best[0]}.${best[1] + 1}-nyuko` : 'v1.0-nyuko'
}

export type BuildTagInfo = {
  /** 既存の入稿タグ（新しい判定はできないためAPI返却順） */
  nyukoTags: string[]
  suggestedTag: string
  /** Actions ページへのリンク用 */
  repo: string
}

/** 入稿ビルドダイアログの初期情報（既存タグ・次タグ提案） */
export async function getBuildTagInfo(projectId: string): Promise<ActionResult<BuildTagInfo>> {
  try {
    const ctx = await loadEditorContext(projectId)
    const tags = await listTags(ctx.token, ctx.repo)
    const nyukoTags = tags.filter((tag) => /-nyuko$/.test(tag))
    return {
      ok: true,
      data: { nyukoTags, suggestedTag: suggestNextTag(nyukoTags), repo: ctx.repo },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 入稿タグの作成＝Actions ビルドの起動（SPEC-phase3 §8。タグ作成の代行。
 * 対象はデフォルトブランチのHEAD。Contents権限で可能——PATスコープ変更なし）
 */
export async function createBuildTag(
  projectId: string,
  tagName: string,
): Promise<ActionResult<{ tag: string; headSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId)
    enforceRateLimit(ctx.userId, 'editor-build', { perMinute: 3, perDay: 30 })
    const tag = buildTagSchema.parse(tagName)
    const branch = await getDefaultBranch(ctx.token, ctx.repo)
    const headSha = await getBranchHeadSha(ctx.token, ctx.repo, branch)
    await createTagRef(ctx.token, ctx.repo, tag, headSha)
    return { ok: true, data: { tag, headSha } }
  } catch (error) {
    return toActionError(error)
  }
}

export type BuildStatus =
  | { state: 'pending' }
  | { state: 'done'; assets: ReleaseAsset[] }

/**
 * 入稿ビルドの完了検知（SPEC-phase3 §8・論点B）。
 * 同タグの Release と PDF アセットの出現をもって完了とみなす（Actions API は使わない）
 */
export async function getBuildStatus(
  projectId: string,
  tagName: string,
): Promise<ActionResult<BuildStatus>> {
  try {
    const ctx = await loadEditorContext(projectId)
    enforceRateLimit(ctx.userId, 'editor-build-status', { perMinute: 10, perDay: 500 })
    const tag = buildTagSchema.parse(tagName)
    const release = await getReleaseByTag(ctx.token, ctx.repo, tag)
    const pdfAssets = release?.assets.filter((asset) => asset.name.endsWith('.pdf')) ?? []
    if (pdfAssets.length === 0) return { ok: true, data: { state: 'pending' } }
    return { ok: true, data: { state: 'done', assets: pdfAssets } }
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
