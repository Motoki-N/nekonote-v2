import { z } from "zod";
import { tagKinds } from "./enums";

// user_id はクライアントから受け取らず、DBの default auth.uid() に任せる（全スキーマ共通）

export const noteInputSchema = z.object({
  title: z.string().max(500, "タイトルが長すぎます").default(""),
  // Markdown 生データ。上限はチャットのノートコンテキスト（noteContextSchema）と同じ10万字
  // （企画書レビューが紐づけノート全文をLLMに渡すため、無上限だとコスト増幅の経路になる）
  content: z
    .string()
    .max(100_000, "ノート本文が長すぎます（上限10万字）")
    .default(""),
});
export const noteUpdateSchema = noteInputSchema.partial();

export type NoteInput = z.infer<typeof noteInputSchema>;
export type NoteUpdate = z.infer<typeof noteUpdateSchema>;

export const tagInputSchema = z.object({
  name: z
    .string()
    .min(1, "タグ名を入力してください")
    .max(100, "タグ名が長すぎます"),
  kind: z.enum(tagKinds),
});
export const tagUpdateSchema = tagInputSchema.partial();

export type TagInput = z.infer<typeof tagInputSchema>;
export type TagUpdate = z.infer<typeof tagUpdateSchema>;

export const noteTagInputSchema = z.object({
  note_id: z.uuid(),
  tag_id: z.uuid(),
});

export type NoteTagInput = z.infer<typeof noteTagInputSchema>;
