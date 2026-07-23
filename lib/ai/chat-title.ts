import 'server-only'

import { generateText } from 'ai'

import { resolveModel } from '@/lib/ai/models'
import { recordAiUsage } from '@/lib/ai/usage'
import { chatTitleFrom } from '@/lib/chat-title'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * ダッシュボード相談スレッドのタイトルをAIで生成する（Issue #44、SPEC-chat-thread-list §2 の
 * 「AI生成はしない」からの変更）。低コストモデル（capability 'low'）を使い、
 * 生成に失敗した場合は機械的な chatTitleFrom にフォールバックする
 * （履歴保存の失敗で応答自体は壊さない既存方針を踏襲）
 */
export async function generateChatThreadTitle(
  supabase: SupabaseServerClient,
  userMessage: string,
): Promise<string> {
  const fallback = chatTitleFrom(userMessage)
  try {
    const { model, provider, modelId } = await resolveModel(supabase, 'low')
    const { text, usage } = await generateText({
      model,
      system:
        'あなたは会話の最初の発言から、一覧で見分けやすい短いタイトルを作る係です。' +
        '日本語で20字以内、記号や引用符・「タイトル:」等の接頭辞なしで、タイトルの本文だけを出力してください。',
      prompt: userMessage.slice(0, 2000),
    })
    await recordAiUsage(supabase, {
      feature: 'chat',
      provider,
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    const title = text.trim().slice(0, 50)
    return title || fallback
  } catch (error) {
    console.error('スレッドタイトルのAI生成に失敗:', error)
    return fallback
  }
}
