// 検証用PNGの生成（外部依存なし・zlibのみの最小PNGエンコーダ）
// - sashie-01.png: 全面挿絵用（グレースケール・A6+塗り足し3mm を600dpiで =2622×3638px）
// - sashie-02.png: 本文中カット用（グレースケール・十分な解像度）
// - sashie-03-bad.png: 検査テスト用（カラー・低解像度）
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
// colorType 0=grayscale, 2=RGB
function png(width, height, colorType, pixelFn) {
  const bpp = colorType === 2 ? 3 : 1
  const raw = Buffer.alloc(height * (1 + width * bpp))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * bpp)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const px = pixelFn(x, y)
      if (colorType === 2) {
        raw[row + 1 + x * 3] = px[0]
        raw[row + 2 + x * 3] = px[1]
        raw[row + 3 + x * 3] = px[2]
      } else {
        raw[row + 1 + x] = px
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = colorType
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(join(root, 'images'), { recursive: true })

// 全面挿絵: A6(105×148)+塗り足し6mm = 111×154mm @600dpi = 2622×3638px
// 縦グラデーション＋斜めの帯（塗り足し確認用に四辺まで絵柄を伸ばす）
{
  const w = 2622, h = 3638
  const buf = png(w, h, 0, (x, y) => {
    const grad = Math.round((y / h) * 200) + 30
    const band = Math.abs(((x + y) % 600) - 300) < 40 ? 255 : grad
    return band
  })
  writeFileSync(join(root, 'images/sashie-01.png'), buf)
  console.log(`sashie-01.png: ${w}x${h} grayscale (${(buf.length / 1024 / 1024).toFixed(1)}MB)`)
}

// 本文中カット: 版面内 45×45mm 想定 @350dpi ≒ 620×620px → 800pxで余裕を持たせる
{
  const w = 800, h = 800
  const buf = png(w, h, 0, (x, y) => {
    const cx = x - w / 2, cy = y - h / 2
    const r = Math.sqrt(cx * cx + cy * cy)
    return r % 80 < 40 ? 240 : 60 // 同心円
  })
  writeFileSync(join(root, 'images/sashie-02.png'), buf)
  console.log('sashie-02.png: 800x800 grayscale')
}

// 検査NG用: カラー・低解像度（全面挿絵に使うには全く足りない 300×420px）
{
  const w = 300, h = 420
  const buf = png(w, h, 2, (x, y) => [
    Math.round((x / w) * 255),
    Math.round((y / h) * 255),
    128,
  ])
  writeFileSync(join(root, 'images/sashie-03-bad.png'), buf)
  console.log('sashie-03-bad.png: 300x420 RGB (検査NG用)')
}
