import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'

import { resolveModel } from '@/lib/ai/models'
import { ASSISTANT_PERSONA_ID } from '@/lib/ai/personas'
import {
  buildDashboardChatPrompt,
  buildDeepDivePrompt,
  type ScheduleContext,
} from '@/lib/ai/prompts'
import { AppError, errorResponse } from '@/lib/errors'
import { chatRequestSchema } from '@/lib/schemas/chat'
import type { AiCapability, ProjectStatus } from '@/lib/schemas/enums'
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

/** JST基準の日付（YYYY-MM-DD。サーバーはUTCで動くため明示する） */
function jstDate(at: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(at)
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * スケジュールコンテキストをサーバーで組み立てる（SPEC-conversational-personas §5.2）。
 * projects は RLS 越しに取得＝他人のプロジェクトidは not_found（IDOR遮断）
 */
async function buildScheduleContext(
  supabase: SupabaseServerClient,
  projectId: string,
): Promise<ScheduleContext> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('title, status, event_name, deadline, target_pages')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) throw new AppError('internal', projectError.message)
  if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')

  // 進捗は全行を日付昇順で引き、7日/30日前を跨ぐ直前の記録を増分の基準にする
  const { data: progressRows, error: progressError } = await supabase
    .from('writing_progress')
    .select('date, total_chars')
    .eq('project_id', projectId)
    .order('date')
  if (progressError) throw new AppError('internal', progressError.message)

  const rows = progressRows ?? []
  const latest = rows.at(-1) ?? null
  const now = new Date()
  const today = jstDate(now)

  // 境界日以前の直近の記録を基準にした増分。記録が疎な場合に備え、
  // ペース計算用の実スパン（基準→最新の実日数）も返す
  const deltaSince = (days: number): { chars: number; days: number } | null => {
    if (!latest) return null
    const boundary = jstDate(new Date(now.getTime() - days * 86_400_000))
    const baseline = rows.filter((row) => row.date <= boundary).at(-1)
    if (!baseline || baseline.date === latest.date) return null
    return {
      chars: latest.total_chars - baseline.total_chars,
      days: Math.round((Date.parse(latest.date) - Date.parse(baseline.date)) / 86_400_000),
    }
  }

  return {
    projectTitle: project.title,
    status: project.status as ProjectStatus,
    eventName: project.event_name,
    deadline: project.deadline,
    daysRemaining: project.deadline
      ? Math.round((Date.parse(project.deadline) - Date.parse(today)) / 86_400_000)
      : null,
    targetPages: project.target_pages,
    latest: latest ? { date: latest.date, totalChars: latest.total_chars } : null,
    delta7: deltaSince(7),
    delta30: deltaSince(30),
  }
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
    const { threadId, context } = parsed.data
    const messages = parsed.data.messages as unknown as UIMessage[]

    // RLS越しの取得＝所有確認を兼ねる。担当ペルソナとノートのごみ箱状態も同時に引く
    const { data: thread, error: threadError } = await supabase
      .from('chat_threads')
      .select(
        'id, note_id, persona_id, personas (description, ai_capability, persona_type), notes (deleted_at)',
      )
      .eq('id', threadId)
      .maybeSingle()
    if (threadError) throw new AppError('internal', threadError.message)
    if (!thread) throw new AppError('not_found', 'スレッドが見つかりません')
    if (!thread.personas) throw new AppError('internal', '担当ペルソナが見つかりません')

    // スレッドの実態とコンテキスト形態の食い違いは validation エラー
    if ((context.kind === 'note') !== (thread.note_id !== null)) {
      throw new AppError('validation', 'スレッドとコンテキストの種類が一致しません')
    }

    let system: string
    if (context.kind === 'note') {
      if (thread.notes?.deleted_at) {
        throw new AppError('not_found', 'ノートがごみ箱に入っています。復元してから掘り下げてください')
      }
      system = buildDeepDivePrompt({
        personaDescription: thread.personas.description,
        note: context.note,
      })
    } else {
      // 多層防御: PostgREST 直叩き等で作られた reviewer 型スレッドでの会話を遮断する
      // （正規経路では getOrCreateDashboardThread が同じ検証を済ませている）
      if (thread.personas.persona_type !== 'conversational') {
        throw new AppError('validation', 'このペルソナとは会話できません')
      }
      // スケジュールデータの同梱はアシスタントのみ（マスターは chat_only を厳密適用）
      const schedule =
        context.projectId && thread.persona_id === ASSISTANT_PERSONA_ID
          ? await buildScheduleContext(supabase, context.projectId)
          : null
      system = buildDashboardChatPrompt({
        personaDescription: thread.personas.description,
        schedule,
      })
    }

    const model = await resolveModel(supabase, thread.personas.ai_capability as AiCapability)
    const recent = messages.slice(-HISTORY_LIMIT)

    const result = streamText({
      model,
      system,
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
