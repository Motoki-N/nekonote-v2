// 画像アップロードのクライアント側ユーティリティ（SPEC-vertical-editor-phase3 §6）。
// ファイル名はサーバーの imageFileNameSchema（英数字始まり・英数と ._- のみ・拡張子allowlist）
// を通る形へ正規化する。日本語名などは全部落ちるため、空になったら日時ベースの名前にする

export function sanitizeImageFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const rawStem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const stem = rawStem
    .normalize('NFKC')
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60)
  const fallback = `img-${new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)}`
  const safeStem = /^[0-9A-Za-z]/.test(stem) ? stem : fallback
  return `${safeStem}.${ext}`
}

/** File を base64 文字列（data: プレフィックスなし）へ変換する */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('画像の読み込みに失敗しました'))
        return
      }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    reader.readAsDataURL(file)
  })
}

/** 挿入記法（親SPEC §4.6 の挿絵テンプレート。キャプションは記法を壊す文字を除去） */
export function illustNotation(
  fileName: string,
  kind: 'inline' | 'full',
  caption: string,
): string {
  const safeCaption = caption.replace(/[[\]()\n]/g, '')
  return `![${safeCaption}](../images/${fileName}){.illust-${kind === 'full' ? 'full' : 'inline'}}`
}
