// エディタ添付（Issue #35）の共通定義。
// バケット 'attachments' の allowed_mime_types / file_size_limit と同値に保つ

/** 添付を許可する MIME と保存時拡張子の対応（それ以外は拒否） */
export const ATTACHMENT_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
}

/** 画像としてエディタに埋め込む MIME（それ以外はリンクとして挿入する） */
export const ATTACHMENT_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/**
 * 配信APIのファイル名（{uuid}.{拡張子}）の検証。
 * 拡張子は ATTACHMENT_EXTENSION_BY_MIME の値と同じ集合に限定する
 */
export const ATTACHMENT_FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif|pdf|txt)$/

/** 保存ファイル名から配信URLを組み立てる（Markdown本文に保存する安定URL） */
export function attachmentUrl(fileName: string): string {
  return `/api/attachments/${fileName}`
}
