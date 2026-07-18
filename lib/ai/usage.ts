import 'server-only'

import type { AiProvider } from '@/lib/schemas/enums'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** 使用量ログの機能種別（lib/rate-limit のキーと同じ語彙。DBの CHECK 制約と対応） */
export type AiUsageFeature =
  | 'chat'
  | 'review'
  | 'proofread'
  | 'illustration-propose'
  | 'illustration-generate'

/**
 * AI呼び出し1回分のトークン使用量を記録する（Issue #45。金額換算はしない）。
 * user_id は DB デフォルト（auth.uid()）＝本人の行としてのみ作られる。
 * 計測の失敗で本処理を壊さない: throw せずログに残すのみ
 */
export async function recordAiUsage(
  supabase: SupabaseServerClient,
  entry: {
    feature: AiUsageFeature
    provider: AiProvider
    modelId: string
    inputTokens: number | undefined
    outputTokens: number | undefined
  },
): Promise<void> {
  try {
    const { error } = await supabase.from('ai_usage_logs').insert({
      feature: entry.feature,
      provider: entry.provider,
      model_id: entry.modelId,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
    })
    if (error) console.error('AI使用量の記録に失敗:', error.message)
  } catch (error) {
    console.error('AI使用量の記録に失敗:', error)
  }
}
