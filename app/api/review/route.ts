import { streamText } from 'ai'
import { z } from 'zod'

import { resolveModel } from '@/lib/ai/models'
import {
  buildProposalReviewInput,
  buildProposalReviewSystemPrompt,
  type FeedbackHistoryItem,
  type NoteContext,
} from '@/lib/ai/prompts'
import { AppError, errorResponse } from '@/lib/errors'
import type { AiCapability, ReviewVerdict } from '@/lib/schemas/enums'
import { reviewRequestSchema } from '@/lib/schemas/review'
import { createClient } from '@/lib/supabase/server'

// ストリーミング応答のため Vercel Functions の実行上限を延長（レビュー文書は掘り下げ応答より長い）
export const maxDuration = 120

/**
 * フィードバック末尾の固定判定行をパースする（SPEC-proposal-review §3.3）。
 * パース不能は差し戻し扱い（フェイルクローズ）
 */
function parseVerdict(text: string): ReviewVerdict {
  // 行単位でマッチさせ、文中の「判定: 承認しません」等の偽陽性やノート経由の誘導を防ぐ
  // （強調で装飾されても拾えるよう前後の ** は許容する）
  const matches = [...text.matchAll(/^\s*\**判定[:：]\s*(承認|差し戻し)\**\s*$/gm)]
  const last = matches.at(-1)
  if (!last) return 'needs_work'
  return last[1] === '承認' ? 'approved' : 'needs_work'
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const parsed = reviewRequestSchema.safeParse(await req.json())
    if (!parsed.success) throw new AppError('validation', 'リクエストの形式が不正です')
    const { sessionId } = parsed.data

    // RLS越しの取得＝所有確認を兼ねる。担当ペルソナとプロファイルも同時に引く
    const { data: session, error: sessionError } = await supabase
      .from('review_sessions')
      .select(
        'id, status, target_ref, project_id, personas (description, ai_capability), review_profiles (prompt_template)',
      )
      .eq('id', sessionId)
      .maybeSingle()
    if (sessionError) throw new AppError('internal', sessionError.message)
    if (!session) throw new AppError('not_found', 'レビューセッションが見つかりません')
    if (session.status !== 'running') {
      throw new AppError('validation', 'このレビューセッションは終了しています')
    }
    if (!session.personas || !session.review_profiles) {
      throw new AppError('internal', '担当ペルソナまたはレビュープロファイルが見つかりません')
    }

    const proposalId = z.uuid().safeParse(session.target_ref)
    if (!proposalId.success) throw new AppError('internal', 'レビュー対象が不正です')

    const { data: proposal, error: proposalError } = await supabase
      .from('proposals')
      .select('id, project_id, genre, target_audience, content, status')
      .eq('id', proposalId.data)
      .maybeSingle()
    if (proposalError) throw new AppError('internal', proposalError.message)
    if (!proposal || proposal.project_id !== session.project_id) {
      throw new AppError('not_found', '企画書が見つかりません')
    }

    // 紐づけノート全文（ごみ箱中は除外。SPEC §3.3）
    const { data: links, error: linksError } = await supabase
      .from('proposal_notes')
      .select('notes (title, content, deleted_at, note_tags (tags (name)))')
      .eq('proposal_id', proposal.id)
    if (linksError) throw new AppError('internal', linksError.message)
    const notes: NoteContext[] = (links ?? [])
      .flatMap((row) => (row.notes ? [row.notes] : []))
      .filter((note) => note.deleted_at === null)
      .map((note) => ({
        title: note.title,
        content: note.content,
        tags: note.note_tags.flatMap((nt) => (nt.tags ? [nt.tags.name] : [])),
      }))

    // 同一セッションの過去フィードバック・返答メモ全件（反復の文脈。SPEC §2）
    const { data: feedbacks, error: feedbacksError } = await supabase
      .from('review_feedbacks')
      .select('content, user_response')
      .eq('review_session_id', session.id)
      .order('created_at')
    if (feedbacksError) throw new AppError('internal', feedbacksError.message)
    const history: FeedbackHistoryItem[] = (feedbacks ?? []).map((f) => ({
      content: f.content,
      userResponse: f.user_response,
    }))

    const model = await resolveModel(supabase, session.personas.ai_capability as AiCapability)

    const result = streamText({
      model,
      system: buildProposalReviewSystemPrompt({
        personaDescription: session.personas.description,
        promptTemplate: session.review_profiles.prompt_template,
      }),
      prompt: buildProposalReviewInput({
        proposal: {
          genre: proposal.genre,
          targetAudience: proposal.target_audience,
          content: proposal.content,
        },
        notes,
        history,
      }),
      // 生成完了時にフィードバックを保存する（stop によるクライアント切断時は保存しない）
      onFinish: async ({ text }) => {
        if (!text) return
        try {
          const { error: insertError } = await supabase.from('review_feedbacks').insert({
            review_session_id: session.id,
            content: text,
            verdict: parseVerdict(text),
          })
          if (insertError) {
            console.error('フィードバックの保存に失敗:', insertError.message)
            return
          }
          // 初回レビュー実行で draft → in_review（SPEC §3.2）
          if (proposal.status === 'draft') {
            const { error: statusError } = await supabase
              .from('proposals')
              .update({ status: 'in_review' })
              .eq('id', proposal.id)
            if (statusError) console.error('企画書ステータスの更新に失敗:', statusError.message)
          }
        } catch (error) {
          // 保存の失敗でストリーム自体は壊さない（クライアントは一覧の取り直しで気づける）
          console.error('フィードバックの保存に失敗:', error)
        }
      },
    })

    return result.toTextStreamResponse()
  } catch (error) {
    return errorResponse(error)
  }
}
