'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppError, toAppError } from '@/lib/errors'
import { noteUpdateSchema, tagInputSchema } from '@/lib/schemas/notes'
import type { TagInput } from '@/lib/schemas/notes'

// Server Action の throw は本番でメッセージが握りつぶされるため、
// { ok, error? } の戻り値でクライアントへ伝える（internal は固定文言に置換）
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } }

function toActionError(error: unknown): ActionResult<never> {
  const appError = toAppError(error)
  if (appError.code === 'internal') {
    console.error(appError)
    return { ok: false, error: { code: 'internal', message: 'サーバーエラーが発生しました' } }
  }
  return { ok: false, error: { code: appError.code, message: appError.message } }
}

/** 1クリック新規作成: 空ノートを作ってエディタへ遷移する */
export async function createNote(): Promise<never> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notes')
    .insert({})
    .select('id')
    .single()
  if (error || !data) {
    // redirect を含むアクションのため、失敗時のみ throw（一覧側の error.tsx で拾う）
    throw new AppError('internal', error?.message ?? 'ノートの作成に失敗しました')
  }
  revalidatePath('/notes')
  redirect(`/notes/${data.id}`)
}

/** 自動保存の受け口 */
export async function updateNote(
  id: string,
  input: { title?: string; content?: string },
): Promise<ActionResult> {
  try {
    const parsed = noteUpdateSchema.parse(input)
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('notes')
      .update(parsed)
      .eq('id', id)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!data || data.length === 0) throw new AppError('not_found', 'ノートが見つかりません')
    revalidatePath('/notes')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** ごみ箱へ移動（ソフトデリート） */
export async function trashNote(id: string): Promise<ActionResult> {
  return setDeletedAt(id, new Date().toISOString())
}

/** ごみ箱から復元 */
export async function restoreNote(id: string): Promise<ActionResult> {
  return setDeletedAt(id, null)
}

async function setDeletedAt(id: string, deletedAt: string | null): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('notes')
      .update({ deleted_at: deletedAt })
      .eq('id', id)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!data || data.length === 0) throw new AppError('not_found', 'ノートが見つかりません')
    revalidatePath('/notes')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/** 完全削除（物理DELETE。note_tags は cascade で外れ、タグ自体は残る） */
export async function deleteNotePermanently(id: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('notes').delete().eq('id', id)
    if (error) throw new AppError('internal', error.message)
    revalidatePath('/notes')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

export type AttachedTag = { id: string; name: string; kind: string }

/**
 * タグを get-or-create してノートに付与する。
 * インライン新規作成とテンプレート挿入時の category タグ自動付与の両方で使う
 */
export async function attachTag(
  noteId: string,
  input: TagInput,
): Promise<ActionResult<AttachedTag>> {
  try {
    const parsed = tagInputSchema.parse(input)
    const supabase = await createClient()

    // get-or-create: unique (user_id, kind, name) に対する upsert
    const { data: tag, error: tagError } = await supabase
      .from('tags')
      .upsert(parsed, { onConflict: 'user_id,kind,name', ignoreDuplicates: false })
      .select('id, name, kind')
      .single()
    if (tagError || !tag) throw new AppError('internal', tagError?.message ?? 'タグの作成に失敗しました')

    // 既に付与済みなら成功扱い（テンプレ再挿入などで重複しうる）
    const { error: linkError } = await supabase
      .from('note_tags')
      .upsert({ note_id: noteId, tag_id: tag.id }, { ignoreDuplicates: true })
    if (linkError) throw new AppError('internal', linkError.message)

    revalidatePath('/notes')
    return { ok: true, data: tag }
  } catch (error) {
    return toActionError(error)
  }
}

/** ノートからタグを外す（タグ自体は残す） */
export async function detachTag(noteId: string, tagId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('note_tags')
      .delete()
      .eq('note_id', noteId)
      .eq('tag_id', tagId)
    if (error) throw new AppError('internal', error.message)
    revalidatePath('/notes')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
