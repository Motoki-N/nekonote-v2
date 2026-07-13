// 列挙値の一元定義。
// supabase/migrations/20260712000002_core_schema.sql の CHECK 制約と対応させる。
// DBの列挙値を変更するときは、マイグレーションと本ファイルを同時に更新すること。

export const tagKinds = ['category', 'working_title'] as const
export type TagKind = (typeof tagKinds)[number]

export const projectStatuses = ['planning', 'writing', 'editing', 'completed'] as const
export type ProjectStatus = (typeof projectStatuses)[number]

export const proposalStatuses = ['draft', 'in_review', 'approved'] as const
export type ProposalStatus = (typeof proposalStatuses)[number]

// 4部構成のレーン（設定・反応・攻撃・解決）
export const sceneParts = ['setup', 'response', 'attack', 'resolution'] as const
export type ScenePart = (typeof sceneParts)[number]

// 5転換点アンカー
export const sceneAnchors = ['pp1', 'pinch1', 'midpoint', 'pinch2', 'pp2'] as const
export type SceneAnchor = (typeof sceneAnchors)[number]

export const emotions = ['plus', 'minus'] as const
export type Emotion = (typeof emotions)[number]

export const aiCapabilities = ['high', 'medium', 'low'] as const
export type AiCapability = (typeof aiCapabilities)[number]

export const referenceScopes = [
  'all',
  'manuscript_only',
  'chat_only',
  'manuscript_plus_target',
] as const
export type ReferenceScope = (typeof referenceScopes)[number]

export const personaTypes = ['reviewer', 'conversational'] as const
export type PersonaType = (typeof personaTypes)[number]

export const targetPhases = [
  'proposal',
  'character',
  'structure',
  'scene',
  'proofreading',
] as const
export type TargetPhase = (typeof targetPhases)[number]

export const reviewSessionStatuses = ['running', 'completed', 'failed'] as const
export type ReviewSessionStatus = (typeof reviewSessionStatuses)[number]

export const suggestionGranularities = ['sentence', 'scene'] as const
export type SuggestionGranularity = (typeof suggestionGranularities)[number]

export const suggestionStatuses = ['pending', 'accepted', 'rejected', 'on_hold'] as const
export type SuggestionStatus = (typeof suggestionStatuses)[number]

export const aiProviders = ['anthropic', 'openai', 'google'] as const
export type AiProvider = (typeof aiProviders)[number]

export const chatRoles = ['user', 'assistant'] as const
export type ChatRole = (typeof chatRoles)[number]
