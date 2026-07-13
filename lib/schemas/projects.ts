import { z } from 'zod'
import {
  emotions,
  projectStatuses,
  proposalStatuses,
  sceneAnchors,
  sceneParts,
} from './enums'

export const projectInputSchema = z.object({
  title: z.string().min(1, 'タイトルを入力してください'),
  status: z.enum(projectStatuses).default('planning'),
  target_pages: z.number().int().positive().nullish(),
  deadline: z.iso.date().nullish(),
  event_name: z.string().nullish(),
  repo: z.string().nullish(),
  base_path: z.string().nullish(),
})
export const projectUpdateSchema = projectInputSchema.partial()

export type ProjectInput = z.infer<typeof projectInputSchema>
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>

export const proposalInputSchema = z.object({
  project_id: z.uuid(),
  genre: z.string().nullish(),
  target_audience: z.string().nullish(),
  content: z.string().default(''), // Markdown（コンセプト/キャラ/テーマ）
  status: z.enum(proposalStatuses).default('draft'),
})
// status は承認ゲートの検証を通る経路（/api/review の onFinish・approveProposal）でのみ遷移させる
export const proposalUpdateSchema = proposalInputSchema
  .partial()
  .omit({ project_id: true, status: true })

export type ProposalInput = z.infer<typeof proposalInputSchema>
export type ProposalUpdate = z.infer<typeof proposalUpdateSchema>

export const proposalNoteInputSchema = z.object({
  proposal_id: z.uuid(),
  note_id: z.uuid(),
})

export type ProposalNoteInput = z.infer<typeof proposalNoteInputSchema>

export const sceneInputSchema = z.object({
  project_id: z.uuid(),
  part: z.enum(sceneParts),
  anchor: z.enum(sceneAnchors).nullish(),
  order_index: z.number().int().min(0).default(0),
  title: z.string().default(''),
  content: z.string().default(''),
  emotion_start: z.enum(emotions).nullish(),
  emotion_end: z.enum(emotions).nullish(),
})
export const sceneUpdateSchema = sceneInputSchema.partial().omit({ project_id: true })

export type SceneInput = z.infer<typeof sceneInputSchema>
export type SceneUpdate = z.infer<typeof sceneUpdateSchema>

// シーン編集ダイアログの保存ペイロード（並び順はD&D＝reorderScenes の領分）
export const sceneEditSchema = z.object({
  title: z.string().max(200),
  content: z.string().max(20000),
  part: z.enum(sceneParts),
  anchor: z.enum(sceneAnchors).nullable(),
  emotion_start: z.enum(emotions).nullable(),
  emotion_end: z.enum(emotions).nullable(),
})
export type SceneEdit = z.infer<typeof sceneEditSchema>

// D&D確定時の全シーン最終順序（レーン=part はドロップ先で確定する）
export const sceneOrderSchema = z
  .array(z.object({ id: z.uuid(), part: z.enum(sceneParts) }))
  .max(500)
export type SceneOrder = z.infer<typeof sceneOrderSchema>
