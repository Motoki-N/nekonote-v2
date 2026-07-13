'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { encrypt } from '@/lib/crypto'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { verifyToken } from '@/lib/git/github'
import { createClient } from '@/lib/supabase/server'

// PAT本体のゆるい形式検証（GitHubのトークン形式変更に壊されない程度。実効性の検証は疎通で行う）
const patSchema = z
  .string()
  .trim()
  .min(1, 'トークンを入力してください')
  .max(500, 'トークンが長すぎます')
  .regex(/^\S+$/, 'トークンに空白は含められません')

export type GithubConnection = {
  connected: boolean
  username: string | null
}

/** GitHub連携の接続状態（登録済みか＋表示用ユーザー名のみ。暗号文・平文は返さない） */
export async function getGithubConnection(): Promise<ActionResult<GithubConnection>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('user_settings')
      .select('github_pat_ciphertext, github_username')
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    return {
      ok: true,
      data: {
        connected: Boolean(data?.github_pat_ciphertext),
        username: data?.github_username ?? null,
      },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * PATの登録・差し替え（SPEC-proofreading §3.1）。
 * 保存前に GET /user で疎通検証し、失効トークンの保存を防ぐ。保存するのは暗号文のみ
 */
export async function registerGithubPat(
  token: string,
): Promise<ActionResult<{ username: string }>> {
  try {
    const pat = patSchema.parse(token)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const { login } = await verifyToken(pat)

    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id,
      github_pat_ciphertext: encrypt(pat),
      github_username: login,
    })
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true, data: { username: login } }
  } catch (error) {
    return toActionError(error)
  }
}

/** PATの削除（暗号文・ユーザー名の両方を消す） */
export async function deleteGithubPat(): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const { error } = await supabase
      .from('user_settings')
      .update({ github_pat_ciphertext: null, github_username: null })
      .eq('user_id', user.id)
    if (error) throw new AppError('internal', error.message)

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
