import { z } from "zod";
import {
  aiCapabilities,
  personaTypes,
  referenceScopes,
  reviewSessionStatuses,
  reviewVerdicts,
  targetPhases,
  writingGenres,
} from "./enums";

// is_default（標準同梱フラグ）はユーザー入力に含めない。
// 標準同梱行はマイグレーション（Sprint 2 のシード）でのみ作成する

export const personaInputSchema = z.object({
  name: z
    .string()
    .min(1, "名前を入力してください")
    .max(100, "名前が長すぎます"),
  // description / prompt_template はシステムプロンプトに直結するため、LLM入力の肥大化を上限で防ぐ
  description: z
    .string()
    .min(1, "性格・口調・スタンスを入力してください")
    .max(10_000, "説明が長すぎます（上限1万字）"),
  ai_capability: z.enum(aiCapabilities),
  reference_scope: z.enum(referenceScopes),
  persona_type: z.enum(personaTypes),
  writing_genre: z.enum(writingGenres).nullish(), // null = 全ジャンル共通（SPEC-genre-profiles）
});
export const personaUpdateSchema = personaInputSchema.partial();

export type PersonaInput = z.infer<typeof personaInputSchema>;
export type PersonaUpdate = z.infer<typeof personaUpdateSchema>;

export const reviewProfileInputSchema = z.object({
  name: z
    .string()
    .min(1, "名前を入力してください")
    .max(100, "名前が長すぎます"),
  target_phase: z.enum(targetPhases),
  prompt_template: z
    .string()
    .min(1, "プロンプトを入力してください")
    .max(20_000, "プロンプトが長すぎます（上限2万字）"),
  default_persona_id: z.uuid().nullish(),
  writing_genre: z.enum(writingGenres).nullish(), // null = 全ジャンル共通（SPEC-genre-profiles）
});
export const reviewProfileUpdateSchema = reviewProfileInputSchema.partial();

export type ReviewProfileInput = z.infer<typeof reviewProfileInputSchema>;
export type ReviewProfileUpdate = z.infer<typeof reviewProfileUpdateSchema>;

export const reviewSessionInputSchema = z.object({
  project_id: z.uuid(),
  review_profile_id: z.uuid().nullish(),
  persona_id: z.uuid().nullish(), // 実際に起用したペルソナ（デフォルト担当から変更可）
  target_ref: z.string().nullish(), // proposal id / scene id / 原稿パス
  status: z.enum(reviewSessionStatuses).default("running"),
});
export const reviewSessionUpdateSchema = reviewSessionInputSchema
  .partial()
  .omit({ project_id: true });

export type ReviewSessionInput = z.infer<typeof reviewSessionInputSchema>;
export type ReviewSessionUpdate = z.infer<typeof reviewSessionUpdateSchema>;

export const reviewFeedbackInputSchema = z.object({
  review_session_id: z.uuid(),
  content: z.string().min(1),
  user_response: z.string().nullish(),
  verdict: z.enum(reviewVerdicts).nullish(), // AIの承認判定（判定行のパース結果）
});
export const reviewFeedbackUpdateSchema = reviewFeedbackInputSchema
  .partial()
  .omit({ review_session_id: true });

export type ReviewFeedbackInput = z.infer<typeof reviewFeedbackInputSchema>;
export type ReviewFeedbackUpdate = z.infer<typeof reviewFeedbackUpdateSchema>;

/** POST /api/review のリクエストボディ（レビュー入力は保存済みDB値からサーバー側で組み立てる） */
export const reviewRequestSchema = z.object({
  sessionId: z.uuid(),
  // 講評のみ: 原稿が15万字を超えている旨をユーザーが了承済み（SPEC-dashboard-critique-settings §3.3）
  confirmLong: z.boolean().optional(),
});

export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
