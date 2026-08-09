'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { PROPOSAL_INITIAL_CONTENT } from '@/lib/constants/proposal-template'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { writingGenres } from '@/lib/schemas/enums'
import type { WritingGenre } from '@/lib/schemas/enums'
import { projectInputSchema, projectUpdateSchema, proposalUpdateSchema } from '@/lib/schemas/projects'
import type { ProjectInput, ProjectUpdate, ProposalUpdate } from '@/lib/schemas/projects'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()
const noteIdsSchema = z.array(z.uuid()).max(100)

/**
 * プロジェクト作成。企画書（proposals 行）も同時に自動作成する
 * （1対1・執筆ジャンル別の定型テンプレ入り。SPEC-genre）。
 * noteIds はプロジェクト作成ダイアログの一括紐づけ（仮タイトルタグからの候補）。
 * writingGenre は proposals 側の値のため projectInputSchema には含めず引数で受ける
 */
export async function createProject(
  input: ProjectInput,
  noteIds: string[] = [],
  writingGenre: WritingGenre = 'novel',
): Promise<ActionResult<{ projectId: string }>> {
  try {
    const parsed = projectInputSchema.parse(input)
    const ids = noteIdsSchema.parse(noteIds)
    const genre = z.enum(writingGenres).parse(writingGenre)
    const supabase = await createClient()

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert(parsed)
      .select('id')
      .single()
    if (projectError || !project) {
      throw new AppError('internal', projectError?.message ?? 'プロジェクトの作成に失敗しました')
    }

    const { data: proposal, error: proposalError } = await supabase
      .from('proposals')
      .insert({
        project_id: project.id,
        writing_genre: genre,
        content: PROPOSAL_INITIAL_CONTENT[genre],
      })
      .select('id')
      .single()
    if (proposalError || !proposal) {
      throw new AppError('internal', proposalError?.message ?? '企画書の作成に失敗しました')
    }

    if (ids.length > 0) {
      const { error: linkError } = await supabase
        .from('proposal_notes')
        .insert(ids.map((noteId) => ({ proposal_id: proposal.id, note_id: noteId })))
      if (linkError) throw new AppError('internal', linkError.message)
    }

    revalidatePath('/projects')
    return { ok: true, data: { projectId: project.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateProject(id: string, input: ProjectUpdate): Promise<ActionResult> {
  try {
    const projectId = uuidSchema.parse(id)
    const parsed = projectUpdateSchema.parse(input)
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('projects')
      .update(parsed)
      .eq('id', projectId)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!data || data.length === 0) throw new AppError('not_found', 'プロジェクトが見つかりません')
    revalidatePath('/projects')
    revalidatePath(`/projects/${projectId}`)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** プロジェクト削除（企画書・紐づけ・レビュー履歴も cascade で消える） */
export async function deleteProject(id: string): Promise<ActionResult> {
  try {
    const projectId = uuidSchema.parse(id)
    const supabase = await createClient()
    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) throw new AppError('internal', error.message)
    revalidatePath('/projects')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 履歴スナップショットの間引き間隔（前回バージョンからこの時間経過していたら保存。notes.ts と同値） */
const VERSION_INTERVAL_MS = 10 * 60 * 1000

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** 上書き前の企画書本文を proposal_versions へ保存する（Issue #64） */
async function insertProposalSnapshot(
  supabase: SupabaseServerClient,
  proposalId: string,
  content: string,
): Promise<void> {
  const { error } = await supabase
    .from('proposal_versions')
    .insert({ proposal_id: proposalId, content })
  if (error) throw new AppError('internal', error.message)
}

/** 時間ベース間引き: 最新バージョンから一定時間経過していたら上書き前の本文をスナップショットする */
async function snapshotProposalIfStale(
  supabase: SupabaseServerClient,
  proposalId: string,
  content: string,
): Promise<void> {
  const { data: latest, error } = await supabase
    .from('proposal_versions')
    .select('content, created_at')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (latest && Date.now() - Date.parse(latest.created_at) < VERSION_INTERVAL_MS) return
  // レビュー時版（＝レビュー時点の現在本文）と同一内容の重複を防ぐ
  // （レビュー後10分超経過してからの編集では「上書き前の本文」＝レビュー時版と同一になるため）
  if (latest?.content === content) return
  await insertProposalSnapshot(supabase, proposalId, content)
}

/** 現在の企画書行（本文とプロジェクトid）を取得する（存在しなければ not_found） */
async function fetchProposalSnapshot(
  supabase: SupabaseServerClient,
  id: string,
): Promise<{ content: string; project_id: string }> {
  const { data, error } = await supabase
    .from('proposals')
    .select('content, project_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data) throw new AppError('not_found', '企画書が見つかりません')
  return data
}

/** 企画書の自動保存の受け口（writing_genre / purpose / genre / target_audience / content。status はここでは変えない） */
export async function updateProposal(id: string, input: ProposalUpdate): Promise<ActionResult> {
  try {
    const proposalId = uuidSchema.parse(id)
    const parsed = proposalUpdateSchema.parse(input)
    const supabase = await createClient()
    // 本文が変わる保存だけスナップショット対象（版は本文のみ。4項目だけの変更では版を作らない）
    if (parsed.content !== undefined) {
      const current = await fetchProposalSnapshot(supabase, proposalId)
      if (parsed.content !== current.content) {
        await snapshotProposalIfStale(supabase, proposalId, current.content)
      }
    }
    const { data, error } = await supabase
      .from('proposals')
      .update(parsed)
      .eq('id', proposalId)
      .select('project_id')
    if (error) throw new AppError('internal', error.message)
    if (!data || data.length === 0) throw new AppError('not_found', '企画書が見つかりません')
    revalidatePath(`/projects/${data[0].project_id}`)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

export type ProposalVersionKind = 'autosave' | 'review'

export type ProposalVersion = {
  id: string
  content: string
  kind: ProposalVersionKind
  created_at: string
}

/** バージョン履歴の一覧（新しい順。差分計算用に content も返す） */
export async function listProposalVersions(
  proposalId: string,
): Promise<ActionResult<ProposalVersion[]>> {
  try {
    const pid = uuidSchema.parse(proposalId)
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('proposal_versions')
      .select('id, content, kind, created_at')
      .eq('proposal_id', pid)
      .order('created_at', { ascending: false })
    if (error) throw new AppError('internal', error.message)
    return { ok: true, data: (data ?? []) as ProposalVersion[] }
  } catch (error) {
    return toActionError(error)
  }
}

/** 指定バージョンの本文へ復元する。復元自体を取り消せるよう、現在の本文を間引きなしでスナップショットする */
export async function restoreProposalVersion(
  proposalId: string,
  versionId: string,
): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(proposalId)
    const vid = uuidSchema.parse(versionId)
    const supabase = await createClient()
    const { data: version, error: versionError } = await supabase
      .from('proposal_versions')
      .select('content')
      .eq('id', vid)
      .eq('proposal_id', pid)
      .maybeSingle()
    if (versionError) throw new AppError('internal', versionError.message)
    if (!version) throw new AppError('not_found', 'バージョンが見つかりません')

    const current = await fetchProposalSnapshot(supabase, pid)
    // 現在と同一内容への復元は何もしない（無駄な版を作らない）
    if (version.content === current.content) {
      return { ok: true }
    }
    await insertProposalSnapshot(supabase, pid, current.content)

    const { data, error } = await supabase
      .from('proposals')
      .update({ content: version.content })
      .eq('id', pid)
      .select('project_id')
    if (error) throw new AppError('internal', error.message)
    if (!data || data.length === 0) throw new AppError('not_found', '企画書が見つかりません')
    revalidatePath(`/projects/${current.project_id}`)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

export type LinkedNote = { id: string; title: string }

/** 企画書にノートを紐づける（既に紐づけ済みなら成功扱い） */
export async function attachProposalNote(
  proposalId: string,
  noteId: string,
): Promise<ActionResult<LinkedNote>> {
  try {
    const pid = uuidSchema.parse(proposalId)
    const nid = uuidSchema.parse(noteId)
    const supabase = await createClient()

    // 先にRLS越しで所有確認（他人・実在しない・ごみ箱中のノートは not_found に正規化する）
    const { data: note, error: noteError } = await supabase
      .from('notes')
      .select('id, title')
      .eq('id', nid)
      .is('deleted_at', null)
      .maybeSingle()
    if (noteError) throw new AppError('internal', noteError.message)
    if (!note) throw new AppError('not_found', 'ノートが見つかりません')

    const { error } = await supabase
      .from('proposal_notes')
      .upsert({ proposal_id: pid, note_id: nid }, { ignoreDuplicates: true })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/projects')
    return { ok: true, data: note }
  } catch (error) {
    return toActionError(error)
  }
}

export async function detachProposalNote(
  proposalId: string,
  noteId: string,
): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(proposalId)
    const nid = uuidSchema.parse(noteId)
    const supabase = await createClient()
    const { error } = await supabase
      .from('proposal_notes')
      .delete()
      .eq('proposal_id', pid)
      .eq('note_id', nid)
    if (error) throw new AppError('internal', error.message)
    revalidatePath('/projects')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 仮タイトルタグの付いたノート群（プロジェクト作成ダイアログの一括紐づけ候補。ごみ箱中は除外） */
export async function getNotesByTag(tagId: string): Promise<ActionResult<LinkedNote[]>> {
  try {
    const tid = uuidSchema.parse(tagId)
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('note_tags')
      .select('notes (id, title, deleted_at)')
      .eq('tag_id', tid)
    if (error) throw new AppError('internal', error.message)
    const notes = (data ?? [])
      .flatMap((row) => (row.notes ? [row.notes] : []))
      .filter((note) => note.deleted_at === null)
      .map((note) => ({ id: note.id, title: note.title }))
    return { ok: true, data: notes }
  } catch (error) {
    return toActionError(error)
  }
}

// ILIKE パターンを壊す文字を除去・エスケープする（app/notes/page.tsx と同じ方針）
function toSearchPattern(q: string): string {
  const cleaned = q.replaceAll(/[,()"\\]/g, '').replaceAll(/[%_]/g, (m) => `\\${m}`)
  return `%${cleaned}%`
}

/** 個別紐づけ用のノート検索（タイトル一致・ごみ箱中は除外） */
export async function searchNotesForLink(query: string): Promise<ActionResult<LinkedNote[]>> {
  try {
    const q = z.string().min(1).max(100).parse(query.trim())
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('notes')
      .select('id, title')
      .is('deleted_at', null)
      .ilike('title', toSearchPattern(q))
      .order('updated_at', { ascending: false })
      .limit(20)
    if (error) throw new AppError('internal', error.message)
    return { ok: true, data: data ?? [] }
  } catch (error) {
    return toActionError(error)
  }
}
