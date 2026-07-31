import { streamText } from 'ai'
import { z } from 'zod'

import { resolveModel } from '@/lib/ai/models'
import { recordAiUsage } from '@/lib/ai/usage'
import {
  buildCharacterNoteReviewInput,
  buildManuscriptCritiqueInput,
  buildProposalReviewInput,
  buildReviewSystemPrompt,
  buildSceneReviewInput,
  buildStructureReviewInput,
  type CritiqueProposalScope,
  type FeedbackHistoryItem,
  type NoteContext,
  type ProposalContext,
} from '@/lib/ai/prompts'
import type { SceneRecord } from '@/lib/board'
import { AppError, errorResponse } from '@/lib/errors'
import { patCredentialProvider } from '@/lib/git/credentials'
import { countChars, fetchAllManuscriptContents } from '@/lib/manuscript-content'
import { enforceRateLimit } from '@/lib/rate-limit'
import type {
  AiCapability,
  ReferenceScope,
  ReviewVerdict,
  StructureTemplate,
  WritingGenre,
} from '@/lib/schemas/enums'
import { CRITIQUE_CONFIRM_CHARS, CRITIQUE_MAX_CHARS } from '@/lib/schemas/manuscript'
import { reviewRequestSchema } from '@/lib/schemas/review'
import { createClient } from '@/lib/supabase/server'

// ストリーミング応答のため Vercel Functions の実行上限を延長（レビュー文書は掘り下げ応答より長い）
export const maxDuration = 120

const uuidSchema = z.uuid()

type Supabase = Awaited<ReturnType<typeof createClient>>

// 判定行を持つレビュー種別（企画書＋構成・シーン。Issue #57 でゲート化）
const VERDICT_PHASES = ['proposal', 'structure', 'scene']

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

/** プロジェクトの企画書を取得（構成・シーンレビューのコンテキスト用。RLS越し） */
async function fetchProposalContext(
  supabase: Supabase,
  projectId: string,
): Promise<ProposalContext> {
  const { data, error } = await supabase
    .from('proposals')
    .select('writing_genre, purpose, genre, target_audience, content')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data) throw new AppError('not_found', '企画書が見つかりません')
  return {
    writingGenre: data.writing_genre as WritingGenre,
    purpose: data.purpose,
    genre: data.genre,
    targetAudience: data.target_audience,
    content: data.content,
  }
}

/**
 * 企画書（RLS越し取得＋セッションのプロジェクト一致検証）と紐づけノート全文（ごみ箱中は除外）。
 * 企画書レビューとキャラクターレビューは資料一式が同一なので共用する（SPEC-character-review §5.2）。
 * ノートの id はノート単位キャラクターレビューの対象特定に使う（Issue #47）
 */
async function fetchProposalWithNotes(supabase: Supabase, proposalId: string, projectId: string) {
  const { data: proposal, error: proposalError } = await supabase
    .from('proposals')
    .select('id, project_id, writing_genre, purpose, genre, target_audience, content, status')
    .eq('id', proposalId)
    .maybeSingle()
  if (proposalError) throw new AppError('internal', proposalError.message)
  if (!proposal || proposal.project_id !== projectId) {
    throw new AppError('not_found', '企画書が見つかりません')
  }

  const { data: links, error: linksError } = await supabase
    .from('proposal_notes')
    .select('notes (id, title, content, deleted_at, note_tags (tags (name)))')
    .eq('proposal_id', proposal.id)
  if (linksError) throw new AppError('internal', linksError.message)
  const notes: (NoteContext & { id: string })[] = (links ?? [])
    .flatMap((row) => (row.notes ? [row.notes] : []))
    .filter((note) => note.deleted_at === null)
    .map((note) => ({
      id: note.id,
      title: note.title,
      content: note.content,
      tags: note.note_tags.flatMap((nt) => (nt.tags ? [nt.tags.name] : [])),
    }))

  return { proposal, notes }
}

/** プロジェクトの構成テンプレートを取得（構成・シーンレビューのコンテキスト用。Issue #54） */
async function fetchStructureTemplate(
  supabase: Supabase,
  projectId: string,
): Promise<StructureTemplate> {
  const { data, error } = await supabase
    .from('projects')
    .select('structure_template')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data) throw new AppError('not_found', 'プロジェクトが見つかりません')
  return data.structure_template as StructureTemplate
}

/** プロジェクトの全シーンを構成順で取得（RLS越し） */
async function fetchScenes(supabase: Supabase, projectId: string): Promise<SceneRecord[]> {
  const { data, error } = await supabase
    .from('scenes')
    .select(
      'id, project_id, part, anchor, order_index, title, content, emotion_start, emotion_end, status, manuscript_path',
    )
    .eq('project_id', projectId)
    .order('order_index')
  if (error) throw new AppError('internal', error.message)
  return (data ?? []) as SceneRecord[]
}

/**
 * プロジェクト内全シーンの紐づけノート全文をシーンID単位でまとめて取得
 * （構成レビュー用。ごみ箱中は除外。Issue #58）
 */
async function fetchSceneNotesByScene(
  supabase: Supabase,
  projectId: string,
): Promise<Record<string, NoteContext[]>> {
  const { data, error } = await supabase
    .from('scene_notes')
    .select('scene_id, notes (title, content, deleted_at, note_tags (tags (name))), scenes!inner (project_id)')
    .eq('scenes.project_id', projectId)
  if (error) throw new AppError('internal', error.message)
  const bySceneId: Record<string, NoteContext[]> = {}
  for (const row of data ?? []) {
    if (!row.notes || row.notes.deleted_at !== null) continue
    ;(bySceneId[row.scene_id] ??= []).push({
      title: row.notes.title,
      content: row.notes.content,
      tags: row.notes.note_tags.flatMap((nt) => (nt.tags ? [nt.tags.name] : [])),
    })
  }
  return bySceneId
}

/** 単一シーンの紐づけノート全文（シーンレビュー用。ごみ箱中は除外。Issue #58） */
async function fetchNotesForScene(supabase: Supabase, sceneId: string): Promise<NoteContext[]> {
  const { data, error } = await supabase
    .from('scene_notes')
    .select('notes (title, content, deleted_at, note_tags (tags (name)))')
    .eq('scene_id', sceneId)
  if (error) throw new AppError('internal', error.message)
  return (data ?? [])
    .flatMap((row) => (row.notes ? [row.notes] : []))
    .filter((note) => note.deleted_at === null)
    .map((note) => ({
      title: note.title,
      content: note.content,
      tags: note.note_tags.flatMap((nt) => (nt.tags ? [nt.tags.name] : [])),
    }))
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    // APIコスト暴走の抑止（security-audit-20260714 M-1）。講評は1回で最大30万字を投げるため厳しめ
    enforceRateLimit(user.id, 'review', { perMinute: 3, perDay: 60 })

    const parsed = reviewRequestSchema.safeParse(await req.json())
    if (!parsed.success) throw new AppError('validation', 'リクエストの形式が不正です')
    const { sessionId, confirmLong } = parsed.data

    // RLS越しの取得＝所有確認を兼ねる。担当ペルソナとプロファイルも同時に引く
    const { data: session, error: sessionError } = await supabase
      .from('review_sessions')
      .select(
        'id, status, target_ref, note_id, project_id, personas (description, ai_capability, reference_scope), review_profiles (prompt_template, target_phase)',
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

    const phase = session.review_profiles.target_phase
    const targetRef = uuidSchema.safeParse(session.target_ref)
    if (!targetRef.success) throw new AppError('internal', 'レビュー対象が不正です')

    // 同一セッションの過去フィードバック・返答メモ全件（反復の文脈）
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

    // レビュー種別ごとに対象の所有確認とコンテキスト組み立て（SPEC-beat-board §3.5）
    let prompt: string
    let proposalIdForStatus: string | null = null // 企画書レビューのみ: draft→in_review 遷移用

    if (phase === 'proposal' || phase === 'character') {
      // 企画書・キャラクターレビュー: target_ref = 企画書id。資料一式（企画書＋紐づけノート）は同一で、
      // 観点はプロファイルのプロンプトが絞る（SPEC-proposal-review §3.3 / SPEC-character-review §5.2）
      const { proposal, notes } = await fetchProposalWithNotes(
        supabase,
        targetRef.data,
        session.project_id,
      )

      if (session.note_id !== null) {
        // ノート1枚に絞ったキャラクターレビュー（Issue #47）。note_id は character フェーズ専用
        if (phase !== 'character') throw new AppError('internal', 'レビュー対象が不正です')
        const target = notes.find((note) => note.id === session.note_id)
        // セッション作成後に紐づけ解除・ごみ箱入りされた場合はフェイルクローズ
        if (!target) {
          throw new AppError(
            'not_found',
            '対象ノートが見つかりません（企画書との紐づけが解除されたか、ごみ箱に入っている可能性があります）',
          )
        }
        const otherNotes = notes.filter((note) => note.id !== session.note_id)
        // LLM入力肥大化ガード（監査L-3。対象は企画書＋対象ノート1枚のみで計算）
        const noteInputChars = countChars(proposal.content) + countChars(target.content)
        if (noteInputChars > CRITIQUE_MAX_CHARS) {
          throw new AppError(
            'validation',
            `企画書と対象ノートの合計が約${noteInputChars.toLocaleString('ja-JP')}字あり、レビューの上限（${CRITIQUE_MAX_CHARS.toLocaleString('ja-JP')}字）を超えています`,
          )
        }
        prompt = buildCharacterNoteReviewInput({
          proposal: {
            writingGenre: proposal.writing_genre as WritingGenre,
            purpose: proposal.purpose,
            genre: proposal.genre,
            targetAudience: proposal.target_audience,
            content: proposal.content,
          },
          note: target,
          otherNotes,
          history,
        })
      } else {
        // 紐づけノート経由のLLM入力肥大化ガード（監査L-3。上限は講評の実行不可ラインを流用）
        const inputChars =
          countChars(proposal.content) +
          notes.reduce((sum, note) => sum + countChars(note.content), 0)
        if (inputChars > CRITIQUE_MAX_CHARS) {
          throw new AppError(
            'validation',
            `企画書と紐づけノートの合計が約${inputChars.toLocaleString('ja-JP')}字あり、レビューの上限（${CRITIQUE_MAX_CHARS.toLocaleString('ja-JP')}字）を超えています。紐づけノートを減らしてください`,
          )
        }
        prompt = buildProposalReviewInput({
          proposal: {
            writingGenre: proposal.writing_genre as WritingGenre,
            purpose: proposal.purpose,
            genre: proposal.genre,
            targetAudience: proposal.target_audience,
            content: proposal.content,
          },
          notes,
          history,
        })
        // draft→in_review 遷移は企画書レビュー専用（キャラクターレビューはステータスに触れない）
        if (phase === 'proposal' && proposal.status === 'draft') proposalIdForStatus = proposal.id
      }
    } else if (phase === 'structure') {
      // 構成レビュー: target_ref = project id（セッションのプロジェクトと一致していること）
      if (targetRef.data !== session.project_id) {
        throw new AppError('not_found', 'レビュー対象が見つかりません')
      }
      const proposal = await fetchProposalContext(supabase, session.project_id)
      const scenes = await fetchScenes(supabase, session.project_id)
      const sceneNotes = await fetchSceneNotesByScene(supabase, session.project_id)
      // 紐づけノート経由のLLM入力肥大化ガード（監査L-3。全シーン×紐づけノートで肥大化しうるためIssue #58で追加）
      const structureInputChars =
        countChars(proposal.content) +
        scenes.reduce((sum, scene) => sum + countChars(scene.content), 0) +
        Object.values(sceneNotes).reduce(
          (sum, notes) => sum + notes.reduce((s, note) => s + countChars(note.content), 0),
          0,
        )
      if (structureInputChars > CRITIQUE_MAX_CHARS) {
        throw new AppError(
          'validation',
          `構成（企画書・シーン・紐づけノート）の合計が約${structureInputChars.toLocaleString('ja-JP')}字あり、レビューの上限（${CRITIQUE_MAX_CHARS.toLocaleString('ja-JP')}字）を超えています。シーンの紐づけノートを減らしてください`,
        )
      }
      const structureTemplate = await fetchStructureTemplate(supabase, session.project_id)
      prompt = buildStructureReviewInput({ proposal, structureTemplate, scenes, sceneNotes, history })
    } else if (phase === 'scene') {
      // シーンレビュー: target_ref = scene id（RLS越し取得＋プロジェクト一致の検証）
      const scenes = await fetchScenes(supabase, session.project_id)
      const scene = scenes.find((s) => s.id === targetRef.data)
      if (!scene) throw new AppError('not_found', 'シーンが見つかりません')
      const proposal = await fetchProposalContext(supabase, session.project_id)
      const notes = await fetchNotesForScene(supabase, scene.id)
      // 紐づけノート経由のLLM入力肥大化ガード（監査L-3。Issue #58で追加）
      const sceneInputChars =
        countChars(proposal.content) +
        countChars(scene.content) +
        notes.reduce((sum, note) => sum + countChars(note.content), 0)
      if (sceneInputChars > CRITIQUE_MAX_CHARS) {
        throw new AppError(
          'validation',
          `シーンと紐づけノートの合計が約${sceneInputChars.toLocaleString('ja-JP')}字あり、レビューの上限（${CRITIQUE_MAX_CHARS.toLocaleString('ja-JP')}字）を超えています。紐づけノートを減らしてください`,
        )
      }
      const structureTemplate = await fetchStructureTemplate(supabase, session.project_id)
      prompt = buildSceneReviewInput({ proposal, structureTemplate, scene, scenes, notes, history })
    } else if (phase === 'manuscript') {
      // 講評: target_ref = project id（SPEC-dashboard-critique-settings §3.3。作品全体が対象）
      if (targetRef.data !== session.project_id) {
        throw new AppError('not_found', 'レビュー対象が見つかりません')
      }
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, repo, base_path')
        .eq('id', session.project_id)
        .maybeSingle()
      if (projectError) throw new AppError('internal', projectError.message)
      if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')
      if (!project.repo) throw new AppError('validation', 'リポジトリが設定されていません')

      const credential = await patCredentialProvider.getCredential(supabase)
      if (!credential) throw new AppError('validation', 'GitHub PATが未登録です')

      const basePath = project.base_path ?? ''
      const files = await fetchAllManuscriptContents(credential.token, project.repo, basePath)
      if (files.length === 0) {
        throw new AppError('validation', '原稿ファイル（.md / .txt）が見つかりません')
      }

      // 文字数ガード二段構え: 30万字超は実行不可、15万字超は了承済みフラグ必須
      const totalChars = files.reduce((sum, file) => sum + countChars(file.content), 0)
      if (totalChars > CRITIQUE_MAX_CHARS) {
        throw new AppError(
          'validation',
          `原稿が約${totalChars.toLocaleString('ja-JP')}字あり、講評の上限（${CRITIQUE_MAX_CHARS.toLocaleString('ja-JP')}字）を超えています。実行できません`,
        )
      }
      if (totalChars > CRITIQUE_CONFIRM_CHARS && confirmLong !== true) {
        throw new AppError(
          'validation',
          `原稿が約${totalChars.toLocaleString('ja-JP')}字あり、長編小説の上限相当（${CRITIQUE_CONFIRM_CHARS.toLocaleString('ja-JP')}字）を超えています。実行するには確認が必要です`,
        )
      }

      // 入力の出し分け＝ペルソナの参照範囲（reference_scope をコードが解釈する初のケース）
      const scope = session.personas.reference_scope as ReferenceScope
      let proposalScope: CritiqueProposalScope = 'none'
      let proposal: ProposalContext | null = null
      if (scope === 'all') {
        proposalScope = 'full'
        proposal = await fetchProposalContext(supabase, session.project_id)
      } else if (scope === 'manuscript_plus_target') {
        proposalScope = 'target_only'
        proposal = await fetchProposalContext(supabase, session.project_id)
        // なりきり先がないと意味を成さないためフェイルクローズ（SPEC §3.3）
        if (!proposal.genre || !proposal.targetAudience) {
          throw new AppError(
            'validation',
            '企画書のジャンル・ターゲット層が未設定のため、この講評を実行できません。企画書タブで設定してください',
          )
        }
      }

      // 見出しはツリー表示と同じ相対パスにする
      const prefixLength = basePath === '' ? 0 : basePath.replace(/\/$/, '').length + 1
      prompt = buildManuscriptCritiqueInput({
        files: files.map((f) => ({ path: f.path.slice(prefixLength), content: f.content })),
        proposalScope,
        proposal,
      })
    } else {
      throw new AppError('validation', 'このレビュー種別には未対応です')
    }

    const { model, provider, modelId } = await resolveModel(
      supabase,
      session.personas.ai_capability as AiCapability,
    )

    // 講評は読み切り型: 1実行1セッションで、成功時 completed / 失敗・中断時 failed に確定する
    const finalizeCritique = async (status: 'completed' | 'failed') => {
      if (phase !== 'manuscript') return
      const { error: statusError } = await supabase
        .from('review_sessions')
        .update({ status })
        .eq('id', session.id)
      if (statusError) console.error('講評セッションの確定に失敗:', statusError.message)
    }

    const result = streamText({
      model,
      system: buildReviewSystemPrompt({
        personaDescription: session.personas.description,
        promptTemplate: session.review_profiles.prompt_template,
      }),
      prompt,
      // stop によるクライアント切断で生成そのものを中断する（Issue #98。中断時は onAbort へ）
      abortSignal: req.signal,
      // 生成完了時にフィードバックを保存する
      onFinish: async ({ text, usage }) => {
        // 使用量記録（Issue #45）。text が空でもトークンは消費されている
        await recordAiUsage(supabase, {
          feature: 'review',
          provider,
          modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })
        if (!text) {
          await finalizeCritique('failed')
          return
        }
        try {
          const { error: insertError } = await supabase.from('review_feedbacks').insert({
            review_session_id: session.id,
            // キャラクターレビュー・講評は合否を持たないため判定なし（null）
            content: text,
            verdict: VERDICT_PHASES.includes(phase) ? parseVerdict(text) : null,
          })
          if (insertError) {
            console.error('フィードバックの保存に失敗:', insertError.message)
            await finalizeCritique('failed')
            return
          }
          await finalizeCritique('completed')
          // 初回レビュー実行で draft → in_review（企画書レビューのみ。SPEC-proposal-review §3.2）
          if (proposalIdForStatus) {
            const { error: statusError } = await supabase
              .from('proposals')
              .update({ status: 'in_review' })
              .eq('id', proposalIdForStatus)
            if (statusError) console.error('企画書ステータスの更新に失敗:', statusError.message)
          }
        } catch (error) {
          // 保存の失敗でストリーム自体は壊さない（クライアントは一覧の取り直しで気づける）
          console.error('フィードバックの保存に失敗:', error)
          await finalizeCritique('failed')
        }
      },
      // 中断時は onFinish が呼ばれない＝フィードバックは保存されず、次回レビューの履歴にも入らない。
      // SDK が中断時の usage を提供しないため使用量記録も残せない（割り切り。レート制限が下限ガード）
      onAbort: async () => {
        await finalizeCritique('failed')
      },
      onError: async ({ error }) => {
        console.error('レビュー生成でエラー:', error)
        // 講評セッションを running のまま残さない（読み切り型）
        await finalizeCritique('failed')
      },
    })

    return result.toTextStreamResponse()
  } catch (error) {
    return errorResponse(error)
  }
}
