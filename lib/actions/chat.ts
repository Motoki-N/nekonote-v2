'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { ASSISTANT_PERSONA_ID } from '@/lib/ai/personas'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import type { ChatRole } from '@/lib/schemas/enums'
import { createClient } from '@/lib/supabase/server'

export type ChatMessageRecord = {
  id: string
  role: ChatRole
  content: string
}

const uuidSchema = z.uuid()

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** スレッドの保存済み履歴を古い順に読む（掘り下げ・ダッシュボード共用） */
async function loadThreadMessages(
  supabase: SupabaseServerClient,
  threadId: string,
): Promise<ChatMessageRecord[]> {
  const { data: rows, error } = await supabase
    .from('chat_messages')
    .select('id, role, content')
    .eq('thread_id', threadId)
    .order('created_at')
  if (error) throw new AppError('internal', error.message)
  return (rows ?? []) as ChatMessageRecord[]
}

/** ノートの掘り下げスレッドを get-or-create し、保存済み履歴を返す */
export async function getOrCreateDeepDiveThread(
  noteId: string,
): Promise<ActionResult<{ threadId: string; messages: ChatMessageRecord[] }>> {
  try {
    const id = uuidSchema.parse(noteId)
    const supabase = await createClient()

    const { data: existing, error: selectError } = await supabase
      .from('chat_threads')
      .select('id')
      .eq('note_id', id)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)

    let threadId = existing?.id
    if (!threadId) {
      const { data: created, error: insertError } = await supabase
        .from('chat_threads')
        .insert({ note_id: id, persona_id: ASSISTANT_PERSONA_ID })
        .select('id')
        .single()
      if (insertError) {
        // 端末間の同時作成で部分uniqueに弾かれた場合は既存行を取り直す
        if (insertError.code === '23505') {
          const { data: raced } = await supabase
            .from('chat_threads')
            .select('id')
            .eq('note_id', id)
            .maybeSingle()
          threadId = raced?.id
        }
        if (!threadId) throw new AppError('internal', insertError.message)
      } else {
        threadId = created.id
      }
    }

    return {
      ok: true,
      data: { threadId, messages: await loadThreadMessages(supabase, threadId) },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * ダッシュボード相談スレッド（note_id null・ペルソナごとに1本）を get-or-create し、
 * 保存済み履歴を返す（SPEC-conversational-personas §5.1）
 */
export async function getOrCreateDashboardThread(
  personaId: string,
): Promise<ActionResult<{ threadId: string; messages: ChatMessageRecord[] }>> {
  try {
    const id = uuidSchema.parse(personaId)
    const supabase = await createClient()

    // conversational 型かをサーバー側で再検証（reviewer 型のスレッドを作らせない。
    // 標準 or 自分のペルソナかの所有チェックはRLSが担う＝他人のものは0件で not_found）
    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('id, persona_type')
      .eq('id', id)
      .maybeSingle()
    if (personaError) throw new AppError('internal', personaError.message)
    if (!persona) throw new AppError('not_found', 'ペルソナが見つかりません')
    if (persona.persona_type !== 'conversational') {
      throw new AppError('validation', 'このペルソナとは会話できません')
    }

    const { data: existing, error: selectError } = await supabase
      .from('chat_threads')
      .select('id')
      .eq('persona_id', id)
      .is('note_id', null)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)

    let threadId = existing?.id
    if (!threadId) {
      const { data: created, error: insertError } = await supabase
        .from('chat_threads')
        .insert({ persona_id: id })
        .select('id')
        .single()
      if (insertError) {
        // 端末間の同時作成で部分unique（chat_threads_user_persona_dashboard_uniq）に
        // 弾かれた場合は既存行を取り直す
        if (insertError.code === '23505') {
          const { data: raced } = await supabase
            .from('chat_threads')
            .select('id')
            .eq('persona_id', id)
            .is('note_id', null)
            .maybeSingle()
          threadId = raced?.id
        }
        if (!threadId) throw new AppError('internal', insertError.message)
      } else {
        threadId = created.id
      }
    }

    return {
      ok: true,
      data: { threadId, messages: await loadThreadMessages(supabase, threadId) },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/** AI応答の1行目からノートタイトルを作る（Markdown記号を除去して最大50字） */
function noteTitleFrom(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim() !== '') ?? ''
  return firstLine.replace(/^[#>\-*+\s]+/, '').trim().slice(0, 50)
}

/**
 * AI応答を新規ノートとして保存する（SPEC-conversational-personas §3.4）。
 * 本文はDBから読み直す＝クライアント改変の混入を防ぐ。所有確認は
 * chat_messages の RLS（親スレッド経由）が担う
 */
export async function saveChatMessageAsNote(
  messageId: string,
): Promise<ActionResult<{ noteId: string }>> {
  try {
    const id = uuidSchema.parse(messageId)
    const supabase = await createClient()

    const { data: message, error: selectError } = await supabase
      .from('chat_messages')
      .select('id, role, content')
      .eq('id', id)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)
    if (!message) throw new AppError('not_found', 'メッセージが見つかりません')
    if (message.role !== 'assistant') {
      throw new AppError('validation', 'AIの応答のみノートに保存できます')
    }

    const { data: note, error: insertError } = await supabase
      .from('notes')
      .insert({ title: noteTitleFrom(message.content), content: message.content })
      .select('id')
      .single()
    if (insertError || !note) {
      throw new AppError('internal', insertError?.message ?? 'ノートの作成に失敗しました')
    }

    revalidatePath('/notes')
    return { ok: true, data: { noteId: note.id } }
  } catch (error) {
    return toActionError(error)
  }
}

/** 会話をリセット: スレッドごと削除する（cascade でメッセージも消える。次回開いたとき再作成） */
export async function resetThread(threadId: string): Promise<ActionResult> {
  try {
    const id = uuidSchema.parse(threadId)
    const supabase = await createClient()
    const { error } = await supabase.from('chat_threads').delete().eq('id', id)
    if (error) throw new AppError('internal', error.message)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
