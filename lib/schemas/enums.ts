// 列挙値の一元定義。
// supabase/migrations/20260712000002_core_schema.sql の CHECK 制約と対応させる。
// DBの列挙値を変更するときは、マイグレーションと本ファイルを同時に更新すること。

export const tagKinds = ['category', 'working_title'] as const
export type TagKind = (typeof tagKinds)[number]

export const projectStatuses = ['planning', 'writing', 'editing', 'completed'] as const
export type ProjectStatus = (typeof projectStatuses)[number]

export const proposalStatuses = ['draft', 'in_review', 'approved'] as const
export type ProposalStatus = (typeof proposalStatuses)[number]

// 構成・シーンレビューのゲート状態（scenes.status / projects.structure_status。
// 20260721000001 の CHECK 制約と対応。企画書と違い in_review は持たない2状態）
export const approvalStatuses = ['draft', 'approved'] as const
export type ApprovalStatus = (typeof approvalStatuses)[number]

// 4部構成のレーン（設定・反応・攻撃・解決）
export const sceneParts = ['setup', 'response', 'attack', 'resolution'] as const
export type ScenePart = (typeof sceneParts)[number]

// 5転換点アンカー
export const sceneAnchors = ['pp1', 'pinch1', 'midpoint', 'pinch2', 'pp2'] as const
export type SceneAnchor = (typeof sceneAnchors)[number]

// 感情の強度: -5〜+5の11段階整数（0=中立)。null=未設定（emotion_start/emotion_end列）。
// 20260723000002 の CHECK 制約（between -5 and 5）と対応
export const EMOTION_MIN = -5
export const EMOTION_MAX = 5
export type Emotion = number

export const aiCapabilities = ['high', 'medium', 'low'] as const
export type AiCapability = (typeof aiCapabilities)[number]

// ai_model_settings 専用の能力枠（ペルソナには 'image' を割り当てない。SPEC-illustrator §5.1）
export const modelCapabilities = [...aiCapabilities, 'image'] as const
export type ModelCapability = (typeof modelCapabilities)[number]

export const illustrationKinds = ['cover', 'insert', 'character', 'concept'] as const
export type IllustrationKind = (typeof illustrationKinds)[number]

// DBに保存されうる種別の全体。'reference' はアップロードされた参照用画像で、
// 生成の依頼種別ではない（illustrationKinds には含めず、propose/generate の入力から遮断する）
export const storedIllustrationKinds = [...illustrationKinds, 'reference'] as const
export type StoredIllustrationKind = (typeof storedIllustrationKinds)[number]

export const referenceScopes = [
  'all',
  'manuscript_only',
  'chat_only',
  'manuscript_plus_target',
] as const
export type ReferenceScope = (typeof referenceScopes)[number]

export const personaTypes = ['reviewer', 'conversational', 'illustrator'] as const
export type PersonaType = (typeof personaTypes)[number]

export const targetPhases = [
  'proposal',
  'character',
  'structure',
  'scene',
  'proofreading',
  'manuscript', // 作品全体への講評（20260714000001 で追加）
] as const
export type TargetPhase = (typeof targetPhases)[number]

export const reviewSessionStatuses = ['running', 'completed', 'failed'] as const
export type ReviewSessionStatus = (typeof reviewSessionStatuses)[number]

// AIの承認判定（review_feedbacks.verdict。20260713000002 の CHECK 制約と対応）
export const reviewVerdicts = ['approved', 'needs_work'] as const
export type ReviewVerdict = (typeof reviewVerdicts)[number]

export const suggestionGranularities = ['sentence', 'scene'] as const
export type SuggestionGranularity = (typeof suggestionGranularities)[number]

export const suggestionStatuses = ['pending', 'accepted', 'rejected', 'on_hold'] as const
export type SuggestionStatus = (typeof suggestionStatuses)[number]

export const aiProviders = ['anthropic', 'openai', 'google'] as const
export type AiProvider = (typeof aiProviders)[number]

export const chatRoles = ['user', 'assistant'] as const
export type ChatRole = (typeof chatRoles)[number]
