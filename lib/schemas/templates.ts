import { z } from 'zod'

// user_id はクライアントから受け取らず、DBの default auth.uid() に任せる（全スキーマ共通）
// is_default はユーザー入力で扱わない（標準同梱行はシードでのみ作られる）

export const templateInputSchema = z.object({
  name: z.string().min(1, 'テンプレート名を入力してください'),
  content: z.string().min(1, '雛形本文を入力してください'), // Markdown 雛形
  tag_name: z.string().nullable().default(null), // 挿入時に自動付与する category タグ名
})
export const templateUpdateSchema = templateInputSchema.partial()

export type TemplateInput = z.infer<typeof templateInputSchema>
export type TemplateUpdate = z.infer<typeof templateUpdateSchema>
