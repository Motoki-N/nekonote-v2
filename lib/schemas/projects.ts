import { z } from "zod";
import {
  EMOTION_MAX,
  EMOTION_MIN,
  projectStatuses,
  proposalStatuses,
  sceneAnchors,
  scenePartsAll,
  writingGenres,
} from "./enums";
import { manuscriptFilePathSchema } from "./manuscript";

// 原稿リポジトリ（owner/repo 形式）の検証。
// owner は GitHub 実仕様（英数字とハイフン）。repo 名は . / .. 単体を拒否（URL正規化による別エンドポイント到達の防止）。
// 入力時（projectInputSchema）と使用時（lib/git/github.ts のDB由来値の再検証）で共用する
export const repoSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/,
    "リポジトリは owner/repo の形式で入力してください",
  );

export const projectInputSchema = z.object({
  title: z
    .string()
    .min(1, "タイトルを入力してください")
    .max(500, "タイトルが長すぎます"),
  status: z.enum(projectStatuses).default("planning"),
  target_pages: z.number().int().positive().nullish(),
  deadline: z.iso.date().nullish(),
  event_name: z.string().max(200, "イベント名が長すぎます").nullish(),
  // 原稿リポジトリと配下の原稿フォルダ（空=ルート。SPEC-proofreading §4）
  repo: repoSchema.nullish(),
  base_path: z
    .string()
    .max(300)
    .regex(
      /^(?!\/)(?!.*\.\.)[^\s]*[^\s/]$|^$/,
      "原稿フォルダは先頭・末尾の / なしで入力してください",
    )
    .nullish(),
});
export const projectUpdateSchema = projectInputSchema.partial();

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

// 原稿リポジトリ初期セットアップの入力（SPEC-repo-setup §3.2）。
// タイトル・著者名は book.config.js 等のシングルクォート文字列リテラルへ
// 文字列置換で埋め込まれるため、リテラルを壊す引用符・バックスラッシュ・
// 改行等の制御文字を拒否する（UIのInputは単一行だが、Server Action直呼びが境界）
const templateTextSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label}を入力してください`)
    .max(100, `${label}は100文字以内で入力してください`)
    .regex(
      /^[^'"`\\\u0000-\u001f\u007f]+$/,
      `${label}に引用符（' \" \`）・バックスラッシュ・改行は使えません`,
    );

export const repoSetupInputSchema = z.object({
  title: templateTextSchema("作品タイトル"),
  author: templateTextSchema("著者名"),
  slug: z
    .string()
    .trim()
    .max(50, "出力ファイル名は50文字以内で入力してください")
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "出力ファイル名は小文字英数字とハイフンで入力してください（例: ryu-no-su）",
    ),
});
export type RepoSetupInput = z.infer<typeof repoSetupInputSchema>;

export const proposalInputSchema = z.object({
  project_id: z.uuid(),
  writing_genre: z.enum(writingGenres).default("novel"), // 執筆ジャンル（SPEC-genre）
  purpose: z.string().max(2_000, "執筆目的が長すぎます").nullish(), // 執筆目的（自由記述）
  genre: z.string().max(500, "内容ジャンルが長すぎます").nullish(), // 内容ジャンル（自由記述）
  target_audience: z.string().max(500, "想定読者が長すぎます").nullish(),
  // Markdown（初期本文は執筆ジャンル別テンプレ）。上限はノート本文と同じ10万字
  // （自動保存＋proposal_versions のスナップショットで増幅されるため無上限にしない）
  content: z
    .string()
    .max(100_000, "企画書が長すぎます（上限10万字）")
    .default(""),
  status: z.enum(proposalStatuses).default("draft"),
});
// status は承認ゲートの検証を通る経路（/api/review の onFinish・approveProposal）でのみ遷移させる
export const proposalUpdateSchema = proposalInputSchema
  .partial()
  .omit({ project_id: true, status: true });

export type ProposalInput = z.infer<typeof proposalInputSchema>;
export type ProposalUpdate = z.infer<typeof proposalUpdateSchema>;

export const proposalNoteInputSchema = z.object({
  proposal_id: z.uuid(),
  note_id: z.uuid(),
});

export type ProposalNoteInput = z.infer<typeof proposalNoteInputSchema>;

// 感情の変化量（-9〜+9の整数。0=変化なし。Issue #205）
const emotionDeltaSchema = z.number().int().min(EMOTION_MIN).max(EMOTION_MAX);

export const sceneInputSchema = z.object({
  project_id: z.uuid(),
  part: z.enum(scenePartsAll),
  anchor: z.enum(sceneAnchors).nullish(),
  order_index: z.number().int().min(0).default(0),
  title: z.string().default(""),
  content: z.string().default(""),
  emotion_delta: emotionDeltaSchema.nullish(),
});
export const sceneUpdateSchema = sceneInputSchema
  .partial()
  .omit({ project_id: true });

export type SceneInput = z.infer<typeof sceneInputSchema>;
export type SceneUpdate = z.infer<typeof sceneUpdateSchema>;

// シーン編集ダイアログの保存ペイロード（並び順はD&D＝reorderScenes の領分）
export const sceneEditSchema = z.object({
  title: z.string().max(200),
  content: z.string().max(20000),
  part: z.enum(scenePartsAll),
  anchor: z.enum(sceneAnchors).nullable(),
  emotion_delta: emotionDeltaSchema.nullable(),
  // 紐づく原稿ファイル（Issue #56）。形式検証のみ（開く際のbase_path検証はエディタ側が行う）
  manuscript_path: manuscriptFilePathSchema.nullable(),
});
export type SceneEdit = z.infer<typeof sceneEditSchema>;

// D&D確定時の全シーン最終順序（レーン=part はドロップ先で確定する）
export const sceneOrderSchema = z
  .array(z.object({ id: z.uuid(), part: z.enum(scenePartsAll) }))
  .max(500);
export type SceneOrder = z.infer<typeof sceneOrderSchema>;
