'use server'

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

    const { data: rows, error: messagesError } = await supabase
      .from('chat_messages')
      .select('id, role, content')
      .eq('thread_id', threadId)
      .order('created_at')
    if (messagesError) throw new AppError('internal', messagesError.message)

    return {
      ok: true,
      data: { threadId, messages: (rows ?? []) as ChatMessageRecord[] },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/** 会話をリセット: スレッドごと削除する（cascade でメッセージも消える。次回開いたとき再作成） */
export async function resetDeepDiveThread(threadId: string): Promise<ActionResult> {
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
