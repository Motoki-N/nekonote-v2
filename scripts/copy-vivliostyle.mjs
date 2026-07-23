// Vivliostyle Viewer と組版テーマを node_modules から public/ へコピーする（postinstall）。
// プレビューiframeが自前ホストのViewerを読み込むため（SPEC-vertical-editor-phase2 §5.1。CDN参照はしない）。
// コピー先は .gitignore 済み（node_modules 由来の生成物をコミットしない）
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'vivliostyle')

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

// Viewer 本体（index.html＋js/css/fonts/resources）
cpSync(join(root, 'node_modules', '@vivliostyle', 'viewer', 'lib'), join(dest, 'viewer'), {
  recursive: true,
})

// 組版テーマ。原稿リポジトリの判型CSSが `@import url(../node_modules/@vivliostyle/theme-bunko/theme.css)`
// を参照するため、同じ相対構造（theme-bunko / theme-techbook → ../theme-base）を保ってホストする
for (const pkg of ['theme-bunko', 'theme-techbook', 'theme-base']) {
  cpSync(join(root, 'node_modules', '@vivliostyle', pkg), join(dest, 'themes', pkg), {
    recursive: true,
    filter: (src) => !src.includes(`${pkg}/example`),
  })
}

console.log('Vivliostyle Viewer とテーマを public/vivliostyle/ へコピーしました')
