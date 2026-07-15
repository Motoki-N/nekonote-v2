// ビルド時の画像検査（SPEC-vertical-editor §4.6）
// - 原稿(manuscripts/*.md)が参照する画像を収集し、用途クラスから必要解像度を判定
//   - 全面挿絵(.illust-full): 仕上がり+塗り足しに対して 350dpi 未満で警告（目安: グレースケール350dpi）
//   - 本文中カット(.illust-inline): 最大45mm角に対して 350dpi 未満で警告
// - カラー画像（PNG colorType 2/6、JPEG非グレースケール）を検出して警告（本文はモノクロ印刷前提）
// 終了コード: 警告あり=1（Actionsで警告を可視化。エラー扱いにするかは運用で決める）
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 判型（book.config.js の size と揃える。塗り足し3mm×2を加算）
const TRIM = { width: 105, height: 148 } // mm
const BLEED = 3 // mm
const INLINE_MAX = 45 // mm（本文中カットの最大辺）
const DPI_MIN = 350 // グレースケール印刷の目安

function pngMeta(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  // IHDR は先頭チャンク固定: 8(シグネチャ)+8(長さ+型)からの13バイト
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25], // 0/4=グレースケール, 2/6=RGB, 3=パレット
  }
}

function jpegMeta(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let off = 2
  while (off < buf.length - 8) {
    if (buf[off] !== 0xff) break
    const marker = buf[off + 1]
    const len = buf.readUInt16BE(off + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: buf.readUInt16BE(off + 5),
        width: buf.readUInt16BE(off + 7),
        colorType: buf[off + 9] === 1 ? 0 : 2, // 成分数1=グレースケール
      }
    }
    off += 2 + len
  }
  return null
}

// 原稿から画像参照と用途クラスを収集
const usage = new Map() // 画像絶対パス → 'full' | 'inline'
const manuscriptsDir = join(root, 'manuscripts')
for (const file of readdirSync(manuscriptsDir).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(join(manuscriptsDir, file), 'utf8')
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)(\{[^}]*\})?/g)) {
    const attrs = m[2] ?? ''
    const kind = attrs.includes('illust-full') ? 'full' : 'inline'
    usage.set(resolve(manuscriptsDir, m[1]), kind)
  }
}

let warnings = 0
for (const [path, kind] of usage) {
  let buf
  try {
    buf = readFileSync(path)
  } catch {
    console.error(`✗ ${basename(path)}: ファイルが見つかりません`)
    warnings++
    continue
  }
  const meta = pngMeta(buf) ?? jpegMeta(buf)
  if (!meta) {
    console.error(`✗ ${basename(path)}: PNG/JPEG として解釈できません`)
    warnings++
    continue
  }
  // 実効dpi = 画素数 ÷ 印刷寸法(inch)
  const targetMm =
    kind === 'full'
      ? { w: TRIM.width + BLEED * 2, h: TRIM.height + BLEED * 2 }
      : { w: INLINE_MAX, h: INLINE_MAX }
  const dpiW = meta.width / (targetMm.w / 25.4)
  const dpiH = meta.height / (targetMm.h / 25.4)
  const dpi = Math.min(dpiW, dpiH)
  const label = kind === 'full' ? '全面挿絵' : '本文中カット'
  const issues = []
  if (dpi < DPI_MIN) {
    issues.push(`実効解像度不足: ${Math.round(dpi)}dpi < ${DPI_MIN}dpi（${meta.width}×${meta.height}px を ${targetMm.w}×${targetMm.h}mm で使用）`)
  }
  if (meta.colorType === 2 || meta.colorType === 6) {
    issues.push('カラー画像です（本文はモノクロ印刷前提。グレースケール化を推奨）')
  }
  if (issues.length) {
    for (const issue of issues) console.warn(`⚠ ${basename(path)} [${label}]: ${issue}`)
    warnings += issues.length
  } else {
    console.log(`✓ ${basename(path)} [${label}]: ${meta.width}×${meta.height}px ≒ ${Math.round(dpi)}dpi, ${meta.colorType === 0 || meta.colorType === 4 ? 'グレースケール' : 'colorType=' + meta.colorType}`)
  }
}

if (usage.size === 0) console.log('画像参照なし（検査スキップ）')
process.exit(warnings > 0 ? 1 : 0)
