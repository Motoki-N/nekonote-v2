// 奥付章ファイルの読み書き（SPEC-vertical-editor-phase3 §7-4）。
// 奥付はテンプレート構造（フロントマター class: colophon＋<dl> 項目＋発行日行）の
// 章ファイルであり、検出できた場合のみフォーム化する。検出できなければ
// 章として直接編集してもらう（フェイルソフト）

/** フォーム対象の <dl> 項目ラベル（テンプレート `99-okuzuke.md` の規約） */
export const OKUZUKE_LABELS = ['著者', '発行', '連絡先', '印刷'] as const
export type OkuzukeLabel = (typeof OKUZUKE_LABELS)[number]

export type OkuzukeData = {
  /** 発行日行の日付部分（例: 二〇二六年八月一一日）。行が見つからなければ null */
  dateText: string | null
  /** 検出できた <dl> 項目（テンプレートにあるものだけ） */
  fields: { label: OkuzukeLabel; value: string }[]
}

/** 奥付テンプレート構造かどうか（フロントマターの class: colophon で判定） */
export function isOkuzukeFile(markdown: string): boolean {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return frontmatter !== null && /^class:\s*['"]?colophon['"]?\s*$/m.test(frontmatter[1])
}

const DATE_LINE = /^(.+)　初版発行\s*$/m

/** 奥付の編集可能フィールドを抽出する。<dl> 項目がひとつもなければ null（フォーム化しない） */
export function parseOkuzuke(markdown: string): OkuzukeData | null {
  if (!isOkuzukeFile(markdown)) return null
  const fields: OkuzukeData['fields'] = []
  for (const label of OKUZUKE_LABELS) {
    const match = markdown.match(fieldRegex(label))
    if (match) fields.push({ label, value: match[1] })
  }
  if (fields.length === 0) return null
  const date = markdown.match(DATE_LINE)
  return { dateText: date ? date[1] : null, fields }
}

function fieldRegex(label: OkuzukeLabel): RegExp {
  return new RegExp(`<dt>${label}</dt><dd>([^<\\n]*)</dd>`)
}

/**
 * 奥付のフィールド値を置換する。HTMLへ埋め込むため値にタグ・改行は使えない
 * （不正値・対象行の欠落は null＝フェイルソフト）
 */
export function replaceOkuzuke(
  markdown: string,
  params: { dateText: string | null; fields: { label: OkuzukeLabel; value: string }[] },
): string | null {
  let result = markdown
  for (const { label, value } of params.fields) {
    if (/[<>&\n]/.test(value)) return null
    const regex = fieldRegex(label)
    if (!regex.test(result)) return null
    result = result.replace(regex, `<dt>${label}</dt><dd>${value}</dd>`)
  }
  if (params.dateText !== null) {
    if (/[<>&\n]/.test(params.dateText)) return null
    if (!DATE_LINE.test(result)) return null
    result = result.replace(DATE_LINE, `${params.dateText}　初版発行`)
  }
  return result
}
