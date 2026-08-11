import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ImageModel, LanguageModel } from "ai";

import { AppError } from "@/lib/errors";
import type {
  AiCapability,
  AiProvider,
  ModelCapability,
} from "@/lib/schemas/enums";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 能力レベル→実モデルの初期マッピング（要求仕様 §4.4、image は SPEC-illustrator §5.1）。
 * ai_model_settings にユーザー行があればそちらが優先される。
 * モデルの世代交代はまず設定行で追従し、恒久化するときにこの定数を更新する
 */
export const DEFAULT_MODEL_MAP: Record<
  ModelCapability,
  { provider: AiProvider; model_id: string }
> = {
  high: { provider: "anthropic", model_id: "claude-sonnet-5" },
  medium: { provider: "openai", model_id: "gpt-5.4-mini" },
  low: { provider: "google", model_id: "gemini-3.1-flash-lite" },
  image: { provider: "google", model_id: "gemini-3.1-flash-image-preview" },
};

// 設定画面の「APIキー未設定」警告バッジの判定にも使う（キー値は絶対に返さない。有無のみ）
export const PROVIDER_ENV_KEY: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** capability のモデル設定を解決する（ユーザー行 → DEFAULT_MODEL_MAP）＋APIキーの存在検証 */
async function resolveModelConfig(
  supabase: SupabaseServerClient,
  capability: ModelCapability,
): Promise<{ provider: AiProvider; modelId: string; apiKey: string }> {
  const { data, error } = await supabase
    .from("ai_model_settings")
    .select("provider, model_id")
    .eq("capability", capability)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);

  // DBの値は CHECK 制約で aiProviders に限定されている
  const provider = (data?.provider ??
    DEFAULT_MODEL_MAP[capability].provider) as AiProvider;
  const modelId = data?.model_id ?? DEFAULT_MODEL_MAP[capability].model_id;

  const apiKey = process.env[PROVIDER_ENV_KEY[provider]];
  if (!apiKey) {
    throw new AppError(
      "validation",
      `AIプロバイダ（${provider}）のAPIキーが未設定です。環境変数 ${PROVIDER_ENV_KEY[provider]} を設定してください`,
    );
  }
  return { provider, modelId, apiKey };
}

/**
 * capability を実モデルインスタンスに解決する（AI基盤の中核。レビュー機能も共用する）。
 * 解決順: ai_model_settings のユーザー行 → DEFAULT_MODEL_MAP。
 * provider / modelId は使用量記録（lib/ai/usage.ts）用に併せて返す
 */
export async function resolveModel(
  supabase: SupabaseServerClient,
  capability: AiCapability,
): Promise<{ model: LanguageModel; provider: AiProvider; modelId: string }> {
  const { provider, modelId, apiKey } = await resolveModelConfig(
    supabase,
    capability,
  );

  switch (provider) {
    case "anthropic":
      return { model: createAnthropic({ apiKey })(modelId), provider, modelId };
    case "openai":
      return { model: createOpenAI({ apiKey })(modelId), provider, modelId };
    case "google":
      return {
        model: createGoogleGenerativeAI({ apiKey })(modelId),
        provider,
        modelId,
      };
  }
}

/**
 * capability 'image' を画像生成モデルに解決する（SPEC-illustrator §5.3）。
 * Anthropic は画像生成モデルを提供していないため validation エラーにする
 */
export async function resolveImageModel(
  supabase: SupabaseServerClient,
): Promise<{ model: ImageModel; provider: AiProvider; modelId: string }> {
  const { provider, modelId, apiKey } = await resolveModelConfig(
    supabase,
    "image",
  );

  switch (provider) {
    case "anthropic":
      throw new AppError(
        "validation",
        "Anthropic は画像生成に対応していません。設定画面で「画像生成」のプロバイダを Google または OpenAI に変更してください",
      );
    case "openai":
      return {
        model: createOpenAI({ apiKey }).image(modelId),
        provider,
        modelId,
      };
    case "google":
      return {
        model: createGoogleGenerativeAI({ apiKey }).image(modelId),
        provider,
        modelId,
      };
  }
}
