import { streamObject } from 'ai'

import { resolveModel } from '@/lib/ai/models'
import { PROOFREADING_PROFILE_ID } from '@/lib/ai/personas'
import { buildReviewSystemPrompt } from '@/lib/ai/prompts'
import { AppError, errorResponse } from '@/lib/errors'
import { patCredentialProvider } from '@/lib/git/credentials'
import { getFileContent, getLatestCommitSha } from '@/lib/git/github'
import type { AiCapability } from '@/lib/schemas/enums'
import {
  manuscriptFilePathSchema,
  proofreadRequestSchema,
  proofreadSuggestionSchema,
} from '@/lib/schemas/manuscript'
import { createClient } from '@/lib/supabase/server'

// 原稿全文の校正はレビュー文書より提案数が多くなりうるため実行上限を延長
export const maxDuration = 120

/**
 * AI校正（SPEC-proofreading §3.3・§3.5）。
 * 実行時点の最新原稿を取得して streamObject（配列）で構造化提案を逐次返し、
 * 完了時に pending を置き換え保存＋ last_reviewed_commit を更新する。
 * review_sessions は使わない（提案のライフサイクルは revision_suggestions.status が担う）
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const parsed = proofreadRequestSchema.safeParse(await req.json())
    if (!parsed.success) throw new AppError('validation', 'リクエストの形式が不正です')
    const { manuscriptLinkId } = parsed.data

    // RLS越しの取得＝所有確認を兼ねる（リンク→プロジェクトの repo/base_path も同時に引く）
    const { data: link, error: linkError } = await supabase
      .from('manuscript_links')
      .select('id, file_path, projects (id, repo)')
      .eq('id', manuscriptLinkId)
      .maybeSingle()
    if (linkError) throw new AppError('internal', linkError.message)
    if (!link || !link.projects) throw new AppError('not_found', '原稿リンクが見つかりません')
    if (!link.projects.repo) throw new AppError('validation', 'リポジトリが設定されていません')
    // DB由来の file_path も再検証する（PostgREST直叩きで作られた不正な行への多層防御）
    const filePath = manuscriptFilePathSchema.parse(link.file_path)

    const credential = await patCredentialProvider.getCredential(supabase)
    if (!credential) {
      throw new AppError('validation', 'GitHub PATが未登録です。設定から登録してください')
    }

    // 画面表示が古くても、その時点の最新原稿を正として校正する
    const [content, latestSha] = await Promise.all([
      getFileContent(credential.token, link.projects.repo, filePath),
      getLatestCommitSha(credential.token, link.projects.repo, filePath),
    ])

    // 校正・校閲プロファイル＋担当の校正さん（default_persona_id 経由）
    const { data: profile, error: profileError } = await supabase
      .from('review_profiles')
      .select('prompt_template, personas (description, ai_capability)')
      .eq('id', PROOFREADING_PROFILE_ID)
      .maybeSingle()
    if (profileError) throw new AppError('internal', profileError.message)
    if (!profile?.personas) {
      throw new AppError('internal', '校正プロファイルまたは担当ペルソナが見つかりません')
    }

    const model = await resolveModel(supabase, profile.personas.ai_capability as AiCapability)

    const result = streamObject({
      model,
      output: 'array',
      schema: proofreadSuggestionSchema,
      system: buildReviewSystemPrompt({
        personaDescription: profile.personas.description,
        promptTemplate: profile.prompt_template,
      }),
      // 校正さんの reference_scope は「原稿テキストのみ」（企画書・ノート・シーンは渡さない）
      prompt: content,
      // ストリーム開始後のプロバイダエラーはHTTPステータスに出ないため、サーバーログに残す
      onError: ({ error }) => {
        console.error('校正ストリームでエラー:', error)
      },
      // 完了時にまとめて保存する（stop による切断時は保存せず、半端な提案を残さない）
      onFinish: async ({ object }) => {
        // スキーマ検証に失敗した場合は object が undefined（既存 pending は温存する）
        if (!object) return
        try {
          // 再校正は pending のみ置き換え（on_hold / accepted / rejected は残す。SPEC §2）
          const { error: deleteError } = await supabase
            .from('revision_suggestions')
            .delete()
            .eq('manuscript_link_id', link.id)
            .eq('status', 'pending')
          if (deleteError) {
            console.error('既存提案の削除に失敗:', deleteError.message)
            return
          }
          if (object.length > 0) {
            const { error: insertError } = await supabase.from('revision_suggestions').insert(
              object.map((s) => ({
                manuscript_link_id: link.id,
                granularity: 'sentence',
                original_text: s.original_text,
                suggested_text: s.suggested_text,
                reason: s.reason,
                status: 'pending',
              })),
            )
            if (insertError) {
              console.error('提案の保存に失敗:', insertError.message)
              return
            }
          }
          const { error: shaError } = await supabase
            .from('manuscript_links')
            .update({ last_reviewed_commit: latestSha })
            .eq('id', link.id)
          if (shaError) console.error('last_reviewed_commit の更新に失敗:', shaError.message)
        } catch (error) {
          // 保存の失敗でストリーム自体は壊さない（クライアントは取り直しで気づける）
          console.error('校正結果の保存に失敗:', error)
        }
      },
    })

    return result.toTextStreamResponse()
  } catch (error) {
    return errorResponse(error)
  }
}
