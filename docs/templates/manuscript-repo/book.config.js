// 書誌情報＋ビルド設定（Vivliostyle CLI 設定ファイル）
// SPEC-vertical-editor §4.2: 奥付・目次はここを情報源にテンプレート生成する
module.exports = {
  title: '竜の巣',
  author: '灰谷 汀',
  language: 'ja',
  size: '105mm,148mm', // 文庫判（A6）。B6ビルドは book.config.b6.js を使用
  theme: './themes/theme-bunko-a6.css',
  entry: [
    'manuscripts/00-tobira.md',
    { rel: 'contents' }, // 目次（自動生成）をこの位置に差し込む
    'manuscripts/01-prologue.md',
    'manuscripts/02-chapter1.md',
    'manuscripts/90-atogaki.md',
    'manuscripts/99-okuzuke.md',
  ],
  toc: {
    title: '目次',
  },
  output: ['output/ryu-no-su-a6.pdf'],
  workspaceDir: '.vivliostyle',
}
