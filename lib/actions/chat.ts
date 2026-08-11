"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ASSISTANT_PERSONA_ID } from "@/lib/ai/personas";
import { chatTitleFrom } from "@/lib/chat-title";
import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import type { ChatRole } from "@/lib/schemas/enums";
import { createClient } from "@/lib/supabase/server";

export type ChatMessageRecord = {
  id: string;
  role: ChatRole;
  content: string;
};

export type ConsultThreadListItem = {
  id: string;
  title: string | null;
  personaName: string | null;
  updatedAt: string;
};

const uuidSchema = z.uuid();

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** スレッドの保存済み履歴を古い順に読む（掘り下げ・ダッシュボード共用） */
async function loadThreadMessages(
  supabase: SupabaseServerClient,
  threadId: string,
): Promise<ChatMessageRecord[]> {
  const { data: rows, error } = await supabase
    .from("chat_messages")
    .select("id, role, content")
    .eq("thread_id", threadId)
    .order("created_at");
  if (error) throw new AppError("internal", error.message);
  return (rows ?? []) as ChatMessageRecord[];
}

/**
 * conversational 型かをサーバー側で再検証する（reviewer 型のスレッドを作らせない。
 * 標準 or 自分のペルソナかの所有チェックはRLSが担う＝他人のものは0件で not_found）
 */
async function assertConversationalPersona(
  supabase: SupabaseServerClient,
  personaId: string,
): Promise<void> {
  const { data: persona, error } = await supabase
    .from("personas")
    .select("id, persona_type")
    .eq("id", personaId)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!persona) throw new AppError("not_found", "ペルソナが見つかりません");
  if (persona.persona_type !== "conversational") {
    throw new AppError("validation", "このペルソナとは会話できません");
  }
}

/** ノートの掘り下げスレッドを get-or-create し、保存済み履歴を返す */
export async function getOrCreateDeepDiveThread(
  noteId: string,
): Promise<ActionResult<{ threadId: string; messages: ChatMessageRecord[] }>> {
  try {
    const id = uuidSchema.parse(noteId);
    const supabase = await createClient();

    const { data: existing, error: selectError } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("note_id", id)
      .maybeSingle();
    if (selectError) throw new AppError("internal", selectError.message);

    let threadId = existing?.id;
    if (!threadId) {
      const { data: created, error: insertError } = await supabase
        .from("chat_threads")
        .insert({ note_id: id, persona_id: ASSISTANT_PERSONA_ID })
        .select("id")
        .single();
      if (insertError) {
        // 端末間の同時作成で部分uniqueに弾かれた場合は既存行を取り直す
        if (insertError.code === "23505") {
          const { data: raced } = await supabase
            .from("chat_threads")
            .select("id")
            .eq("note_id", id)
            .maybeSingle();
          threadId = raced?.id;
        }
        if (!threadId) throw new AppError("internal", insertError.message);
      } else {
        threadId = created.id;
      }
    }

    return {
      ok: true,
      data: {
        threadId,
        messages: await loadThreadMessages(supabase, threadId),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * ダッシュボード相談の最新スレッド（note_id null・updated_at 降順1件）＋履歴を返す。
 * なければ作らず threadId null を返す＝パネルは新規会話状態になり、
 * スレッドは最初の送信時に作成する（SPEC-chat-thread-list §3.1・空スレッドを溜めない）
 */
export async function getLatestDashboardThread(
  personaId: string,
): Promise<
  ActionResult<{ threadId: string | null; messages: ChatMessageRecord[] }>
> {
  try {
    const id = uuidSchema.parse(personaId);
    const supabase = await createClient();
    await assertConversationalPersona(supabase, id);

    const { data: latest, error: selectError } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("persona_id", id)
      .is("note_id", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selectError) throw new AppError("internal", selectError.message);

    if (!latest) return { ok: true, data: { threadId: null, messages: [] } };
    return {
      ok: true,
      data: {
        threadId: latest.id,
        messages: await loadThreadMessages(supabase, latest.id),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** ダッシュボード相談スレッドの新規作成（初回送信時にクライアントが呼ぶ） */
export async function createDashboardThread(
  personaId: string,
): Promise<ActionResult<{ threadId: string }>> {
  try {
    const id = uuidSchema.parse(personaId);
    const supabase = await createClient();
    await assertConversationalPersona(supabase, id);

    const { data: created, error: insertError } = await supabase
      .from("chat_threads")
      .insert({ persona_id: id })
      .select("id")
      .single();
    if (insertError || !created) {
      throw new AppError(
        "internal",
        insertError?.message ?? "スレッドの作成に失敗しました",
      );
    }
    return { ok: true, data: { threadId: created.id } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * ダッシュボード相談スレッドをidで取得する（`/?consult=` 導線＋応答後の履歴同期用）。
 * RLS越し取得＝他人のidは0件で not_found。note_id null を検証し、
 * 掘り下げスレッドを相談パネルで開かせない（SPEC-chat-thread-list §5.1）
 */
export async function getDashboardThreadById(threadId: string): Promise<
  ActionResult<{
    threadId: string;
    personaId: string | null;
    messages: ChatMessageRecord[];
  }>
> {
  try {
    const id = uuidSchema.parse(threadId);
    const supabase = await createClient();

    const { data: thread, error: selectError } = await supabase
      .from("chat_threads")
      .select("id, note_id, persona_id")
      .eq("id", id)
      .maybeSingle();
    if (selectError) throw new AppError("internal", selectError.message);
    if (!thread || thread.note_id !== null) {
      throw new AppError("not_found", "スレッドが見つかりません");
    }

    return {
      ok: true,
      data: {
        threadId: thread.id,
        personaId: thread.persona_id,
        messages: await loadThreadMessages(supabase, thread.id),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** ダッシュボード相談スレッドの一覧（/chats 用。note_id null のみ・updated_at 降順） */
export async function listConsultThreads(): Promise<
  ActionResult<ConsultThreadListItem[]>
> {
  try {
    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("chat_threads")
      .select("id, title, updated_at, personas (name)")
      .is("note_id", null)
      .order("updated_at", { ascending: false });
    if (error) throw new AppError("internal", error.message);

    return {
      ok: true,
      data: (rows ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        personaName: row.personas?.name ?? null,
        updatedAt: row.updated_at,
      })),
    };
  } catch (error) {
    return toActionError(error);
  }
}

const threadTitleSchema = z
  .string()
  .trim()
  .min(1, "タイトルを入力してください")
  .max(100, "タイトルは100文字以内で入力してください");

/** スレッドのリネーム（/chats 用）。RLS越し UPDATE＝他人のidは0件で not_found */
export async function renameThread(
  threadId: string,
  title: string,
): Promise<ActionResult> {
  try {
    const id = uuidSchema.parse(threadId);
    const parsedTitle = threadTitleSchema.parse(title);
    const supabase = await createClient();

    const { data: updated, error } = await supabase
      .from("chat_threads")
      .update({ title: parsedTitle })
      .eq("id", id)
      .is("note_id", null)
      .select("id");
    if (error) throw new AppError("internal", error.message);
    if (!updated || updated.length === 0) {
      throw new AppError("not_found", "スレッドが見つかりません");
    }
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * スレッドの完全削除（cascade でメッセージも消える）。
 * /chats の削除と掘り下げの「会話をリセット」で共用。
 * RLS越し DELETE＝他人のidは0件で not_found
 */
export async function deleteThread(threadId: string): Promise<ActionResult> {
  try {
    const id = uuidSchema.parse(threadId);
    const supabase = await createClient();
    const { data: deleted, error } = await supabase
      .from("chat_threads")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw new AppError("internal", error.message);
    if (!deleted || deleted.length === 0) {
      throw new AppError("not_found", "スレッドが見つかりません");
    }
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
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
    const id = uuidSchema.parse(messageId);
    const supabase = await createClient();

    const { data: message, error: selectError } = await supabase
      .from("chat_messages")
      .select("id, role, content")
      .eq("id", id)
      .maybeSingle();
    if (selectError) throw new AppError("internal", selectError.message);
    if (!message) throw new AppError("not_found", "メッセージが見つかりません");
    if (message.role !== "assistant") {
      throw new AppError("validation", "AIの応答のみノートに保存できます");
    }

    const { data: note, error: insertError } = await supabase
      .from("notes")
      .insert({
        title: chatTitleFrom(message.content),
        content: message.content,
      })
      .select("id")
      .single();
    if (insertError || !note) {
      throw new AppError(
        "internal",
        insertError?.message ?? "ノートの作成に失敗しました",
      );
    }

    revalidatePath("/notes");
    return { ok: true, data: { noteId: note.id } };
  } catch (error) {
    return toActionError(error);
  }
}
