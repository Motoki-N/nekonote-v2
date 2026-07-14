'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { resolveProfileForPhase, resolveReviewerPersona } from '@/lib/review-validation'
import type { ReviewVerdict } from '@/lib/schemas/enums'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()

// レビュー対象の種別（SPEC-beat-board §3.4。target_ref に入る id の意味が変わる）。
// 値は review_profiles.target_phase と一致させている（プロファイル検証に使う）
export type ReviewTargetKind = 'proposal' | 'structure' | 'scene'
const reviewTargetKindSchema = z.enum(['proposal', 'structure', 'scene'])

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

/** プロファイルセレクタの1項目（SPEC-dashboard-critique-settings §3.2） */
export type ProfileOption = {
  id: string
  name: string
  defaultPersonaId: string | null
  /** この対象× このプロファイルの running セッションに記録済みのペルソナ名（なければ null） */
  runningPersonaName: string | null
}

export type PersonaOption = {
  id: string
  name: string
}

export type ReviewPanelBootstrap = {
  profiles: ProfileOption[]
  /** 起用できるペルソナ（reviewer 型のみ） */
  personas: PersonaOption[]
  /** 既定選択: running セッションが最新のプロファイル → なければ標準（is_default） */
  initialProfileId: string | null
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

/**
 * パネル初期表示用の一括読み取り（SPEC-dashboard-critique-settings §3.2）。
 * 対象フェーズの「標準＋自分の」プロファイル一覧・reviewer ペルソナ一覧・既定選択を返す
 */
export async function getReviewPanelBootstrap(
  kind: ReviewTargetKind,
  targetId: string,
): Promise<ActionResult<ReviewPanelBootstrap>> {
  try {
    const parsedKind = reviewTargetKindSchema.parse(kind)
    const tid = uuidSchema.parse(targetId)
    const supabase = await createClient()

    const [profilesResult, personasResult, runningResult] = await Promise.all([
      supabase
        .from('review_profiles')
        .select('id, name, is_default, default_persona_id')
        .eq('target_phase', parsedKind)
        .order('is_default', { ascending: false })
        .order('created_at'),
      supabase
        .from('personas')
        .select('id, name')
        .eq('persona_type', 'reviewer')
        .order('is_default', { ascending: false })
        .order('created_at'),
      supabase
        .from('review_sessions')
        .select('review_profile_id, created_at, personas (name)')
        .eq('target_ref', tid)
        .eq('status', 'running')
        .order('created_at', { ascending: false }),
    ])
    if (profilesResult.error) throw new AppError('internal', profilesResult.error.message)
    if (personasResult.error) throw new AppError('internal', personasResult.error.message)
    if (runningResult.error) throw new AppError('internal', runningResult.error.message)

    // プロファイルごとの running セッション（新しい順なので最初の1件が最新）
    const runningByProfile = new Map<string, { personaName: string | null }>()
    for (const session of runningResult.data ?? []) {
      if (session.review_profile_id && !runningByProfile.has(session.review_profile_id)) {
        runningByProfile.set(session.review_profile_id, {
          personaName: session.personas?.name ?? null,
        })
      }
    }

    const profiles: ProfileOption[] = (profilesResult.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      defaultPersonaId: p.default_persona_id,
      runningPersonaName: runningByProfile.get(p.id)?.personaName ?? null,
    }))

    // 既定選択: running セッションが最新のプロファイル → 標準 → 先頭
    const latestRunningProfileId = (runningResult.data ?? []).find(
      (s) => s.review_profile_id && profiles.some((p) => p.id === s.review_profile_id),
    )?.review_profile_id
    const defaultProfile = (profilesResult.data ?? []).find((p) => p.is_default)
    const initialProfileId = latestRunningProfileId ?? defaultProfile?.id ?? profiles[0]?.id ?? null

    return {
      ok: true,
      data: {
        profiles,
        personas: (personasResult.data ?? []).map((p) => ({ id: p.id, name: p.name })),
        initialProfileId,
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/** パネル表示用の読み取り: 対象×プロファイルの running セッションがなければ null（開いただけでは行を作らない） */
export async function getReviewSessionState(
  kind: ReviewTargetKind,
  targetId: string,
  profileId: string,
): Promise<ActionResult<ReviewSessionState | null>> {
  try {
    reviewTargetKindSchema.parse(kind)
    const tid = uuidSchema.parse(targetId)
    const pid = uuidSchema.parse(profileId)
    const supabase = await createClient()

    const { data: session, error: selectError } = await supabase
      .from('review_sessions')
      .select('id')
      .eq('target_ref', tid)
      // 対象×プロファイルごとにセッションが並存する（SPEC-dashboard-critique-settings §3.2）
      .eq('review_profile_id', pid)
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
 * running セッションは対象×プロファイルごとに高々1本（アプリロジックで担保）。
 * profileId / personaId はクライアント指定値なのでサーバー側で再検証する（フェーズ一致・reviewer 型）。
 * personaId は新規セッション作成時のみ効く（既存 running のペルソナは変更しない=会話の一貫性）
 */
export async function getOrCreateReviewSession(
  kind: ReviewTargetKind,
  targetId: string,
  profileId: string,
  personaId?: string,
): Promise<ActionResult<ReviewSessionState>> {
  try {
    const parsedKind = reviewTargetKindSchema.parse(kind)
    const tid = uuidSchema.parse(targetId)
    const pid = uuidSchema.parse(profileId)
    const requestedPersonaId = personaId === undefined ? undefined : uuidSchema.parse(personaId)
    const supabase = await createClient()

    const { projectId } = await resolveTarget(supabase, parsedKind, tid)
    const profile = await resolveProfileForPhase(supabase, pid, parsedKind)

    const { data: existing, error: selectError } = await supabase
      .from('review_sessions')
      .select('id')
      .eq('target_ref', tid)
      .eq('review_profile_id', pid)
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)

    let sessionId = existing?.id
    if (!sessionId) {
      const effectivePersonaId = requestedPersonaId ?? profile.defaultPersonaId
      if (!effectivePersonaId) {
        throw new AppError('validation', '担当ペルソナを選択してください')
      }
      const persona = await resolveReviewerPersona(supabase, effectivePersonaId)

      const { data: created, error: insertError } = await supabase
        .from('review_sessions')
        .insert({
          project_id: projectId,
          review_profile_id: profile.id,
          persona_id: persona.id,
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
 * プロファイル並存で「対象の最新 running」が一意でなくなったため、
 * パネルが表示中のセッション id を明示的に受け取る（SPEC-dashboard-critique-settings §3.2）。
 * 最新フィードバックの判定が承認であることをサーバー側でも検証したうえで、
 * proposals.status = approved ＋セッション completed にする
 */
export async function approveProposal(sessionId: string): Promise<ActionResult> {
  try {
    const sid = uuidSchema.parse(sessionId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認を兼ねる
    const { data: session, error: sessionError } = await supabase
      .from('review_sessions')
      .select('id, project_id, target_ref, status, review_profiles (target_phase)')
      .eq('id', sid)
      .maybeSingle()
    if (sessionError) throw new AppError('internal', sessionError.message)
    if (!session) throw new AppError('not_found', 'レビューセッションが見つかりません')
    if (session.status !== 'running') {
      throw new AppError('validation', 'このレビューセッションは終了しています')
    }
    // 企画書レビューのセッションであること（他フェーズのセッションで企画を通させない）
    if (session.review_profiles?.target_phase !== 'proposal') {
      throw new AppError('validation', '企画書レビューのセッションではありません')
    }
    const proposalId = uuidSchema.safeParse(session.target_ref)
    if (!proposalId.success) throw new AppError('internal', 'レビュー対象が不正です')

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
      .eq('id', proposalId.data)
      .eq('project_id', session.project_id) // セッションと企画書の対応を担保
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
