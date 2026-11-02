// プレビューの表示設定（Issue #370・SPEC-vertical-editor-phase2 §5.4）。
// トンボ・見開き・先頭ページ・回転を、全プロジェクト共通で localStorage に保持する。
// このモジュールはクライアントで実行される純関数のみを置く

/** 回転角（右回り。ボタンを押すたびに 0 → 90 → 270 → 0 と巡回する） */
export type PreviewRotation = 0 | 90 | 270;

export type PreviewDisplaySettings = {
  /** トンボ（と塗り足し）を表示する */
  marks: boolean;
  /** 見開きで表示する */
  spread: boolean;
  /** 見開き時、先頭ページから見開きにする（false は先頭ページを単独で表示） */
  spreadFromFirst: boolean;
  rotation: PreviewRotation;
};

export const DEFAULT_PREVIEW_DISPLAY: PreviewDisplaySettings = {
  marks: true,
  spread: false,
  spreadFromFirst: false,
  rotation: 0,
};

export const PREVIEW_DISPLAY_STORAGE_KEY = "nekonote-preview-display";

export function nextRotation(rotation: PreviewRotation): PreviewRotation {
  return rotation === 0 ? 90 : rotation === 90 ? 270 : 0;
}

/** 保存値を読む（形式不正・欠けた項目は既定値で補う） */
export function parsePreviewDisplay(
  raw: string | null,
): PreviewDisplaySettings {
  if (!raw) return DEFAULT_PREVIEW_DISPLAY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null)
      return DEFAULT_PREVIEW_DISPLAY;
    const record = value as Record<string, unknown>;
    const flag = (key: keyof PreviewDisplaySettings) =>
      typeof record[key] === "boolean"
        ? (record[key] as boolean)
        : (DEFAULT_PREVIEW_DISPLAY[key] as boolean);
    return {
      marks: flag("marks"),
      spread: flag("spread"),
      spreadFromFirst: flag("spreadFromFirst"),
      rotation:
        record.rotation === 90 || record.rotation === 270 ? record.rotation : 0,
    };
  } catch {
    return DEFAULT_PREVIEW_DISPLAY;
  }
}

/**
 * 表示設定を組版HTMLへ反映する（`</head>` の直前に上書きCSSを足す）。
 * - トンボ非表示: 電子版PDFビルドと同じ変数の上書き（SPEC-ebook-pdf）。
 *   原稿リポのCSSが `--vs-page--marks` / `--vs-page--bleed` を使っている場合だけ効く
 * - 先頭から見開き: ルート要素の `break-before: verso` で先頭ページを見開きの左右逆側に置く。
 *   Vivliostyle は空白ページを足さずに配置だけ変えるため、総ページ数・ノンブルは変わらない
 */
export function applyPreviewDisplay(
  html: string,
  settings: PreviewDisplaySettings,
): string {
  const rules: string[] = [];
  if (!settings.marks)
    rules.push(":root{--vs-page--marks:none;--vs-page--bleed:0mm}");
  if (settings.spread && settings.spreadFromFirst)
    rules.push(":root{break-before:verso}");
  if (rules.length === 0) return html;
  const index = html.indexOf("</head>");
  if (index === -1) return html;
  return `${html.slice(0, index)}<style>${rules.join("")}</style>\n${html.slice(index)}`;
}
