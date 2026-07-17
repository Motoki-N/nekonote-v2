// 標準同梱ペルソナ・レビュープロファイルの固定UUID。
// supabase/migrations のシードと対応させる:
//   - conversational 2人: 20260713000001_chat_and_conversational_personas.sql
//   - reviewer 4人＋プロファイル5種: 20260713000002_review_gate_and_reviewer_personas.sql
//   - 講評プロファイル2種: 20260714000001_manuscript_critique_profiles.sql
//   - 売り込み分析への改名＋あらすじ・キャッチコピー2種: 20260717000001_bookseller_marketing_and_copy_profiles.sql

export const ASSISTANT_PERSONA_ID = 'e5a1c0de-0001-4000-8000-000000000001'
export const CAFE_MASTER_PERSONA_ID = 'e5a1c0de-0002-4000-8000-000000000002'

export const EDITOR_PERSONA_ID = 'e5a1c0de-0003-4000-8000-000000000003'
export const PROOFREADER_PERSONA_ID = 'e5a1c0de-0004-4000-8000-000000000004'
export const READER_PERSONA_ID = 'e5a1c0de-0005-4000-8000-000000000005'
export const BOOKSELLER_PERSONA_ID = 'e5a1c0de-0006-4000-8000-000000000006'

export const PROPOSAL_REVIEW_PROFILE_ID = 'e5a1c0de-1001-4000-8000-000000001001'
export const CHARACTER_REVIEW_PROFILE_ID = 'e5a1c0de-1002-4000-8000-000000001002'
export const STRUCTURE_REVIEW_PROFILE_ID = 'e5a1c0de-1003-4000-8000-000000001003'
export const SCENE_REVIEW_PROFILE_ID = 'e5a1c0de-1004-4000-8000-000000001004'
export const PROOFREADING_PROFILE_ID = 'e5a1c0de-1005-4000-8000-000000001005'

export const READER_CRITIQUE_PROFILE_ID = 'e5a1c0de-1006-4000-8000-000000001006'
export const MARKETING_ANALYSIS_PROFILE_ID = 'e5a1c0de-1007-4000-8000-000000001007'
export const SYNOPSIS_PROFILE_ID = 'e5a1c0de-1008-4000-8000-000000001008'
export const CATCHCOPY_PROFILE_ID = 'e5a1c0de-1009-4000-8000-000000001009'
