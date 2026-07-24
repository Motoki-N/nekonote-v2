'use server'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { enforceRateLimit } from '@/lib/rate-limit'
import {
  ATTACHMENT_EXTENSION_BY_MIME,
  ATTACHMENT_MAX_BYTES,
  attachmentUrl,
} from '@/lib/schemas/attachment'
import { createClient } from '@/lib/supabase/server'

// エディタ添付のアップロード（Issue #35）。
// 実体は非公開バケット 'attachments'（{user_id}/{uuid}.{拡張子}）に置き、
// Markdown本文には失効しない安定URL（/api/attachments/{ファイル名}）だけを保存する

export type UploadedAttachment = {
  /** Markdown に埋め込む配信URL */
  url: string
  /** 元のファイル名（リンクテキスト・alt の初期値に使う） */
  fileName: string
}

export async function uploadAttachment(
  formData: FormData,
): Promise<ActionResult<UploadedAttachment>> {
  try {
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new AppError('validation', 'ファイルを選択してください')
    }
    // バケットの制限（allowed_mime_types・file_size_limit）と同値の事前検証。
    // MIME は申告値ベース（Storage 側の検証も同様）。配信は /api/attachments が
    // 保存時の Content-Type で署名URLへ流すため、偽装ファイルが実行される経路はない
    const extension = ATTACHMENT_EXTENSION_BY_MIME[file.type]
    if (!extension) {
      throw new AppError(
        'validation',
        '対応している形式は PNG / JPEG / WebP / GIF / PDF / テキストです',
      )
    }
    if (file.size === 0) {
      throw new AppError('validation', 'ファイルが空です')
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new AppError('validation', 'ファイルサイズは10MB以下にしてください')
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    // ストレージ書き込みの暴走防止（参照画像アップロードと同じ水準）
    enforceRateLimit(user.id, 'attachment-upload', { perMinute: 10, perDay: 100 })

    const storedName = `${crypto.randomUUID()}.${extension}`
    const storagePath = `${user.id}/${storedName}`
    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(storagePath, file, { contentType: file.type })
    if (uploadError) {
      throw new AppError('internal', `ファイルの保存に失敗しました: ${uploadError.message}`)
    }

    return { ok: true, data: { url: attachmentUrl(storedName), fileName: file.name } }
  } catch (error) {
    return toActionError(error)
  }
}
