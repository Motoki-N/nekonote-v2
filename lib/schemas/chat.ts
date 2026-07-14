import { z } from 'zod'

/** 掘り下げ対象ノートのコンテキスト（送信時点のエディタ現在値） */
export const noteContextSchema = z.object({
  title: z.string().max(500),
  content: z.string().max(100_000, 'ノート本文が長すぎます'),
  tags: z.array(z.string().max(100)).max(50),
})

/** リクエストコンテキストの判別union（SPEC-conversational-personas §5.2）。
 *  note = ノート掘り下げ / dashboard = ダッシュボード相談（projectId 省略で「指定なし」） */
export const chatContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), note: noteContextSchema }),
  z.object({ kind: z.literal('dashboard'), projectId: z.uuid().optional() }),
])

export type ChatContext = z.infer<typeof chatContextSchema>

/** POST /api/chat のリクエストボディ。
 *  messages は AI SDK の UIMessage[]（構造の詳細検証はSDK側に任せる） */
export const chatRequestSchema = z.object({
  threadId: z.uuid(),
  context: chatContextSchema,
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
})

export type ChatRequest = z.infer<typeof chatRequestSchema>
