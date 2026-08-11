import { AppError } from "@/lib/errors";
import type { TargetPhase } from "@/lib/schemas/enums";
import type { createClient } from "@/lib/supabase/server";

// クライアント指定の profileId / personaId をサーバー側で再検証する共有ヘルパー
// （SPEC-dashboard-critique-settings §5。レビュー・講評のセッション作成アクションが共用する）

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ResolvedProfile = {
  id: string;
  defaultPersonaId: string | null;
};

/** プロファイルの存在（RLS越し＝標準か自分の行）と対象フェーズの一致を検証する */
export async function resolveProfileForPhase(
  supabase: Supabase,
  profileId: string,
  phase: TargetPhase,
): Promise<ResolvedProfile> {
  const { data, error } = await supabase
    .from("review_profiles")
    .select("id, target_phase, default_persona_id")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!data)
    throw new AppError("not_found", "レビュープロファイルが見つかりません");
  if (data.target_phase !== phase) {
    throw new AppError(
      "validation",
      "このレビュー対象では使えないプロファイルです",
    );
  }
  return { id: data.id, defaultPersonaId: data.default_persona_id };
}

/** ペルソナの存在（RLS越し）と reviewer 型を検証する */
export async function resolveReviewerPersona(
  supabase: Supabase,
  personaId: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("personas")
    .select("id, persona_type")
    .eq("id", personaId)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!data) throw new AppError("not_found", "ペルソナが見つかりません");
  if (data.persona_type !== "reviewer") {
    throw new AppError(
      "validation",
      "レビューに起用できるのはレビュアー型のペルソナのみです",
    );
  }
  return { id: data.id };
}
