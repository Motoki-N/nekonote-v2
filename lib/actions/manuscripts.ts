'use server'

import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { patCredentialProvider } from '@/lib/git/credentials'
import {
  getFileContent,
  getLatestCommitSha,
  getManuscriptTree as fetchManuscriptTree,
} from '@/lib/git/github'
import type { SuggestionStatus } from '@/lib/schemas/enums'
import { manuscriptFilePathSchema } from '@/lib/schemas/manuscript'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()

/** 原稿タブの前提チェック結果（誘導表示の出し分け用。SPEC-proofreading §3.2） */
export type ManuscriptTreeData =
  | { gate: 'no_repo' }
  | { gate: 'no_pat' }
  | { gate: 'ok'; files: string[]; basePath: string }

/** base_path 配下の原稿ファイル一覧を取得する。前提未達（repo未設定・PAT未登録）は gate で返す */
export async function getManuscriptTree(
  projectId: string,
): Promise<ActionResult<ManuscriptTreeData>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認を兼ねる
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

    const basePath = project.base_path ?? ''
    const files = await fetchManuscriptTree(credential.token, project.repo, basePath)
    return {
      ok: true,
      data: { gate: 'ok', files: files.map((f) => f.path), basePath },
    }
  } catch (error) {
    return toActionError(error)
  }
}

export type SuggestionRecord = {
  id: string
  original_text: string
  suggested_text: string
  reason: string | null
  status: SuggestionStatus
  created_at: string
}

export type ManuscriptFileData = {
  linkId: string
  filePath: string
  content: string
  /** 空白・改行を除いた文字数 */
  charCount: number
  latestSha: string
  lastReviewedCommit: string | null
  suggestions: SuggestionRecord[]
}

/**
 * 原稿ファイルを開く（SPEC-proofreading §3.2）。
 * 本文＋そのファイルの最新コミットSHAを取得し、manuscript_links を自動作成する
 * （開いた時点で管理対象になる。「リポジトリが正」の思想）
 */
export async function openManuscriptFile(
  projectId: string,
  filePath: string,
): Promise<ActionResult<ManuscriptFileData>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const path = manuscriptFilePathSchema.parse(filePath)
    const supabase = await createClient()

    const { data: project, error } = await supabase
      .from('projects')
      .select('id, repo, base_path')
      .eq('id', pid)
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')
    if (!project.repo) throw new AppError('validation', 'リポジトリが設定されていません')

    // base_path 外のパスは拒否（ツリー一覧と同じ範囲に限定する）
    const basePath = project.base_path ?? ''
    if (basePath !== '' && !path.startsWith(`${basePath.replace(/\/$/, '')}/`)) {
      throw new AppError('validation', 'ファイルパスが不正です')
    }

    const credential = await patCredentialProvider.getCredential(supabase)
    if (!credential) throw new AppError('validation', 'GitHub PATが未登録です')

    const [content, latestSha] = await Promise.all([
      getFileContent(credential.token, project.repo, path),
      getLatestCommitSha(credential.token, project.repo, path),
    ])

    // 開いた時点でリンクを自動作成（既存ならそのまま）
    const { error: upsertError } = await supabase
      .from('manuscript_links')
      .upsert(
        { project_id: pid, file_path: path },
        { onConflict: 'project_id,file_path', ignoreDuplicates: true },
      )
    if (upsertError) throw new AppError('internal', upsertError.message)

    const { data: link, error: linkError } = await supabase
      .from('manuscript_links')
      .select('id, last_reviewed_commit, revision_suggestions (id, original_text, suggested_text, reason, status, created_at)')
      .eq('project_id', pid)
      .eq('file_path', path)
      .maybeSingle()
    if (linkError) throw new AppError('internal', linkError.message)
    if (!link) throw new AppError('internal', '原稿リンクの作成に失敗しました')

    const suggestions = (link.revision_suggestions ?? [])
      .map((s) => ({ ...s, status: s.status as SuggestionStatus }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))

    return {
      ok: true,
      data: {
        linkId: link.id,
        filePath: path,
        content,
        charCount: content.replaceAll(/\s/g, '').length,
        latestSha,
        lastReviewedCommit: link.last_reviewed_commit,
        suggestions,
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/** 提案一覧の取り直し（校正完了後の再読込用） */
export async function getSuggestions(
  manuscriptLinkId: string,
): Promise<ActionResult<{ suggestions: SuggestionRecord[]; lastReviewedCommit: string | null }>> {
  try {
    const linkId = uuidSchema.parse(manuscriptLinkId)
    const supabase = await createClient()
    const { data: link, error } = await supabase
      .from('manuscript_links')
      .select('id, last_reviewed_commit, revision_suggestions (id, original_text, suggested_text, reason, status, created_at)')
      .eq('id', linkId)
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!link) throw new AppError('not_found', '原稿リンクが見つかりません')
    const suggestions = (link.revision_suggestions ?? [])
      .map((s) => ({ ...s, status: s.status as SuggestionStatus }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    return {
      ok: true,
      data: { suggestions, lastReviewedCommit: link.last_reviewed_commit },
    }
  } catch (error) {
    return toActionError(error)
  }
}
