'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  EDITOR_PERSONA_ID,
  PROPOSAL_REVIEW_PROFILE_ID,
  SCENE_REVIEW_PROFILE_ID,
  STRUCTURE_REVIEW_PROFILE_ID,
} from '@/lib/ai/personas'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import type { ReviewVerdict } from '@/lib/schemas/enums'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()

// レビュー対象の種別（SPEC-beat-board §3.4。target_ref に入る id の意味が変わる）
export type ReviewTargetKind = 'proposal' | 'structure' | 'scene'
const reviewTargetKindSchema = z.enum(['proposal', 'structure', 'scene'])

const PROFILE_BY_KIND: Record<ReviewTargetKind, string> = {
  proposal: PROPOSAL_REVIEW_PROFILE_ID,
  structure: STRUCTURE_REVIEW_PROFILE_ID,
  scene: SCENE_REVIEW_PROFILE_ID,
}

export type FeedbackRecord = {
  id: string
  content: string
  user_response: string | null
  verdict: ReviewVerdict | null
  created_at: string
}

export type ReviewSessionState = {
  sessionId: string
  feedbacks: FeedbackRecord[]
}

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * 対象の RLS 越し所有確認と、セッション作成に使う project_id の解決。
 * target_ref: proposal = 企画書id / structure = プロジェクトid / scene = シーンid
 */
async function resolveTarget(
  supabase: Supabase,
  kind: ReviewTargetKind,
  targetId: string,
): Promise<{ projectId: string }> {
  if (kind === 'proposal') {
    const { data, error } = await supabase
      .from('proposals')
      .select('id, project_id')
      .eq('id', targetId)
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!data) throw new AppError('not_found', '企画書が見つかりません')
    return { projectId: data.project_id }
  }
  if (kind === 'structure') {
    const { data, error } = await supabase
      .from('projects')
      .select('id')
      .eq('id', targetId)
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!data) throw new AppError('not_found', 'プロジェクトが見つかりません')
    return { projectId: data.id }
  }
  const { data, error } = await supabase
    .from('scenes')
    .select('id, project_id')
    .eq('id', targetId)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data) throw new AppError('not_found', 'シーンが見つかりません')
  return { projectId: data.project_id }
}

async function fetchFeedbacks(supabase: Supabase, sessionId: string): Promise<FeedbackRecord[]> {
  const { data, error } = await supabase
    .from('review_feedbacks')
    .select('id, content, user_response, verdict, created_at')
    .eq('review_session_id', sessionId)
    .order('created_at')
  if (error) throw new AppError('internal', error.message)
  return (data ?? []) as FeedbackRecord[]
}

/** パネル表示用の読み取り: running セッションがなければ null（開いただけでは行を作らない） */
export async function getReviewSessionState(
  kind: ReviewTargetKind,
  targetId: string,
): Promise<ActionResult<ReviewSessionState | null>> {
  try {
    reviewTargetKindSchema.parse(kind)
    const tid = uuidSchema.parse(targetId)
    const supabase = await createClient()

    const { data: session, error: selectError } = await supabase
      .from('review_sessions')
      .select('id')
      .eq('target_ref', tid)
      // kind とプロファイルの対応ずれ防止（target_ref のセマンティクスはDB制約がないため多層防御）
      .eq('review_profile_id', PROFILE_BY_KIND[kind])
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)
    if (!session) return { ok: true, data: null }

    return {
      ok: true,
      data: { sessionId: session.id, feedbacks: await fetchFeedbacks(supabase, session.id) },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * running レビューセッション（反復スレッド）を get-or-create し、フィードバック履歴を返す。
 * running セッションは対象ごとに高々1本（SPEC-proposal-review §4.1。アプリロジックで担保）
 */
export async function getOrCreateReviewSession(
  kind: ReviewTargetKind,
  targetId: string,
): Promise<ActionResult<ReviewSessionState>> {
  try {
    const parsedKind = reviewTargetKindSchema.parse(kind)
    const tid = uuidSchema.parse(targetId)
    const supabase = await createClient()

    const { projectId } = await resolveTarget(supabase, parsedKind, tid)

    const { data: existing, error: selectError } = await supabase
      .from('review_sessions')
      .select('id')
      .eq('target_ref', tid)
      // kind とプロファイルの対応ずれ防止（getReviewSessionState と同じ多層防御）
      .eq('review_profile_id', PROFILE_BY_KIND[kind])
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)

    let sessionId = existing?.id
    if (!sessionId) {
      const { data: created, error: insertError } = await supabase
        .from('review_sessions')
        .insert({
          project_id: projectId,
          review_profile_id: PROFILE_BY_KIND[parsedKind],
          persona_id: EDITOR_PERSONA_ID,
          target_ref: tid,
          status: 'running',
        })
        .select('id')
        .single()
      if (insertError || !created) {
        throw new AppError('internal', insertError?.message ?? 'レビューセッションの作成に失敗しました')
      }
      sessionId = created.id
    }

    return {
      ok: true,
      data: { sessionId, feedbacks: await fetchFeedbacks(supabase, sessionId) },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/** フィードバックへの返答メモを保存する（改稿の意図や反論を次のレビューに伝える） */
export async function saveFeedbackResponse(
  feedbackId: string,
  text: string,
): Promise<ActionResult> {
  try {
    const fid = uuidSchema.parse(feedbackId)
    const response = z.string().max(5000).parse(text)
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('review_feedbacks')
      .update({ user_response: response.trim() === '' ? null : response })
      .eq('id', fid)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!data || data.length === 0) throw new AppError('not_found', 'フィードバックが見つかりません')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 「企画を通す」確定（SPEC-proposal-review §3.2）。
 * 最新フィードバックの判定が承認であることをサーバー側でも検証したうえで、
 * proposals.status = approved ＋セッション completed にする
 */
export async function approveProposal(proposalId: string): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(proposalId)
    const supabase = await createClient()

    const { data: session, error: sessionError } = await supabase
      .from('review_sessions')
      .select('id, project_id')
      .eq('target_ref', pid)
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (sessionError) throw new AppError('internal', sessionError.message)
    if (!session) throw new AppError('not_found', '進行中のレビューセッションがありません')

    const { data: latest, error: latestError } = await supabase
      .from('review_feedbacks')
      .select('verdict')
      .eq('review_session_id', session.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestError) throw new AppError('internal', latestError.message)
    if (latest?.verdict !== 'approved') {
      throw new AppError('validation', '最新のレビューで承認が出ていないため、企画を通せません')
    }

    const { data: updated, error: proposalError } = await supabase
      .from('proposals')
      .update({ status: 'approved' })
      .eq('id', pid)
      .select('id')
    if (proposalError) throw new AppError('internal', proposalError.message)
    if (!updated || updated.length === 0) throw new AppError('not_found', '企画書が見つかりません')

    const { error: completeError } = await supabase
      .from('review_sessions')
      .update({ status: 'completed' })
      .eq('id', session.id)
    if (completeError) throw new AppError('internal', completeError.message)

    revalidatePath('/projects')
    revalidatePath(`/projects/${session.project_id}`)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
