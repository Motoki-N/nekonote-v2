"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import { noteUpdateSchema, tagInputSchema } from "@/lib/schemas/notes";
import type { TagInput } from "@/lib/schemas/notes";

export type { ActionResult } from "@/lib/errors";

const uuidSchema = z.uuid();

/** 1クリック新規作成: 空ノートを作ってエディタへ遷移する */
export async function createNote(): Promise<never> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({})
    .select("id")
    .single();
  if (error || !data) {
    // redirect を含むアクションのため、失敗時のみ throw（一覧側の error.tsx で拾う）
    throw new AppError(
      "internal",
      error?.message ?? "ノートの作成に失敗しました",
    );
  }
  revalidatePath("/notes");
  redirect(`/notes/${data.id}`);
}

/** 履歴スナップショットの間引き間隔（前回バージョンからこの時間経過していたら保存。Issue #111） */
const VERSION_INTERVAL_MS = 10 * 60 * 1000;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type NoteSnapshot = { title: string; content: string };

/** 上書き前のノート行を note_versions へ保存する */
async function insertSnapshot(
  supabase: SupabaseServerClient,
  noteId: string,
  row: NoteSnapshot,
): Promise<void> {
  const { error } = await supabase
    .from("note_versions")
    .insert({ note_id: noteId, title: row.title, content: row.content });
  if (error) throw new AppError("internal", error.message);
}

/** 時間ベース間引き: 最新バージョンから一定時間経過していたら上書き前の行をスナップショットする */
async function snapshotIfStale(
  supabase: SupabaseServerClient,
  noteId: string,
  current: NoteSnapshot,
): Promise<void> {
  const { data: latest, error } = await supabase
    .from("note_versions")
    .select("created_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (
    latest &&
    Date.now() - Date.parse(latest.created_at) < VERSION_INTERVAL_MS
  )
    return;
  await insertSnapshot(supabase, noteId, current);
}

/** 現在のノート行を取得する（存在しなければ not_found） */
async function fetchNoteSnapshot(
  supabase: SupabaseServerClient,
  id: string,
): Promise<NoteSnapshot> {
  const { data, error } = await supabase
    .from("notes")
    .select("title, content")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!data) throw new AppError("not_found", "ノートが見つかりません");
  return data;
}

/** 自動保存の受け口 */
export async function updateNote(
  id: string,
  input: { title?: string; content?: string },
): Promise<ActionResult> {
  try {
    const noteId = uuidSchema.parse(id);
    const parsed = noteUpdateSchema.parse(input);
    const supabase = await createClient();
    const current = await fetchNoteSnapshot(supabase, noteId);
    // 内容が変わらない保存（復元直後のフラッシュ等）は更新もスナップショットもしない
    if (
      (parsed.title ?? current.title) === current.title &&
      (parsed.content ?? current.content) === current.content
    ) {
      return { ok: true };
    }
    // 「上書き前の状態」を残す: 編集セッション開始前の行が必ず1つ版に残る（Issue #111）
    await snapshotIfStale(supabase, noteId, current);
    const { data, error } = await supabase
      .from("notes")
      .update(parsed)
      .eq("id", noteId)
      .select("id");
    if (error) throw new AppError("internal", error.message);
    if (!data || data.length === 0)
      throw new AppError("not_found", "ノートが見つかりません");
    revalidatePath("/notes");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export type NoteVersion = {
  id: string;
  title: string;
  content: string;
  created_at: string;
};

/** バージョン履歴の一覧（新しい順。プレビュー用に content も返す） */
export async function listNoteVersions(
  noteId: string,
): Promise<ActionResult<NoteVersion[]>> {
  try {
    const id = uuidSchema.parse(noteId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("note_versions")
      .select("id, title, content, created_at")
      .eq("note_id", id)
      .order("created_at", { ascending: false });
    if (error) throw new AppError("internal", error.message);
    return { ok: true, data: data ?? [] };
  } catch (error) {
    return toActionError(error);
  }
}

/** 指定バージョンの内容へ復元する。復元自体を取り消せるよう、現在行を間引きなしでスナップショットする */
export async function restoreNoteVersion(
  noteId: string,
  versionId: string,
): Promise<ActionResult> {
  try {
    const id = uuidSchema.parse(noteId);
    const targetVersionId = uuidSchema.parse(versionId);
    const supabase = await createClient();
    const { data: version, error: versionError } = await supabase
      .from("note_versions")
      .select("title, content")
      .eq("id", targetVersionId)
      .eq("note_id", id)
      .maybeSingle();
    if (versionError) throw new AppError("internal", versionError.message);
    if (!version) throw new AppError("not_found", "バージョンが見つかりません");

    const current = await fetchNoteSnapshot(supabase, id);
    // 現在と同一内容への復元は何もしない（無駄な版を作らない）
    if (
      version.title === current.title &&
      version.content === current.content
    ) {
      return { ok: true };
    }
    await insertSnapshot(supabase, id, current);

    const { data, error } = await supabase
      .from("notes")
      .update({ title: version.title, content: version.content })
      .eq("id", id)
      .select("id");
    if (error) throw new AppError("internal", error.message);
    if (!data || data.length === 0)
      throw new AppError("not_found", "ノートが見つかりません");
    revalidatePath("/notes");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** ごみ箱へ移動（ソフトデリート） */
export async function trashNote(id: string): Promise<ActionResult> {
  return setDeletedAt(id, new Date().toISOString());
}

/** ごみ箱から復元 */
export async function restoreNote(id: string): Promise<ActionResult> {
  return setDeletedAt(id, null);
}

async function setDeletedAt(
  id: string,
  deletedAt: string | null,
): Promise<ActionResult> {
  try {
    const noteId = uuidSchema.parse(id);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notes")
      .update({ deleted_at: deletedAt })
      .eq("id", noteId)
      .select("id");
    if (error) throw new AppError("internal", error.message);
    if (!data || data.length === 0)
      throw new AppError("not_found", "ノートが見つかりません");
    revalidatePath("/notes");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** 完全削除（物理DELETE。note_tags は cascade で外れ、タグ自体は残る） */
export async function deleteNotePermanently(id: string): Promise<ActionResult> {
  try {
    const noteId = uuidSchema.parse(id);
    const supabase = await createClient();
    const { error } = await supabase.from("notes").delete().eq("id", noteId);
    if (error) throw new AppError("internal", error.message);
    revalidatePath("/notes");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export type AttachedTag = { id: string; name: string; kind: string };

/**
 * タグを get-or-create してノートに付与する。
 * インライン新規作成とテンプレート挿入時の category タグ自動付与の両方で使う
 */
export async function attachTag(
  noteId: string,
  input: TagInput,
): Promise<ActionResult<AttachedTag>> {
  try {
    const id = uuidSchema.parse(noteId);
    const parsed = tagInputSchema.parse(input);
    const supabase = await createClient();

    // get-or-create: unique (user_id, kind, name) に対する upsert
    const { data: tag, error: tagError } = await supabase
      .from("tags")
      .upsert(parsed, {
        onConflict: "user_id,kind,name",
        ignoreDuplicates: false,
      })
      .select("id, name, kind")
      .single();
    if (tagError || !tag)
      throw new AppError(
        "internal",
        tagError?.message ?? "タグの作成に失敗しました",
      );

    // 既に付与済みなら成功扱い（テンプレ再挿入などで重複しうる）
    const { error: linkError } = await supabase
      .from("note_tags")
      .upsert({ note_id: id, tag_id: tag.id }, { ignoreDuplicates: true });
    if (linkError) throw new AppError("internal", linkError.message);

    revalidatePath("/notes");
    return { ok: true, data: tag };
  } catch (error) {
    return toActionError(error);
  }
}

/** タグ名は一覧とノート編集画面の両方に出るため、両ルートを revalidate する */
function revalidateNotePaths(): void {
  revalidatePath("/notes");
  revalidatePath("/notes/[id]", "page");
}

/**
 * 統合: from のノート紐づけを to へ付け替えて from を削除する。
 * 付け替え済みの古い紐づけは tags 削除の cascade で外れる
 */
async function mergeTagInto(
  supabase: SupabaseServerClient,
  fromTagId: string,
  toTagId: string,
): Promise<void> {
  // PostgREST の max_rows で暗黙に打ち切られると、付け替え漏れのまま元タグを削除して
  // cascade でタグ付けが消える。取りこぼさないようページングする
  const PAGE_SIZE = 500;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: links, error } = await supabase
      .from("note_tags")
      .select("note_id")
      // ページ境界を安定させるための並び（付け替え先は tag_id が異なるため対象集合は動かない）
      .order("note_id")
      .range(from, from + PAGE_SIZE - 1)
      .eq("tag_id", fromTagId);
    if (error) throw new AppError("internal", error.message);
    if (!links || links.length === 0) break;
    // 統合先が既に付いているノートもあるため重複は無視する
    const { error: linkError } = await supabase.from("note_tags").upsert(
      links.map((link) => ({ note_id: link.note_id, tag_id: toTagId })),
      { ignoreDuplicates: true },
    );
    if (linkError) throw new AppError("internal", linkError.message);
    if (links.length < PAGE_SIZE) break;
  }
  const { error: deleteError } = await supabase
    .from("tags")
    .delete()
    .eq("id", fromTagId);
  if (deleteError) throw new AppError("internal", deleteError.message);
}

export type RenamedTag = {
  /** 統合された場合は統合先のタグID（呼び出し元のタグIDは消える） */
  id: string;
  name: string;
  kind: string;
  merged: boolean;
};

/**
 * タグ名を変更する（Issue #200）。同じ種類に同名のタグが既にある場合は、
 * `allowMerge` が指定されていればそのタグへ統合し、そうでなければ conflict を返す。
 * 統合は元タグを消す取り消せない操作のため、確認を経た呼び出しだけが実行できるようにする
 */
export async function renameTag(
  tagId: string,
  name: string,
  options?: { allowMerge?: boolean },
): Promise<ActionResult<RenamedTag>> {
  try {
    const id = uuidSchema.parse(tagId);
    // ZodError は toActionError で internal（固定文言）になるため、入力起因はここで validation に変換する
    const nameResult = tagInputSchema.shape.name.safeParse(
      typeof name === "string" ? name.trim() : name,
    );
    if (!nameResult.success)
      throw new AppError(
        "validation",
        nameResult.error.issues[0]?.message ?? "タグ名が不正です",
      );
    const newName = nameResult.data;
    const supabase = await createClient();

    const { data: tag, error: tagError } = await supabase
      .from("tags")
      .select("id, name, kind")
      .eq("id", id)
      .maybeSingle();
    if (tagError) throw new AppError("internal", tagError.message);
    if (!tag) throw new AppError("not_found", "タグが見つかりません");
    if (tag.name === newName)
      return { ok: true, data: { ...tag, merged: false } };

    const { data: existing, error: existingError } = await supabase
      .from("tags")
      .select("id")
      .eq("kind", tag.kind)
      .eq("name", newName)
      .neq("id", id)
      .maybeSingle();
    if (existingError) throw new AppError("internal", existingError.message);

    if (existing) {
      // 統合の意思表示がない衝突は実行せず、呼び出し側に確認させる
      if (!options?.allowMerge)
        throw new AppError("conflict", `同じ種類に「${newName}」があります`);
      await mergeTagInto(supabase, id, existing.id);
      revalidateNotePaths();
      return {
        ok: true,
        data: { id: existing.id, name: newName, kind: tag.kind, merged: true },
      };
    }

    const { data, error } = await supabase
      .from("tags")
      .update({ name: newName })
      .eq("id", id)
      .select("id");
    if (error) throw new AppError("internal", error.message);
    if (!data || data.length === 0)
      throw new AppError("not_found", "タグが見つかりません");
    revalidateNotePaths();
    return {
      ok: true,
      data: { id, name: newName, kind: tag.kind, merged: false },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** タグを削除する（note_tags は cascade で外れ、ノート自体は残る。Issue #200） */
export async function deleteTag(tagId: string): Promise<ActionResult> {
  try {
    const id = uuidSchema.parse(tagId);
    const supabase = await createClient();
    const { error } = await supabase.from("tags").delete().eq("id", id);
    if (error) throw new AppError("internal", error.message);
    revalidateNotePaths();
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** ノートからタグを外す（タグ自体は残す） */
export async function detachTag(
  noteId: string,
  tagId: string,
): Promise<ActionResult> {
  try {
    const id = uuidSchema.parse(noteId);
    const targetTagId = uuidSchema.parse(tagId);
    const supabase = await createClient();
    const { error } = await supabase
      .from("note_tags")
      .delete()
      .eq("note_id", id)
      .eq("tag_id", targetTagId);
    if (error) throw new AppError("internal", error.message);
    revalidatePath("/notes");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
