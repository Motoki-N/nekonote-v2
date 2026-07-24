import { NextResponse, type NextRequest } from 'next/server'

import { AppError, errorResponse } from '@/lib/errors'
import { enforceRateLimit } from '@/lib/rate-limit'
import { ATTACHMENT_FILE_NAME_PATTERN } from '@/lib/schemas/attachment'
import { createClient } from '@/lib/supabase/server'

// エディタ添付の配信（Issue #35）。
// Markdown本文には失効しない安定URL（このルート）を保存し、アクセス時に
// 短寿命の署名URLへリダイレクトする（/api/editor/asset と同じ認証プロキシ方式）。
// 認可: セッション必須＋パスを {自分のuid}/{ファイル名} に固定（他人の添付は署名対象にならない）

/** 署名URLの寿命。リダイレクト先はブラウザに残るため短めにする */
const SIGNED_URL_TTL_SECONDS = 600

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params
    // {uuid}.{許可拡張子} のみ受け付ける（トラバーサル・任意パスを構造で遮断）
    if (!ATTACHMENT_FILE_NAME_PATTERN.test(name)) {
      throw new AppError('validation', 'ファイル名が不正です')
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    enforceRateLimit(user.id, 'attachment-serve', { perMinute: 120, perDay: 3000 })

    const { data: signed, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(`${user.id}/${name}`, SIGNED_URL_TTL_SECONDS)
    if (error || !signed) {
      throw new AppError('not_found', '添付ファイルが見つかりません')
    }

    // 署名URL自体が期限付きのため、この応答をキャッシュさせない
    return NextResponse.redirect(signed.signedUrl, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
