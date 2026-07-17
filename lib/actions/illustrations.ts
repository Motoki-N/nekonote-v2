'use server'

import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import type { IllustrationKind } from '@/lib/schemas/enums'
import { illustrationTitleSchema, type IllustrationItem } from '@/lib/schemas/illustration'
import { createClient } from '@/lib/supabase/server'

// ギャラリーの取得・タイトル編集・削除（SPEC-illustrator §5.4）。
// 生成は /api/illustration/*（レートリミット・長時間実行のためAPI Route側）

const uuidSchema = z.uuid()

/** 署名URLの寿命（SPEC §6: 短寿命） */
const SIGNED_URL_TTL_SECONDS = 3600

/** 選択中プロジェクトのイラスト一覧（新しい順）＋署名URL＋被参照数（削除警告用） */
export async function listIllustrations(
  projectId: string,
): Promise<ActionResult<IllustrationItem[]>> {
  try {
    const parsedId = uuidSchema.parse(projectId)
    const supabase = await createClient()

    // RLS越し＝自分のイラストのみ。被参照数も自分の行の範囲で数える（それ以外は存在しない前提）
    const { data: rows, error } = await supabase
      .from('illustrations')
      .select('id, project_id, kind, title, prompt, reference_illustration_id, storage_path, created_at')
      .eq('project_id', parsedId)
      .order('created_at', { ascending: false })
    if (error) throw new AppError('internal', error.message)
    if (!rows || rows.length === 0) return { ok: true, data: [] }

    // 被参照数はプロジェクト横断で数える（他プロジェクトのイラストから参照されうる）
    const { data: refRows, error: refError } = await supabase
      .from('illustrations')
      .select('reference_illustration_id')
      .not('reference_illustration_id', 'is', null)
    if (refError) throw new AppError('internal', refError.message)
    const referencedCount = new Map<string, number>()
    for (const row of refRows ?? []) {
      const id = row.reference_illustration_id
      if (id) referencedCount.set(id, (referencedCount.get(id) ?? 0) + 1)
    }

    const { data: signed, error: signError } = await supabase.storage
      .from('illustrations')
      .createSignedUrls(
        rows.map((row) => row.storage_path),
        SIGNED_URL_TTL_SECONDS,
      )
    if (signError || !signed) {
      throw new AppError('internal', `画像URLの発行に失敗しました: ${signError?.message}`)
    }
    const urlByPath = new Map(signed.map((entry) => [entry.path, entry.signedUrl]))

    // 実体を失った行（削除の途中失敗等）はスキップし、一覧全体は生かす。
    // 該当行は削除のリトライ（remove は存在しないパスを許容）で消せる
    const items: IllustrationItem[] = rows.flatMap((row) => {
      const signedUrl = urlByPath.get(row.storage_path)
      if (!signedUrl) return []
      return {
        id: row.id,
        projectId: row.project_id,
        kind: row.kind as IllustrationKind,
        title: row.title,
        prompt: row.prompt,
        referenceIllustrationId: row.reference_illustration_id,
        createdAt: row.created_at,
        signedUrl,
        referencedCount: referencedCount.get(row.id) ?? 0,
      }
    })
    return { ok: true, data: items }
  } catch (error) {
    return toActionError(error)
  }
}

/** タイトルのインライン編集（空文字不可・重複は許容。SPEC §5.4） */
export async function updateIllustrationTitle(
  illustrationId: string,
  title: string,
): Promise<ActionResult> {
  try {
    const parsedId = uuidSchema.parse(illustrationId)
    const parsedTitle = illustrationTitleSchema.parse(title)
    const supabase = await createClient()

    // RLSが所有確認を担う。0件更新＝存在しないか他人の行
    const { data: updated, error } = await supabase
      .from('illustrations')
      .update({ title: parsedTitle })
      .eq('id', parsedId)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!updated || updated.length === 0) {
      throw new AppError('not_found', 'イラストが見つかりません')
    }
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * イラストの削除（確認ダイアログ＋物理削除。SPEC §2）。
 * Storage実体→行の順で消す。被参照の警告は一覧の referencedCount でクライアントが出す
 */
export async function deleteIllustration(illustrationId: string): Promise<ActionResult> {
  try {
    const parsedId = uuidSchema.parse(illustrationId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認（storage_path をクライアントから受け取らない）
    const { data: row, error } = await supabase
      .from('illustrations')
      .select('id, storage_path')
      .eq('id', parsedId)
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!row) throw new AppError('not_found', 'イラストが見つかりません')

    // 実体の削除に失敗したら行は残す（リトライ可能。行なしオブジェクトの孤児を作らない）
    const { error: removeError } = await supabase.storage
      .from('illustrations')
      .remove([row.storage_path])
    if (removeError) {
      throw new AppError('internal', `画像の削除に失敗しました: ${removeError.message}`)
    }

    const { error: deleteError } = await supabase.from('illustrations').delete().eq('id', row.id)
    if (deleteError) throw new AppError('internal', deleteError.message)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
