// 入稿制約の検査（SPEC-vertical-editor §4.2）
// 総ページ数が4の倍数（印刷所標準の折り）かを検査し、不足時は白ページの挿入を提案する
// 使い方: node scripts/check-pages.mjs <pdf>
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const path = process.argv[2]
if (!path) {
  console.error('使い方: node scripts/check-pages.mjs <pdf>')
  process.exit(2)
}

const doc = await PDFDocument.load(readFileSync(path), { updateMetadata: false })
const pages = doc.getPageCount()
const remainder = pages % 4

if (remainder === 0) {
  console.log(`✓ ${path}: ${pages}ページ（4の倍数・入稿可）`)
  process.exit(0)
} else {
  const shortage = 4 - remainder
  console.warn(
    `⚠ ${path}: ${pages}ページは4の倍数ではありません。` +
      `白ページを${shortage}ページ追加して${pages + shortage}ページにすることを検討してください` +
      `（奥付の前に白ページを挿入するのが一般的です）`,
  )
  process.exit(1)
}
