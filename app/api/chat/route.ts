import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'

import { resolveModel } from '@/lib/ai/models'
import { buildDeepDivePrompt } from '@/lib/ai/prompts'
import { AppError, errorResponse } from '@/lib/errors'
import { chatRequestSchema } from '@/lib/schemas/chat'
import type { AiCapability } from '@/lib/schemas/enums'
import { createClient } from '@/lib/supabase/server'

// ストリーミング応答のため Vercel Functions の実行上限を延長
export const maxDuration = 60

/** SPEC-ai-deep-dive §3.2: モデルへ送る履歴は直近20メッセージに制限 */
const HISTORY_LIMIT = 20

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const parsed = chatRequestSchema.safeParse(await req.json())
    if (!parsed.success) throw new AppError('validation', 'リクエストの形式が不正です')
    const { threadId, note } = parsed.data
    const messages = parsed.data.messages as unknown as UIMessage[]

    // RLS越しの取得＝所有確認を兼ねる。担当ペルソナとノートのごみ箱状態も同時に引く
    const { data: thread, error: threadError } = await supabase
      .from('chat_threads')
      .select('id, personas (description, ai_capability), notes (deleted_at)')
      .eq('id', threadId)
      .maybeSingle()
    if (threadError) throw new AppError('internal', threadError.message)
    if (!thread) throw new AppError('not_found', 'スレッドが見つかりません')
    if (thread.notes?.deleted_at) {
      throw new AppError('not_found', 'ノートがごみ箱に入っています。復元してから掘り下げてください')
    }
    if (!thread.personas) throw new AppError('internal', '担当ペルソナが見つかりません')

    const model = await resolveModel(supabase, thread.personas.ai_capability as AiCapability)
    const recent = messages.slice(-HISTORY_LIMIT)

    const result = streamText({
      model,
      system: buildDeepDivePrompt({
        personaDescription: thread.personas.description,
        note,
      }),
      messages: await convertToModelMessages(recent),
    })

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: recent,
        // 応答完了時に差分（今回の user 発言と assistant 応答）だけを永続化する
        onEnd: async ({ messages: finalMessages }) => {
          try {
            const lastUser = [...recent].reverse().find((m) => m.role === 'user')
            const assistant = finalMessages[finalMessages.length - 1]
            const rows: { thread_id: string; role: 'user' | 'assistant'; content: string }[] = []
            if (lastUser) {
              rows.push({ thread_id: threadId, role: 'user', content: textOf(lastUser) })
            }
            if (assistant && assistant.role === 'assistant') {
              const content = textOf(assistant)
              if (content) rows.push({ thread_id: threadId, role: 'assistant', content })
            }
            if (rows.length > 0) {
              const { error } = await supabase.from('chat_messages').insert(rows)
              if (error) console.error('チャット履歴の保存に失敗:', error.message)
            }
          } catch (error) {
            // 履歴保存の失敗で応答自体は壊さない（次回送信時に履歴から欠けるのみ）
            console.error('チャット履歴の保存に失敗:', error)
          }
        },
      }),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
