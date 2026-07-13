'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { PROPOSAL_INITIAL_CONTENT } from '@/lib/constants/proposal-template'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { projectInputSchema, projectUpdateSchema, proposalUpdateSchema } from '@/lib/schemas/projects'
import type { ProjectInput, ProjectUpdate, ProposalUpdate } from '@/lib/schemas/projects'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()
const noteIdsSchema = z.array(z.uuid()).max(100)

/**
 * プロジェクト作成。企画書（proposals 行）も同時に自動作成する（1対1・定型テンプレ入り）。
 * noteIds はプロジェクト作成ダイアログの一括紐づけ（仮タイトルタグからの候補）
 */
export async function createProject(
  input: ProjectInput,
  noteIds: string[] = [],
): Promise<ActionResult<{ projectId: string }>> {
  try {
    const parsed = projectInputSchema.parse(input)
    const ids = noteIdsSchema.parse(noteIds)
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
      .insert({ project_id: project.id, content: PROPOSAL_INITIAL_CONTENT })
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

/** 企画書の自動保存の受け口（genre / target_audience / content。status はここでは変えない） */
export async function updateProposal(id: string, input: ProposalUpdate): Promise<ActionResult> {
  try {
    const proposalId = uuidSchema.parse(id)
    const parsed = proposalUpdateSchema.parse(input)
    const supabase = await createClient()
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
