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

/** ギャラリーの一括削除で1回に扱える件数（Issue #332） */
export const BULK_DELETE_MAX = 50;

/** 1回の依頼に添付できる参照画像の上限（illustration_references.position の CHECK と対応。Issue #335） */
export const REFERENCE_IMAGES_MAX = 4;

// アスペクト比は縦/横/横（A4横向け）/正方形の4種（SPEC §3）。値は generateImage にそのまま渡す
export const illustrationAspectRatios = ["2:3", "16:9", "3:2", "1:1"] as const;
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

// 画風（SPEC §10・Issue #254）。ID・表示名・系統はクライアントと共用し、
// 画像モデルへ渡す英語の STYLE 文はサーバー側（lib/ai/illustration-styles.ts）に置く
export const illustrationStyles = [
  "light-novel",
  "oil-painting",
  "impasto",
  "watercolor",
  "ink-watercolor",
  "colored-pencil",
  "pencil",
  "pastel",
  "picture-book",
  "jp-childrens-book",
  "woodblock",
  "risograph",
  "retro-print",
  "cut-paper",
  "ink-brush",
  "manga",
  "editorial",
] as const;
export type IllustrationStyle = (typeof illustrationStyles)[number];

export const ILLUSTRATION_STYLE_LABEL: Record<IllustrationStyle, string> = {
  "light-novel": "ライトノベル風（アニメ塗り）",
  "oil-painting": "油彩",
  impasto: "厚塗り",
  watercolor: "水彩",
  "ink-watercolor": "水彩＋ペン",
  "colored-pencil": "色鉛筆",
  pencil: "鉛筆画",
  pastel: "パステル",
  "picture-book": "絵本",
  "jp-childrens-book": "日本の児童書挿絵風",
  woodblock: "木版画",
  risograph: "リソグラフ",
  "retro-print": "レトロ印刷",
  "cut-paper": "切り絵",
  "ink-brush": "墨・インク画",
  manga: "漫画",
  editorial: "雑誌の挿絵",
};

/** 選択欄の系統見出し（optgroup）。illustrationStyles の全IDをちょうど1回ずつ含める */
export const ILLUSTRATION_STYLE_GROUPS: {
  label: string;
  styles: IllustrationStyle[];
}[] = [
  {
    label: "装画・絵画",
    styles: ["light-novel", "oil-painting", "impasto"],
  },
  {
    label: "手描き・画材",
    styles: [
      "watercolor",
      "ink-watercolor",
      "colored-pencil",
      "pencil",
      "pastel",
    ],
  },
  { label: "絵本・児童書", styles: ["picture-book", "jp-childrens-book"] },
  {
    label: "版画・印刷",
    styles: ["woodblock", "risograph", "retro-print", "cut-paper"],
  },
  { label: "線画・漫画・雑誌", styles: ["ink-brush", "manga", "editorial"] },
];

/**
 * 保存済みの依頼内容（illustrations.request jsonb）から画風を取り出す。
 * 画風指定の追加前の行・アップロード参照画像・未知の値は null（指定なし）
 */
export function styleOfStoredRequest(
  request: unknown,
): IllustrationStyle | null {
  if (typeof request !== "object" || request === null) return null;
  const parsed = z
    .enum(illustrationStyles)
    .safeParse((request as { style?: unknown }).style);
  return parsed.success ? parsed.data : null;
}

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
    // 画風（未指定=指定なし）と「手描き感を残す」（SPEC §10）。
    // 案出しで imagePrompt 末尾へ STYLE ブロックとして付加される
    style: z.enum(illustrationStyles).optional(),
    humanMade: z.boolean().optional(),
    // 参照画像（ギャラリーの既存イラスト。編集依頼・キャラ一貫性）。
    // 配列の順に画像モデルへ添付する（SPEC §13・Issue #335）
    referenceIllustrationIds: z
      .array(z.uuid())
      .min(1)
      .max(REFERENCE_IMAGES_MAX, `参照画像は${REFERENCE_IMAGES_MAX}枚までです`)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "insert" && !value.manuscriptPath) {
      ctx.addIssue({
        code: "custom",
        message: "挿絵は対象の原稿ファイルを選択してください",
      });
    }
    const ids = value.referenceIllustrationIds ?? [];
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "同じ参照画像が重複しています",
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
      "画像生成モデルに渡すプロンプト（日本語）。被写体・構図・光・色調・雰囲気を具体的に（画風の指定がない依頼では画風も）。カラー/モノクロ指定を必ず含める",
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
  /** 依頼時の画風（指定なし・アップロード参照画像は null。参照画像の1枚目から復元する） */
  style: IllustrationStyle | null;
  createdAt: string;
  /** 短寿命の署名URL（SPEC §6） */
  signedUrl: string;
  /** このイラストを参照している他イラストの数（削除ダイアログの警告用） */
  referencedCount: number;
  /** お気に入り☆（SPEC §11） */
  isFavorite: boolean;
  /** 採用⛳: 既定ブランチの原稿に載っている（配置時・原稿走査で付与／解除。SPEC §11） */
  placedAt: string | null;
  /** 原稿リポジトリへコピーしたパス（作業ブランチへの配置でも入る。削除時の警告用） */
  placedImagePath: string | null;
};

/**
 * 原稿リポジトリへ配置するときのファイル名（SPEC §11）。UUID を入れることで、
 * 原稿の挿入記法からどのイラストかを直接たどれる（原稿走査で⛳を補正する根拠）
 */
export function atelierImageFileName(
  illustrationId: string,
  extension: string,
): string {
  return `atelier-${illustrationId}.${extension}`;
}

/**
 * 原稿本文中の配置済みイラストの参照（`images/atelier-<UUID>.<拡張子>`）。
 * 手作業のコピー等で付いた連番（`-2` 等）も同じイラストとして扱う
 */
const ATELIER_IMAGE_REFERENCE =
  /images\/atelier-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?\.(?:png|jpe?g|webp)/gi;

/** 原稿本文から配置済みイラストの id（小文字）を集める */
export function collectAtelierImageIds(content: string): Set<string> {
  const ids = new Set<string>();
  for (const match of content.matchAll(ATELIER_IMAGE_REFERENCE)) {
    ids.add(match[1].toLowerCase());
  }
  return ids;
}

export const illustrationTitleSchema = z
  .string()
  .trim()
  .min(1, "タイトルを入力してください")
  .max(100, "タイトルは100字以内で入力してください");
