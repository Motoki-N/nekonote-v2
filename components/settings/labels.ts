import type {
  AiCapability,
  AiProvider,
  PersonaType,
  ReferenceScope,
  TargetPhase,
} from "@/lib/schemas/enums";

// 設定画面の列挙値ラベル（SPEC-dashboard-critique-settings §3.4）

export const CAPABILITY_LABEL: Record<AiCapability, string> = {
  high: "高精度",
  medium: "標準",
  low: "軽量",
};

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

export const REFERENCE_SCOPE_LABEL: Record<ReferenceScope, string> = {
  all: "すべて参照",
  manuscript_only: "原稿のみ",
  chat_only: "チャットのみ",
  manuscript_plus_target: "原稿＋ターゲット情報",
};

export const PERSONA_TYPE_LABEL: Record<PersonaType, string> = {
  reviewer: "レビュアー",
  conversational: "対話型",
};

export const TARGET_PHASE_LABEL: Record<TargetPhase, string> = {
  proposal: "企画書",
  character: "キャラクター",
  structure: "構成",
  scene: "シーン",
  proofreading: "校正",
  manuscript: "講評（作品全体）",
};

// Input と同じトーンの select（shadcn select 未導入のため。project-form-dialog と同じ流儀）
export const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
