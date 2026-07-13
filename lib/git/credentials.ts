import 'server-only'

import { decrypt } from '@/lib/crypto'
import { AppError } from '@/lib/errors'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type GitCredential = {
  /** 復号済みトークン。クライアントへ返してはならない */
  token: string
  /** 疎通検証時の GitHub login（表示用・信頼しない値として扱う） */
  username: string
}

/**
 * Git認可の取得部の抽象化（SPEC-proofreading §5）。
 * 現状はユーザー発行PATのみ。将来 GitHub App に差し替えるときはこのインターフェースの実装を足す
 */
export type GitCredentialProvider = {
  /** 未登録なら null。復号失敗は AppError を投げる */
  getCredential(supabase: SupabaseServerClient): Promise<GitCredential | null>
}

/** user_settings の暗号化PATを復号して返す実装 */
export const patCredentialProvider: GitCredentialProvider = {
  async getCredential(supabase) {
    const { data, error } = await supabase
      .from('user_settings')
      .select('github_pat_ciphertext, github_username')
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!data?.github_pat_ciphertext) return null
    return {
      token: decrypt(data.github_pat_ciphertext),
      username: data.github_username ?? '',
    }
  },
}
