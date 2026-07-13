'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { EDITOR_PERSONA_ID, PROPOSAL_REVIEW_PROFILE_ID } from '@/lib/ai/personas'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import type { ReviewVerdict } from '@/lib/schemas/enums'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()

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

/** パネル表示用の読み取り: running セッションがなければ null（開いただけでは行を作らない） */
export async function getReviewSessionState(
  proposalId: string,
): Promise<ActionResult<ReviewSessionState | null>> {
  try {
    const pid = uuidSchema.parse(proposalId)
    const supabase = await createClient()

    const { data: session, error: selectError } = await supabase
      .from('review_sessions')
      .select('id')
      .eq('target_ref', pid)
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)
    if (!session) return { ok: true, data: null }

    const { data: feedbacks, error: feedbacksError } = await supabase
      .from('review_feedbacks')
      .select('id, content, user_response, verdict, created_at')
      .eq('review_session_id', session.id)
      .order('created_at')
    if (feedbacksError) throw new AppError('internal', feedbacksError.message)

    return {
      ok: true,
      data: { sessionId: session.id, feedbacks: (feedbacks ?? []) as FeedbackRecord[] },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 企画書の running レビューセッション（反復スレッド）を get-or-create し、フィードバック履歴を返す。
 * running セッションは企画書ごとに高々1本（SPEC-proposal-review §4.1。アプリロジックで担保）
 */
export async function getOrCreateReviewSession(
  proposalId: string,
): Promise<ActionResult<ReviewSessionState>> {
  try {
    const pid = uuidSchema.parse(proposalId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認を兼ねる
    const { data: proposal, error: proposalError } = await supabase
      .from('proposals')
      .select('id, project_id')
      .eq('id', pid)
      .maybeSingle()
    if (proposalError) throw new AppError('internal', proposalError.message)
    if (!proposal) throw new AppError('not_found', '企画書が見つかりません')

    const { data: existing, error: selectError } = await supabase
      .from('review_sessions')
      .select('id')
      .eq('target_ref', pid)
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
          project_id: proposal.project_id,
          review_profile_id: PROPOSAL_REVIEW_PROFILE_ID,
          persona_id: EDITOR_PERSONA_ID,
          target_ref: pid,
          status: 'running',
        })
        .select('id')
        .single()
      if (insertError || !created) {
        throw new AppError('internal', insertError?.message ?? 'レビューセッションの作成に失敗しました')
      }
      sessionId = created.id
    }

    const { data: feedbacks, error: feedbacksError } = await supabase
      .from('review_feedbacks')
      .select('id, content, user_response, verdict, created_at')
      .eq('review_session_id', sessionId)
      .order('created_at')
    if (feedbacksError) throw new AppError('internal', feedbacksError.message)

    return {
      ok: true,
      data: { sessionId, feedbacks: (feedbacks ?? []) as FeedbackRecord[] },
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
