'use server'

import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { patCredentialProvider } from '@/lib/git/credentials'
import { createFileContent, getFileContent, putFileContent } from '@/lib/git/github'
import { countChars, fetchAllManuscriptContents } from '@/lib/manuscript-content'
import { resolveProfileForPhase, resolveReviewerPersona } from '@/lib/review-validation'
import type { ReferenceScope } from '@/lib/schemas/enums'
import { manuscriptFilePathSchema } from '@/lib/schemas/manuscript'
import { createClient } from '@/lib/supabase/server'

// 講評（作品全体への読み切り型レビュー。SPEC-dashboard-critique-settings §3.3）。
// review_sessions / review_feedbacks に保存する（新テーブルなし）。target_ref = プロジェクトid

const uuidSchema = z.uuid()

type Supabase = Awaited<ReturnType<typeof createClient>>

export type CritiqueProfileOption = {
  id: string
  name: string
  defaultPersonaId: string | null
}

export type CritiquePersonaOption = {
  id: string
  name: string
  /** 読者系（manuscript_plus_target）のジャンル・ターゲット層ガードの判定に使う */
  referenceScope: ReferenceScope
}

export type CritiqueRecord = {
  sessionId: string
  createdAt: string
  profileName: string
  personaName: string | null
  content: string
}

export type CritiqueBootstrap = {
  profiles: CritiqueProfileOption[]
  personas: CritiquePersonaOption[]
  critiques: CritiqueRecord[]
  /** 原稿全体の概算文字数（15万字確認の事前提示用）。取得失敗は null（最終防衛はサーバー側ガード） */
  totalChars: number | null
  /** 読者系講評の実行可否ガード（企画書のジャンル・ターゲット層が設定済みか） */
  genreSet: boolean
  targetAudienceSet: boolean
}

/** 過去の講評一覧（completed のみ・新しい順）。構成レビュー（同じ target_ref）は phase で除外する */
async function fetchCritiques(supabase: Supabase, projectId: string): Promise<CritiqueRecord[]> {
  const { data, error } = await supabase
    .from('review_sessions')
    .select(
      'id, created_at, review_profiles!inner (name, target_phase), personas (name), review_feedbacks (content)',
    )
    .eq('project_id', projectId)
    .eq('target_ref', projectId)
    .eq('status', 'completed')
    .eq('review_profiles.target_phase', 'manuscript')
    .order('created_at', { ascending: false })
  if (error) throw new AppError('internal', error.message)
  return (data ?? []).flatMap((session) => {
    const content = session.review_feedbacks[0]?.content
    if (!content) return []
    return [
      {
        sessionId: session.id,
        createdAt: session.created_at,
        profileName: session.review_profiles.name,
        personaName: session.personas?.name ?? null,
        content,
      },
    ]
  })
}

/** 講評パネル初期表示用の一括読み取り */
export async function getCritiqueBootstrap(
  projectId: string,
): Promise<ActionResult<CritiqueBootstrap>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認を兼ねる
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, repo, base_path')
      .eq('id', pid)
      .maybeSingle()
    if (projectError) throw new AppError('internal', projectError.message)
    if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')

    const [proposalResult, profilesResult, personasResult, critiques] = await Promise.all([
      supabase.from('proposals').select('genre, target_audience').eq('project_id', pid).maybeSingle(),
      supabase
        .from('review_profiles')
        .select('id, name, default_persona_id')
        .eq('target_phase', 'manuscript')
        .order('is_default', { ascending: false })
        .order('created_at'),
      supabase
        .from('personas')
        .select('id, name, reference_scope')
        .eq('persona_type', 'reviewer')
        .order('is_default', { ascending: false })
        .order('created_at'),
      fetchCritiques(supabase, pid),
    ])
    if (proposalResult.error) throw new AppError('internal', proposalResult.error.message)
    if (profilesResult.error) throw new AppError('internal', profilesResult.error.message)
    if (personasResult.error) throw new AppError('internal', personasResult.error.message)

    // 概算文字数（15万字確認の事前提示用）。補助情報なので失敗しても講評パネル自体は開ける
    let totalChars: number | null = null
    if (project.repo) {
      try {
        const credential = await patCredentialProvider.getCredential(supabase)
        if (credential) {
          const files = await fetchAllManuscriptContents(
            credential.token,
            project.repo,
            project.base_path ?? '',
          )
          totalChars = files.reduce((sum, file) => sum + countChars(file.content), 0)
        }
      } catch (error) {
        console.error('原稿文字数の集計に失敗:', error)
      }
    }

    return {
      ok: true,
      data: {
        profiles: (profilesResult.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          defaultPersonaId: p.default_persona_id,
        })),
        personas: (personasResult.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          referenceScope: p.reference_scope as ReferenceScope,
        })),
        critiques,
        totalChars,
        genreSet: Boolean(proposalResult.data?.genre),
        targetAudienceSet: Boolean(proposalResult.data?.target_audience),
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 講評セッションを新規作成する（読み切り型=1実行1セッション。get-or-create しない）。
 * profileId / personaId はクライアント指定値なのでサーバー側で再検証する
 */
export async function createCritiqueSession(
  projectId: string,
  profileId: string,
  personaId?: string,
): Promise<ActionResult<{ sessionId: string }>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const profId = uuidSchema.parse(profileId)
    const requestedPersonaId = personaId === undefined ? undefined : uuidSchema.parse(personaId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認を兼ねる
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', pid)
      .maybeSingle()
    if (projectError) throw new AppError('internal', projectError.message)
    if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')

    const profile = await resolveProfileForPhase(supabase, profId, 'manuscript')
    const effectivePersonaId = requestedPersonaId ?? profile.defaultPersonaId
    if (!effectivePersonaId) throw new AppError('validation', '担当ペルソナを選択してください')
    const persona = await resolveReviewerPersona(supabase, effectivePersonaId)

    const { data: created, error: insertError } = await supabase
      .from('review_sessions')
      .insert({
        project_id: pid,
        review_profile_id: profile.id,
        persona_id: persona.id,
        target_ref: pid,
        status: 'running',
      })
      .select('id')
      .single()
    if (insertError || !created) {
      throw new AppError('internal', insertError?.message ?? '講評セッションの作成に失敗しました')
    }

    return { ok: true, data: { sessionId: created.id } }
  } catch (error) {
    return toActionError(error)
  }
}

/** 講評書き戻し先の固定ファイル名（SPEC-vertical-editor-phase4 §3.3。entry には載せない＝本文・PDFに出ない） */
const REVIEW_NOTES_FILE = 'manuscripts/00-review-notes.md'

/** レビューメモファイルの新規作成時ヘッダ */
const REVIEW_NOTES_HEADER = `# レビューメモ（ネコノテAI）

このファイルは講評の書き戻し先です。book.config.js の entry に載せない限り、本・PDFには含まれません。
`

/** HTMLコメントを壊す \`--\` を全角へ無害化する（講評本文は複数行のまま保持する） */
function sanitizeForComment(text: string): string {
  return text.replaceAll('--', '−−')
}

/**
 * 講評の全文を専用メモファイルへ `<!-- -->` コメントとして追記＝コミットする
 * （SPEC-vertical-editor-phase4 §3.3。追記型・恒久的な重複記録は持たない）
 */
export async function writeBackCritique(
  sessionId: string,
): Promise<ActionResult<{ commitSha: string; filePath: string }>> {
  try {
    const sid = uuidSchema.parse(sessionId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認を兼ねる。projects を結合してリポジトリ情報も一括で得る
    const { data: session, error: sessionError } = await supabase
      .from('review_sessions')
      .select(
        'id, created_at, project_id, target_ref, status, review_profiles!inner (name, target_phase), personas (name), review_feedbacks (content), projects!inner (id, repo, base_path)',
      )
      .eq('id', sid)
      .maybeSingle()
    if (sessionError) throw new AppError('internal', sessionError.message)
    if (!session) throw new AppError('not_found', '講評が見つかりません')
    // 講評セッション（target_ref = プロジェクトid・原稿フェーズ・完了済み）であることを検証する
    if (
      session.target_ref !== session.project_id ||
      session.review_profiles.target_phase !== 'manuscript' ||
      session.status !== 'completed'
    ) {
      throw new AppError('validation', '書き戻せるのは完了済みの講評だけです')
    }
    const content = session.review_feedbacks[0]?.content
    if (!content) throw new AppError('not_found', '講評の本文が見つかりません')
    if (!session.projects.repo) throw new AppError('validation', 'リポジトリが設定されていません')

    const credential = await patCredentialProvider.getCredential(supabase)
    if (!credential) {
      throw new AppError('validation', 'GitHub PATが未登録です。設定から登録してください')
    }

    const basePath = session.projects.base_path ?? ''
    const prefix = basePath === '' ? '' : `${basePath.replace(/\/$/, '')}/`
    // DB由来の base_path を含むため書き込み先パスも再検証する（多層防御。SPEC-phase4 §5）
    const filePath = manuscriptFilePathSchema.parse(`${prefix}${REVIEW_NOTES_FILE}`)

    // 追記ブロック（日付は講評実行日・JST）
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(
      new Date(session.created_at),
    )
    const persona = session.personas?.name ? `（${session.personas.name}）` : ''
    const heading = sanitizeForComment(`[ネコノテ講評 ${date} ${session.review_profiles.name}${persona}]`)
    const block = `<!-- ${heading}\n${sanitizeForComment(content)}\n-->\n`

    // 既存ファイルは末尾に追記、無ければヘッダつきで新規作成（blob SHA 起点の楽観ロック）
    let existing: { content: string; sha: string } | null = null
    try {
      existing = await getFileContent(credential.token, session.projects.repo, filePath)
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'not_found')) throw error
    }

    const message = '講評: レビューメモへ書き戻し（ネコノテAI）'
    const { commitSha } = existing
      ? await putFileContent(credential.token, session.projects.repo, filePath, {
          content: `${existing.content.replace(/\n*$/, '\n\n')}${block}`,
          sha: existing.sha,
          message,
        })
      : await createFileContent(credential.token, session.projects.repo, filePath, {
          content: `${REVIEW_NOTES_HEADER}\n${block}`,
          message,
        })

    return { ok: true, data: { commitSha, filePath } }
  } catch (error) {
    return toActionError(error)
  }
}

/** 過去の講評一覧の取り直し（実行完了後の更新用） */
export async function listCritiqueSessions(
  projectId: string,
): Promise<ActionResult<CritiqueRecord[]>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const supabase = await createClient()
    return { ok: true, data: await fetchCritiques(supabase, pid) }
  } catch (error) {
    return toActionError(error)
  }
}
