import { z } from "zod";

// Zenn記事の入力検証（SPEC-zenn-integration §5）

// slug（ファイル名）。Zenn仕様: 半角英小文字・数字・ハイフン・アンダースコアの12〜50字。
// [a-z0-9_-] のみ＝パストラバーサル不能（articles/<slug>.md の合成はサーバー側で行う）
export const zennSlugSchema = z
  .string()
  .regex(
    /^[a-z0-9_-]{12,50}$/,
    "slugは半角英小文字・数字・ハイフン・アンダースコアの12〜50字で入力してください",
  );

// frontmatter は JSON.stringify で安全に合成されるが、タイトル等に改行・制御文字が
// 入る実需はなく、入口で落とすほうが分かりやすい（Server Action直呼びが境界）
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const zennArticleInputSchema = z.object({
  slug: zennSlugSchema,
  title: z
    .string()
    .trim()
    .min(1, "タイトルを入力してください")
    .max(100, "タイトルは100文字以内で入力してください")
    .refine(
      (v) => !CONTROL_CHARS.test(v),
      "タイトルに改行・制御文字は使えません",
    ),
  // ZWJ合成絵文字（家族の絵文字等）はUTF-16で10単位を超えるため上限は緩めに取る。
  // 厳密な絵文字判定はせずZenn側の検証に委ねる（SPEC §5）
  emoji: z
    .string()
    .trim()
    .min(1, "アイキャッチ絵文字を入力してください")
    .max(16, "アイキャッチは絵文字1文字で入力してください")
    .refine(
      (v) => !/\s/.test(v) && !CONTROL_CHARS.test(v),
      "絵文字に空白・改行は使えません",
    ),
  type: z.enum(["tech", "idea"]),
  topics: z
    .array(
      z
        .string()
        .trim()
        .min(1, "トピックを入力してください")
        .max(50, "トピックは50文字以内で入力してください")
        .refine(
          (v) => !CONTROL_CHARS.test(v),
          "トピックに改行・制御文字は使えません",
        ),
    )
    .max(5, "トピックは5つまでです")
    .transform((topics) => Array.from(new Set(topics))),
  published: z.boolean(),
  // GitHub Contents API の1MB制限（UTF-8バイト）に余裕を持たせた文字数上限
  body: z.string().max(200_000, "本文が大きすぎます（上限20万字）"),
});

export type ZennArticleInput = z.input<typeof zennArticleInputSchema>;
export type ZennArticle = z.output<typeof zennArticleInputSchema>;

// ---- 画像アップロード（SPEC-zenn-integration §11） ----

// Zennの画像仕様: 1枚3MB以内・png/jpg/jpeg/webp/gif のみ
export const ZENN_MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// ファイル名: 英数字始まり・英数と ._- のみ・.. 拒否・拡張子allowlist
// （縦書きエディタの imageFileNameSchema と同形。パス合成はサーバー側で行う）
export const zennImageFileNameSchema = z
  .string()
  .regex(/^(?!.*\.\.)[0-9A-Za-z][0-9A-Za-z._-]{0,80}\.(png|jpe?g|webp|gif)$/, {
    error:
      "画像ファイル名が不正です（英数字始まり・png/jpg/jpeg/webp/gif のみ）",
  });

export const zennImageBase64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: "画像データが不正です" })
  // 長さが4の倍数でない不正base64はGitHub側の422（conflictに正規化される）まで
  // 到達させず入口で弾く（security-reviewer L-1）
  .refine((v) => v.length % 4 === 0, { error: "画像データが不正です" })
  // base64は元サイズの約4/3。デコード前に長さで粗く弾く（正確な検査はデコード後）
  .max(Math.ceil((ZENN_MAX_IMAGE_BYTES / 3) * 4) + 8, {
    error: "画像が大きすぎます（Zennの上限3MB）",
  });
