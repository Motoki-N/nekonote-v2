'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { DEFAULT_MODEL_MAP, PROVIDER_ENV_KEY } from '@/lib/ai/models'
import { encrypt } from '@/lib/crypto'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { patCredentialProvider } from '@/lib/git/credentials'
import { getDefaultBranch, verifyToken } from '@/lib/git/github'
import { repoSchema } from '@/lib/schemas/projects'
import { resolveReviewerPersona } from '@/lib/review-validation'
import {
  aiProviders,
  modelCapabilities,
  type AiCapability,
  type AiProvider,
  type ModelCapability,
  type PersonaType,
  type ReferenceScope,
  type TargetPhase,
  type WritingGenre,
} from '@/lib/schemas/enums'
import { personaInputSchema, reviewProfileInputSchema } from '@/lib/schemas/review'
import type { PersonaInput, ReviewProfileInput } from '@/lib/schemas/review'
import { aiModelSettingInputSchema } from '@/lib/schemas/settings'
import type { AiModelSettingInput } from '@/lib/schemas/settings'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()

type Supabase = Awaited<ReturnType<typeof createClient>>

async function requireUser(supabase: Supabase): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new AppError('unauthorized', 'ログインが必要です')
  return { id: user.id }
}

// PAT本体のゆるい形式検証（GitHubのトークン形式変更に壊されない程度。実効性の検証は疎通で行う）
const patSchema = z
  .string()
  .trim()
  .min(1, 'トークンを入力してください')
  .max(500, 'トークンが長すぎます')
  .regex(/^\S+$/, 'トークンに空白は含められません')

export type GithubConnection = {
  connected: boolean
  username: string | null
}

/** GitHub連携の接続状態（登録済みか＋表示用ユーザー名のみ。暗号文・平文は返さない） */
export async function getGithubConnection(): Promise<ActionResult<GithubConnection>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('user_settings')
      .select('github_pat_ciphertext, github_username')
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    return {
      ok: true,
      data: {
        connected: Boolean(data?.github_pat_ciphertext),
        username: data?.github_username ?? null,
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * PATの登録・差し替え（SPEC-proofreading §3.1）。
 * 保存前に GET /user で疎通検証し、失効トークンの保存を防ぐ。保存するのは暗号文のみ
 */
export async function registerGithubPat(
  token: string,
): Promise<ActionResult<{ username: string }>> {
  try {
    const pat = patSchema.parse(token)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const { login } = await verifyToken(pat)

    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id,
      github_pat_ciphertext: encrypt(pat),
      github_username: login,
    })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true, data: { username: login } }
  } catch (error) {
    return toActionError(error)
  }
}

/** PATの削除（暗号文・ユーザー名の両方を消す） */
export async function deleteGithubPat(): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const { error } = await supabase
      .from('user_settings')
      .update({ github_pat_ciphertext: null, github_username: null })
      .eq('user_id', user.id)
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

// ========================================
// Zenn連携（SPEC-zenn-integration §3.1）
// 記事本文はDBに持たない。ここで保存するのは連携リポジトリ名（owner/repo）のみ
// ========================================

/** Zenn連携リポジトリの取得（表示用。null = 未登録） */
export async function getZennRepo(): Promise<ActionResult<{ repo: string | null }>> {
  try {
    const supabase = await createClient()
    await requireUser(supabase) // RLSに加えた明示チェック（security-reviewer L-1）
    const { data, error } = await supabase.from('user_settings').select('zenn_repo').maybeSingle()
    if (error) throw new AppError('internal', error.message)
    return { ok: true, data: { repo: data?.zenn_repo ?? null } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Zenn連携リポジトリの登録・差し替え。保存前に getDefaultBranch で疎通検証し、
 * タイポ・PATの対象リポジトリ漏れをここで弾く（SPEC-zenn-integration §3.1）
 */
export async function registerZennRepo(repo: string): Promise<ActionResult<{ repo: string }>> {
  try {
    // ZodError は toActionError で internal（固定文言）になるため、入力起因はここで validation に変換する。
    // Server Action 直呼びで非文字列も届くため、trim 前に型を弾く（security-reviewer L-2）
    const parsedResult = repoSchema.safeParse(typeof repo === 'string' ? repo.trim() : repo)
    if (!parsedResult.success) {
      throw new AppError('validation', 'リポジトリは owner/repo の形式で入力してください')
    }
    const parsed = parsedResult.data
    const supabase = await createClient()
    const user = await requireUser(supabase)

    const credential = await patCredentialProvider.getCredential(supabase)
    if (!credential) {
      throw new AppError(
        'validation',
        'GitHub PATが未登録です。先にGitHub連携でPATを登録してください',
      )
    }
    await getDefaultBranch(credential.token, parsed)

    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, zenn_repo: parsed })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true, data: { repo: parsed } }
  } catch (error) {
    return toActionError(error)
  }
}

/** Zenn連携リポジトリの削除（列を null に戻すのみ。PATには触れない） */
export async function deleteZennRepo(): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const user = await requireUser(supabase)

    const { error } = await supabase
      .from('user_settings')
      .update({ zenn_repo: null })
      .eq('user_id', user.id)
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

// ========================================
// AIモデル設定（SPEC-dashboard-critique-settings §3.4）
// capability 3行のマッピング。ユーザー行がなければ DEFAULT_MODEL_MAP を表示し、
// 「デフォルトに戻す」= 行削除。キーは有無（boolean）のみ返し、値は絶対に返さない
// ========================================

export type AiModelSettingRow = {
  capability: ModelCapability
  provider: AiProvider
  modelId: string
  /** ユーザー行あり（false = DEFAULT_MODEL_MAP 表示） */
  isCustom: boolean
  /** この能力レベルを使うペルソナ名（表示の手がかり） */
  personaNames: string[]
}

export type AiModelSettingsData = {
  rows: AiModelSettingRow[]
  /** プロバイダAPIキーの設定有無（サーバー判定。警告バッジ用） */
  keyConfigured: Record<AiProvider, boolean>
  /** 「デフォルトに戻す」後の表示用（DEFAULT_MODEL_MAP はサーバー専用モジュールのため渡す） */
  defaults: Record<ModelCapability, { provider: AiProvider; modelId: string }>
}

export async function getAiModelSettings(): Promise<ActionResult<AiModelSettingsData>> {
  try {
    const supabase = await createClient()
    const [settingsResult, personasResult] = await Promise.all([
      supabase.from('ai_model_settings').select('capability, provider, model_id'),
      supabase
        .from('personas')
        .select('name, ai_capability')
        .order('is_default', { ascending: false })
        .order('created_at'),
    ])
    if (settingsResult.error) throw new AppError('internal', settingsResult.error.message)
    if (personasResult.error) throw new AppError('internal', personasResult.error.message)

    const userRows = new Map(
      (settingsResult.data ?? []).map((row) => [row.capability as ModelCapability, row]),
    )
    const rows: AiModelSettingRow[] = modelCapabilities.map((capability) => {
      const userRow = userRows.get(capability)
      return {
        capability,
        provider: (userRow?.provider ?? DEFAULT_MODEL_MAP[capability].provider) as AiProvider,
        modelId: userRow?.model_id ?? DEFAULT_MODEL_MAP[capability].model_id,
        isCustom: Boolean(userRow),
        personaNames: (personasResult.data ?? [])
          .filter((p) => p.ai_capability === capability)
          .map((p) => p.name),
      }
    })

    const keyConfigured = Object.fromEntries(
      aiProviders.map((provider) => [provider, Boolean(process.env[PROVIDER_ENV_KEY[provider]])]),
    ) as Record<AiProvider, boolean>

    const defaults = Object.fromEntries(
      modelCapabilities.map((capability) => [
        capability,
        {
          provider: DEFAULT_MODEL_MAP[capability].provider,
          modelId: DEFAULT_MODEL_MAP[capability].model_id,
        },
      ]),
    ) as AiModelSettingsData['defaults']

    return { ok: true, data: { rows, keyConfigured, defaults } }
  } catch (error) {
    return toActionError(error)
  }
}

/** capability 行の登録・変更（user_id × capability で1行に upsert） */
export async function upsertAiModelSetting(input: AiModelSettingInput): Promise<ActionResult> {
  try {
    const parsed = aiModelSettingInputSchema.parse(input)
    const supabase = await createClient()
    const user = await requireUser(supabase)

    const { error } = await supabase
      .from('ai_model_settings')
      .upsert({ user_id: user.id, ...parsed }, { onConflict: 'user_id,capability' })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 「デフォルトに戻す」= ユーザー行の削除（DEFAULT_MODEL_MAP に戻る） */
export async function deleteAiModelSetting(capability: ModelCapability): Promise<ActionResult> {
  try {
    const parsed = z.enum(modelCapabilities).parse(capability)
    const supabase = await createClient()
    const { error } = await supabase.from('ai_model_settings').delete().eq('capability', parsed)
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

// ========================================
// ペルソナ管理（SPEC-dashboard-critique-settings §3.4）
// 標準（is_default）は読み取り専用＋「複製して編集」。RLSが標準行の書き込みを拒否する前提で、
// 影響0件時に理由（標準行 or 不存在）を出し分ける
// ========================================

export type PersonaRecord = {
  id: string
  name: string
  description: string
  ai_capability: AiCapability
  reference_scope: ReferenceScope
  persona_type: PersonaType
  is_default: boolean
  writing_genre: WritingGenre | null
}

export async function listPersonas(): Promise<ActionResult<PersonaRecord[]>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('personas')
      .select(
        'id, name, description, ai_capability, reference_scope, persona_type, is_default, writing_genre',
      )
      .order('is_default', { ascending: false })
      .order('created_at')
    if (error) throw new AppError('internal', error.message)
    return { ok: true, data: (data ?? []) as PersonaRecord[] }
  } catch (error) {
    return toActionError(error)
  }
}

export async function createPersona(input: PersonaInput): Promise<ActionResult> {
  try {
    const parsed = personaInputSchema.parse(input)
    const supabase = await createClient()
    const user = await requireUser(supabase)

    const { error } = await supabase
      .from('personas')
      .insert({ ...parsed, user_id: user.id, is_default: false })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 標準ペルソナの複製（ユーザー行としてコピーを作る） */
export async function duplicatePersona(personaId: string): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(personaId)
    const supabase = await createClient()
    const user = await requireUser(supabase)

    // RLS越しの取得（標準 or 自分の行のみ見える）
    const { data: source, error: sourceError } = await supabase
      .from('personas')
      .select('name, description, ai_capability, reference_scope, persona_type, writing_genre')
      .eq('id', pid)
      .maybeSingle()
    if (sourceError) throw new AppError('internal', sourceError.message)
    if (!source) throw new AppError('not_found', 'ペルソナが見つかりません')

    const { error } = await supabase
      .from('personas')
      .insert({ ...source, name: `${source.name}のコピー`, user_id: user.id, is_default: false })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updatePersona(personaId: string, input: PersonaInput): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(personaId)
    const parsed = personaInputSchema.parse(input)
    const supabase = await createClient()

    const { data: updated, error } = await supabase
      .from('personas')
      .update(parsed)
      .eq('id', pid)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!updated || updated.length === 0) {
      // 更新0件 = 行が存在しない（他人の行含む）か、RLSに拒否された標準行。理由を出し分ける
      const { data: existing, error: selectError } = await supabase
        .from('personas')
        .select('id')
        .eq('id', pid)
        .maybeSingle()
      if (selectError) throw new AppError('internal', selectError.message)
      if (!existing) throw new AppError('not_found', 'ペルソナが見つかりません')
      throw new AppError('validation', '標準ペルソナは編集できません。複製してから編集してください')
    }

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 物理削除。レビュー履歴は persona_id が null になって残る（on delete set null） */
export async function deletePersona(personaId: string): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(personaId)
    const supabase = await createClient()

    const { data: deleted, error } = await supabase
      .from('personas')
      .delete()
      .eq('id', pid)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!deleted || deleted.length === 0) {
      const { data: existing, error: selectError } = await supabase
        .from('personas')
        .select('id')
        .eq('id', pid)
        .maybeSingle()
      if (selectError) throw new AppError('internal', selectError.message)
      if (!existing) throw new AppError('not_found', 'ペルソナが見つかりません')
      throw new AppError('validation', '標準ペルソナは削除できません')
    }

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

// ========================================
// レビュープロファイル管理（SPEC-dashboard-critique-settings §3.4）
// ========================================

export type ReviewProfileRecord = {
  id: string
  name: string
  target_phase: TargetPhase
  prompt_template: string
  default_persona_id: string | null
  is_default: boolean
  writing_genre: WritingGenre | null
}

export async function listReviewProfiles(): Promise<ActionResult<ReviewProfileRecord[]>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('review_profiles')
      .select('id, name, target_phase, prompt_template, default_persona_id, is_default, writing_genre')
      .order('is_default', { ascending: false })
      .order('created_at')
    if (error) throw new AppError('internal', error.message)
    return { ok: true, data: (data ?? []) as ReviewProfileRecord[] }
  } catch (error) {
    return toActionError(error)
  }
}

/** default_persona_id の再検証（reviewer 型かつ標準or自分の行のみ許可） */
async function validateDefaultPersona(
  supabase: Supabase,
  defaultPersonaId: string | null | undefined,
): Promise<void> {
  if (defaultPersonaId == null) return
  await resolveReviewerPersona(supabase, uuidSchema.parse(defaultPersonaId))
}

export async function createReviewProfile(input: ReviewProfileInput): Promise<ActionResult> {
  try {
    const parsed = reviewProfileInputSchema.parse(input)
    const supabase = await createClient()
    const user = await requireUser(supabase)
    await validateDefaultPersona(supabase, parsed.default_persona_id)

    const { error } = await supabase
      .from('review_profiles')
      .insert({ ...parsed, user_id: user.id, is_default: false })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 標準プロファイルの複製（ユーザー行としてコピーを作る） */
export async function duplicateReviewProfile(profileId: string): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(profileId)
    const supabase = await createClient()
    const user = await requireUser(supabase)

    const { data: source, error: sourceError } = await supabase
      .from('review_profiles')
      .select('name, target_phase, prompt_template, default_persona_id, writing_genre')
      .eq('id', pid)
      .maybeSingle()
    if (sourceError) throw new AppError('internal', sourceError.message)
    if (!source) throw new AppError('not_found', 'レビュープロファイルが見つかりません')

    const { error } = await supabase
      .from('review_profiles')
      .insert({ ...source, name: `${source.name}のコピー`, user_id: user.id, is_default: false })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateReviewProfile(
  profileId: string,
  input: ReviewProfileInput,
): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(profileId)
    const parsed = reviewProfileInputSchema.parse(input)
    const supabase = await createClient()
    await validateDefaultPersona(supabase, parsed.default_persona_id)

    const { data: updated, error } = await supabase
      .from('review_profiles')
      .update(parsed)
      .eq('id', pid)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!updated || updated.length === 0) {
      const { data: existing, error: selectError } = await supabase
        .from('review_profiles')
        .select('id')
        .eq('id', pid)
        .maybeSingle()
      if (selectError) throw new AppError('internal', selectError.message)
      if (!existing) throw new AppError('not_found', 'レビュープロファイルが見つかりません')
      throw new AppError(
        'validation',
        '標準プロファイルは編集できません。複製してから編集してください',
      )
    }

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 物理削除。レビュー履歴は review_profile_id が null になって残る（on delete set null） */
export async function deleteReviewProfile(profileId: string): Promise<ActionResult> {
  try {
    const pid = uuidSchema.parse(profileId)
    const supabase = await createClient()

    const { data: deleted, error } = await supabase
      .from('review_profiles')
      .delete()
      .eq('id', pid)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!deleted || deleted.length === 0) {
      const { data: existing, error: selectError } = await supabase
        .from('review_profiles')
        .select('id')
        .eq('id', pid)
        .maybeSingle()
      if (selectError) throw new AppError('internal', selectError.message)
      if (!existing) throw new AppError('not_found', 'レビュープロファイルが見つかりません')
      throw new AppError('validation', '標準プロファイルは削除できません')
    }

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

export type AiUsageSummaryRow = {
  feature: string
  provider: string
  modelId: string
  callCount: number
  inputTokens: number
  outputTokens: number
}

/** 直近30日のAI使用量サマリー（Issue #45。トークン数のみ・金額換算はしない）。集計はDB側（RLSで本人分のみ） */
export async function getAiUsageSummary(): Promise<ActionResult<AiUsageSummaryRow[]>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('ai_usage_summary', { days: 30 })
    if (error) throw new AppError('internal', error.message)
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        feature: row.feature,
        provider: row.provider,
        modelId: row.model_id,
        callCount: row.call_count,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
      })),
    }
  } catch (error) {
    return toActionError(error)
  }
}
