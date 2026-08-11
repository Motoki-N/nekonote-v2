// 列挙値の一元定義。
// supabase/migrations/20260712000002_core_schema.sql の CHECK 制約と対応させる。
// DBの列挙値を変更するときは、マイグレーションと本ファイルを同時に更新すること。

export const tagKinds = ["category", "working_title"] as const;
export type TagKind = (typeof tagKinds)[number];

export const projectStatuses = [
  "planning",
  "writing",
  "editing",
  "completed",
] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const proposalStatuses = ["draft", "in_review", "approved"] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];

// 執筆ジャンル（proposals.writing_genre。20260725000002 の CHECK 制約と対応。SPEC-genre）
export const writingGenres = ["novel", "tech_book", "other"] as const;
export type WritingGenre = (typeof writingGenres)[number];

// 構成・シーンレビューのゲート状態（scenes.status / projects.structure_status。
// 20260721000001 の CHECK 制約と対応。企画書と違い in_review は持たない2状態）
export const approvalStatuses = ["draft", "approved"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

// 構成テンプレート（projects.structure_template。20260731000001 の CHECK 制約と対応。
// SPEC-structure-templates。レーン・転換点の構成は lib/board-templates.ts が正）
export const structureTemplates = [
  "four_part",
  "three_act",
  "structure",
  "save_the_cat",
  "heros_journey",
  "story_anatomy",
] as const;
export type StructureTemplate = (typeof structureTemplates)[number];

// 小説レーン（全テンプレートの和集合。どのレーンがどのテンプレートに属するかは
// lib/board-templates.ts が正。値を変更するときは同ファイルと 20260731000001 も同時に更新すること）
export const sceneParts = [
  // 4部構成
  "setup",
  "response",
  "attack",
  "resolution",
  // 三幕構成
  "act1",
  "act2_first",
  "act2_second",
  "act3",
  // ストラクチャー式
  "reaction1",
  "reaction2",
  "action1",
  "action2",
  // Save The Cat式
  "stc_part1",
  "stc_part2",
  "stc_part3",
  "stc_part4",
  // ヒーローズジャーニー式
  "hj_separation",
  "hj_descent",
  "hj_initiation",
  "hj_return",
  // ストーリー解剖学式
  "sa_part1",
  "sa_part2",
  "sa_part3",
  "sa_part4",
] as const;
export type ScenePart = (typeof sceneParts)[number];

// 目次ボードの章カード（Issue #96・SPEC-outline-board。小説レーンには描画しない）
export const CHAPTER_PART = "chapter" as const;
// DBのCHECK制約（20260731000001）・zod検証・正準順序（toCanonicalOrder）用の全語彙
export const scenePartsAll = [...sceneParts, CHAPTER_PART] as const;
export type ScenePartAll = (typeof scenePartsAll)[number];

// 転換点アンカー（全テンプレートの和集合。テンプレ内の定義順に並べる=編集ダイアログ等の表示順）
export const sceneAnchors = [
  // 4部構成
  "pp1",
  "pinch1",
  "midpoint",
  "pinch2",
  "pp2",
  // 三幕構成
  "ta_pp1",
  "ta_midpoint",
  "ta_pp2",
  // ストラクチャー式
  "st_hook",
  "st_inciting",
  "st_key_event",
  "st_pp1",
  "st_pinch1",
  "st_midpoint",
  "st_pinch2",
  "st_pp2",
  "st_climax",
  "st_resolution",
  // Save The Cat式
  "stc_opening_image",
  "stc_theme",
  "stc_setup",
  "stc_catalyst",
  "stc_debate",
  "stc_tp1",
  "stc_b_story",
  "stc_fun",
  "stc_midpoint",
  "stc_bad_guys",
  "stc_all_is_lost",
  "stc_dark_night",
  "stc_tp2",
  "stc_finale",
  "stc_final_image",
  // ヒーローズジャーニー式
  "hj_ordinary",
  "hj_call",
  "hj_refusal",
  "hj_mentor",
  "hj_threshold",
  "hj_tests",
  "hj_ordeal",
  "hj_reward",
  "hj_road_back",
  "hj_resurrection",
  "hj_elixir",
  // ストーリー解剖学式
  "sa_self_discovery",
  "sa_ghost",
  "sa_weakness",
  "sa_inciting",
  "sa_desire",
  "sa_ally",
  "sa_opponent",
  "sa_fake_ally",
  "sa_revelation1",
  "sa_plan",
  "sa_opponent_plan",
  "sa_drive",
  "sa_ally_attack",
  "sa_apparent_defeat",
  "sa_revelation2",
  "sa_audience_revelation",
  "sa_revelation3",
  "sa_gauntlet",
  "sa_battle",
  "sa_self_revelation",
  "sa_moral_decision",
  "sa_new_equilibrium",
] as const;
export type SceneAnchor = (typeof sceneAnchors)[number];

// 感情の強度: -5〜+5の11段階整数（0=中立)。null=未設定（emotion_start/emotion_end列）。
// 20260723000002 の CHECK 制約（between -5 and 5）と対応
export const EMOTION_MIN = -5;
export const EMOTION_MAX = 5;
export type Emotion = number;

export const aiCapabilities = ["high", "medium", "low"] as const;
export type AiCapability = (typeof aiCapabilities)[number];

// ai_model_settings 専用の能力枠（ペルソナには 'image' を割り当てない。SPEC-illustrator §5.1）
export const modelCapabilities = [...aiCapabilities, "image"] as const;
export type ModelCapability = (typeof modelCapabilities)[number];

export const illustrationKinds = [
  "cover",
  "insert",
  "character",
  "concept",
] as const;
export type IllustrationKind = (typeof illustrationKinds)[number];

// DBに保存されうる種別の全体。'reference' はアップロードされた参照用画像で、
// 生成の依頼種別ではない（illustrationKinds には含めず、propose/generate の入力から遮断する）
export const storedIllustrationKinds = [
  ...illustrationKinds,
  "reference",
] as const;
export type StoredIllustrationKind = (typeof storedIllustrationKinds)[number];

export const referenceScopes = [
  "all",
  "manuscript_only",
  "chat_only",
  "manuscript_plus_target",
] as const;
export type ReferenceScope = (typeof referenceScopes)[number];

export const personaTypes = [
  "reviewer",
  "conversational",
  "illustrator",
] as const;
export type PersonaType = (typeof personaTypes)[number];

export const targetPhases = [
  "proposal",
  "character",
  "structure",
  "scene",
  "proofreading",
  "manuscript", // 作品全体への講評（20260714000001 で追加）
] as const;
export type TargetPhase = (typeof targetPhases)[number];

export const reviewSessionStatuses = [
  "running",
  "completed",
  "failed",
] as const;
export type ReviewSessionStatus = (typeof reviewSessionStatuses)[number];

// AIの承認判定（review_feedbacks.verdict。20260713000002 の CHECK 制約と対応）
export const reviewVerdicts = ["approved", "needs_work"] as const;
export type ReviewVerdict = (typeof reviewVerdicts)[number];

export const suggestionGranularities = ["sentence", "scene"] as const;
export type SuggestionGranularity = (typeof suggestionGranularities)[number];

export const suggestionStatuses = [
  "pending",
  "accepted",
  "rejected",
  "on_hold",
] as const;
export type SuggestionStatus = (typeof suggestionStatuses)[number];

export const aiProviders = ["anthropic", "openai", "google"] as const;
export type AiProvider = (typeof aiProviders)[number];

export const chatRoles = ["user", "assistant"] as const;
export type ChatRole = (typeof chatRoles)[number];
