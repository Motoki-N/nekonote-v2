import { z } from "zod";
import {
  illustrationKinds,
  type IllustrationKind,
  type StoredIllustrationKind,
} from "./enums";
import { manuscriptFilePathSchema } from "./manuscript";

// イラスト依頼・生成のスキーマ（SPEC-illustrator §4.2・§5.3）

/** 種別の表示ラベル（依頼フォーム・ギャラリー・初期タイトルで共用） */
export const ILLUSTRATION_KIND_LABEL: Record<StoredIllustrationKind, string> = {
  cover: "表紙",
  insert: "挿絵",
  character: "キャラクター",
  concept: "コンセプトアート",
  reference: "参照用",
};

// 保存を許可する画像形式と拡張子（バケットの allowed_mime_types と対応させる。20260717000004）。
// 生成画像の保存とアップロード参照画像（Issue #104）で共用する
export const ILLUSTRATION_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** アップロード参照画像のサイズ上限（バケットの file_size_limit と対応。Issue #104） */
export const REFERENCE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

// アスペクト比は縦/横/正方形の3種（SPEC §3）。値は generateImage にそのまま渡す
export const illustrationAspectRatios = ["2:3", "16:9", "1:1"] as const;
export type IllustrationAspectRatio = (typeof illustrationAspectRatios)[number];

/** 種別ごとのアスペクト比デフォルト（SPEC §3: 表紙・挿絵・キャラ=縦、コンセプト=横） */
export const DEFAULT_ASPECT_RATIO: Record<
  IllustrationKind,
  IllustrationAspectRatio
> = {
  cover: "2:3",
  insert: "2:3",
  character: "2:3",
  concept: "16:9",
};

export const colorModes = ["color", "monochrome"] as const;
export type ColorMode = (typeof colorModes)[number];

export const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  color: "カラー",
  monochrome: "モノクロ",
};

/**
 * 依頼内容（illustrations.request jsonb に保存する形。SPEC §4.2）。
 * 挿絵は対象原稿ファイルの選択が必須（superRefine）
 */
export const illustrationRequestSchema = z
  .object({
    projectId: z.uuid(),
    kind: z.enum(illustrationKinds),
    colorMode: z.enum(colorModes),
    aspectRatio: z.enum(illustrationAspectRatios),
    // 描いてほしい対象・構図・雰囲気（自由記述）
    instructions: z
      .string()
      .trim()
      .min(1, "描いてほしい内容を入力してください")
      .max(2000),
    // 挿絵のみ: 対象の原稿ファイルパスと場面の補足。
    // トラバーサル（..）・絶対パス・原稿以外の拡張子は既存共通スキーマで拒否する
    // （.. はGitHub APIのURL正規化で base_path チェックを迂回できるため必須の防御）
    manuscriptPath: manuscriptFilePathSchema.optional(),
    sceneNote: z.string().trim().max(1000).optional(),
    // 参照画像（ギャラリーの既存イラスト。編集依頼・キャラ一貫性）
    referenceIllustrationId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "insert" && !value.manuscriptPath) {
      ctx.addIssue({
        code: "custom",
        message: "挿絵は対象の原稿ファイルを選択してください",
      });
    }
  });

export type IllustrationRequest = z.infer<typeof illustrationRequestSchema>;

/** POST /api/illustration/propose のリクエスト */
export const proposeRequestSchema = z.object({
  request: illustrationRequestSchema,
});

/** イラスト案（第1段階の出力。DBには保存しない——採用されて画像になった案だけが残る） */
export const illustrationProposalSchema = z.object({
  title: z.string().describe("案の短いタイトル（15字以内）"),
  description: z
    .string()
    .describe("狙いの説明。何をどう描き、なぜこの作品に合うのか（100〜200字）"),
  imagePrompt: z
    .string()
    .describe(
      "画像生成モデルに渡すプロンプト（日本語）。被写体・構図・光・色調・画風・雰囲気を具体的に。カラー/モノクロ指定を必ず含める",
    ),
});

export type IllustrationProposal = z.infer<typeof illustrationProposalSchema>;

/** 案出しの構造化出力（2〜3案。SPEC §2） */
export const proposeOutputSchema = z.object({
  proposals: z.array(illustrationProposalSchema).min(2).max(3),
});

/** POST /api/illustration/generate のリクエスト（採用案の微調整後プロンプト付き） */
export const generateRequestSchema = z.object({
  request: illustrationRequestSchema,
  prompt: z.string().trim().min(1, "プロンプトを入力してください").max(4000),
});

/** ギャラリー・生成結果でクライアントに返すイラスト情報 */
export type IllustrationItem = {
  id: string;
  projectId: string;
  kind: StoredIllustrationKind;
  title: string;
  prompt: string;
  referenceIllustrationId: string | null;
  createdAt: string;
  /** 短寿命の署名URL（SPEC §6） */
  signedUrl: string;
  /** このイラストを参照している他イラストの数（削除ダイアログの警告用） */
  referencedCount: number;
};

export const illustrationTitleSchema = z
  .string()
  .trim()
  .min(1, "タイトルを入力してください")
  .max(100, "タイトルは100字以内で入力してください");
