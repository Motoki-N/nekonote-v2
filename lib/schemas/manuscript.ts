import { z } from 'zod'
import { suggestionGranularities, suggestionStatuses } from './enums'

export const manuscriptLinkInputSchema = z.object({
  project_id: z.uuid(),
  file_path: z.string().min(1, 'ファイルパスを入力してください'),
  last_reviewed_commit: z.string().nullish(),
})
export const manuscriptLinkUpdateSchema = manuscriptLinkInputSchema
  .partial()
  .omit({ project_id: true })

export type ManuscriptLinkInput = z.infer<typeof manuscriptLinkInputSchema>
export type ManuscriptLinkUpdate = z.infer<typeof manuscriptLinkUpdateSchema>

export const revisionSuggestionInputSchema = z.object({
  manuscript_link_id: z.uuid(),
  granularity: z.enum(suggestionGranularities),
  original_text: z.string().default(''),
  suggested_text: z.string().default(''),
  reason: z.string().nullish(),
  status: z.enum(suggestionStatuses).default('pending'),
  committed_sha: z.string().nullish(),
})
export const revisionSuggestionUpdateSchema = revisionSuggestionInputSchema
  .partial()
  .omit({ manuscript_link_id: true })

export type RevisionSuggestionInput = z.infer<typeof revisionSuggestionInputSchema>
export type RevisionSuggestionUpdate = z.infer<typeof revisionSuggestionUpdateSchema>

// 原稿ファイルパスの検証（トラバーサル・絶対パス・原稿以外の拡張子を拒否）。
// Server Action（openManuscriptFile）と /api/proofread のDB由来値の再検証で共用する
export const manuscriptFilePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) => !p.startsWith('/') && !p.includes('..') && /\.(md|txt)$/.test(p),
    'ファイルパスが不正です',
  )

// ブランチ名（切替用のゆるい検証。GitHub側で作られた既存ブランチ名も受け入れる。
// git の禁止文字・トラバーサル的な形だけを拒否する。SPEC-vertical-editor-phase5 §4。
// エディタの Server Actions と /api/editor/asset の `?branch=` で共用する
export const gitBranchNameSchema = z
  .string()
  .min(1, 'ブランチ名を入力してください')
  .max(200, 'ブランチ名が長すぎます')
  .refine(
    (name) =>
      !/[\s~^:?*[\]\\]/.test(name) &&
      !name.includes('..') &&
      !name.includes('@{') &&
      !name.includes('//') &&
      !name.startsWith('/') &&
      !name.endsWith('/') &&
      !name.startsWith('-') &&
      !name.endsWith('.') &&
      !name.endsWith('.lock'),
    'ブランチ名が不正です',
  )

// AI校正の構造化提案（SPEC-proofreading §3.5。streamObject の要素スキーマ＝クライアントと共用）
export const proofreadSuggestionSchema = z.object({
  original_text: z
    .string()
    .describe('修正対象の箇所。原稿から一字一句そのまま引用する（原稿内で一意に特定できる長さで）'),
  suggested_text: z.string().describe('原文抜粋をそのまま置き換えられる修正案'),
  reason: z.string().describe('問題点の簡潔な説明（一文）'),
})
export type ProofreadSuggestion = z.infer<typeof proofreadSuggestionSchema>

// 選択範囲校正の最小長（SPEC-proofread-selection §2。UIのボタン表示とサーバー検証で共用）
export const PROOFREAD_SELECTION_MIN_CHARS = 10

export const proofreadRequestSchema = z.object({
  manuscriptLinkId: z.uuid(),
  // 選択範囲の校正（SPEC-proofread-selection §4）。省略時は従来の全文校正
  selection: z
    .string()
    .min(PROOFREAD_SELECTION_MIN_CHARS, '選択範囲が短すぎます')
    .optional(),
})

// 講評の文字数ガード（SPEC-dashboard-critique-settings §3.3。二段構え）。
// クライアントの事前確認とサーバーの最終防衛で共用する
export const CRITIQUE_CONFIRM_CHARS = 150_000 // 超えたら実行前に確認
export const CRITIQUE_MAX_CHARS = 300_000 // 超えたら実行不可

export const writingProgressInputSchema = z.object({
  project_id: z.uuid(),
  date: z.iso.date(),
  total_chars: z.number().int().min(0).default(0),
})
export const writingProgressUpdateSchema = writingProgressInputSchema
  .partial()
  .omit({ project_id: true })

export type WritingProgressInput = z.infer<typeof writingProgressInputSchema>
export type WritingProgressUpdate = z.infer<typeof writingProgressUpdateSchema>
