import type { ColorMode, IllustrationStyle } from "@/lib/schemas/illustration";

// 画風ごとに画像モデルへ渡す英語の STYLE 文（SPEC-illustrator §10・Issue #254）。
// 案出し（propose）で各 imagePrompt の末尾へ機械的に付加する。
// 文面は自前の書き起こし（外部記事の文面は転載しない。本リポジトリは public）

const STYLE_PROMPT: Record<IllustrationStyle, string> = {
  "light-novel":
    "Japanese light novel cover art style: clean anime-style character linework, cel shading with soft gradient highlights, expressive eyes, vivid but harmonious colors, polished yet painterly background, dramatic lighting that frames the characters.",
  "oil-painting":
    "Traditional oil painting: visible brushstrokes, rich layered pigments, soft blended transitions, canvas texture, classical lighting with deep shadows and warm highlights, painterly rather than photographic detail.",
  impasto:
    "Digital impasto painting: thick confident strokes, sculpted texture, bold value contrast, simplified forms built from large paint masses, atmospheric light, painterly edges instead of clean outlines.",
  watercolor:
    "Transparent watercolor painting: soft washes that bleed into one another, uneven pigment pooling at the edges, white paper left visible in places, gentle granulation on textured cold-press paper, loose and airy brushwork.",
  "ink-watercolor":
    "Pen-and-ink drawing with watercolor washes: loose hand-inked outlines of varying weight, translucent color laid over the linework, color that slightly misses the lines, textured watercolor paper.",
  "colored-pencil":
    "Colored pencil drawing on toothy paper: layered hatching, visible strokes and paper grain showing through, soft blended edges, gentle and slightly muted palette.",
  pencil:
    "Graphite pencil drawing: varied line pressure, soft tonal shading built from hatching and smudging, visible paper grain, sketchbook feel with some construction lines left in.",
  pastel:
    "Soft pastel artwork: chalky powdery texture, colors blended with the fingers, broken edges, visible paper tooth, warm diffused light.",
  "picture-book":
    "Warm picture book illustration: rounded friendly shapes, gently wobbly outlines, soft textured coloring, cozy storytelling composition, restrained detail.",
  "jp-childrens-book":
    "Japanese children's book illustration: gentle slightly irregular linework, simple and kind facial features, soft muted colors, light shading, calm everyday atmosphere, subtle paper texture.",
  woodblock:
    "Woodblock print style: carved outlines with chisel marks, flat areas of color, flattened perspective, slightly uneven ink transfer, visible paper fibers, limited traditional palette.",
  risograph:
    "Risograph print style: two to four spot ink colors, grainy texture, slight misregistration between color layers, bold simplified shapes, uneven ink density on uncoated paper.",
  "retro-print":
    "Mid-century printed illustration: limited ink palette, halftone dots, slightly faded colors, imperfect registration, rough paper, simple graphic shapes.",
  "cut-paper":
    "Cut paper artwork: layered hand-cut colored paper shapes, slightly irregular cut edges, soft drop shadows between layers, visible paper fibers, flat colors.",
  "ink-brush":
    "Ink brush painting: expressive brush pressure, dry-brush streaks, bold blacks against generous empty space, ink washes for tone, spontaneous strokes.",
  manga:
    "Hand-drawn manga illustration: crisp black ink linework with tapered strokes, screentone shading, speed lines or simple backgrounds where useful, dynamic composition.",
  editorial:
    "Contemporary editorial magazine illustration: conceptual simplified forms, limited sophisticated palette, bold negative space, subtle print texture, intelligent visual metaphor.",
};

/** 「手描き感を残す」（SPEC §10）。手描きの揺らぎを残す指示＋ツルツルしたAIイラストを避ける指示 */
const HUMAN_MADE_PROMPT = [
  "Hand-made feel: keep small human imperfections such as uneven line pressure, slightly irregular curves and subtle asymmetry; keep details restrained and shapes naturally varied.",
  "Avoid: glossy plastic-like surfaces, overly smooth vector curves, heavy rim lighting, airbrushed gradients, perfectly symmetrical faces, cluttered decorative details, and generic stock-illustration polish.",
].join("\n");

/** カラー/モノクロ指定を画風より優先させる締めの一文（SPEC §10: 組み合わせは制限しない） */
const COLOR_MODE_PROMPT: Record<ColorMode, string> = {
  color: "Render in full color.",
  monochrome:
    "Render in monochrome (black and white / grayscale) only, overriding any color cues above.",
};

/**
 * imagePrompt の末尾へ付ける STYLE ブロック。画風「指定なし」かつ手描き感オフなら空文字
 * （何も付けない＝従来どおり LLM が画風まで書く）
 */
export function buildStyleSuffix({
  style,
  humanMade,
  colorMode,
}: {
  style: IllustrationStyle | undefined;
  humanMade: boolean;
  colorMode: ColorMode;
}): string {
  if (!style && !humanMade) return "";
  const lines: string[] = [];
  if (style) lines.push(`STYLE: ${STYLE_PROMPT[style]}`);
  if (humanMade) lines.push(HUMAN_MADE_PROMPT);
  lines.push(COLOR_MODE_PROMPT[colorMode]);
  return `\n\n${lines.join("\n")}`;
}
