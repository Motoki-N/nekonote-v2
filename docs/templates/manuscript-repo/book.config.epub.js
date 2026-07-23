// EPUB（電子書籍）ビルド設定（Issue #119）
// 書誌情報・章構成は book.config.js（文庫判）と揃えて手動同期する
module.exports = {
  title: '竜の巣',
  author: '灰谷 汀',
  language: 'ja',
  // リフロー型のため判型（size）は指定しない。テーマも印刷用と独立（トンボ・塗り足しなし）
  theme: './themes/theme-epub.css',
  // 縦書きのページ送り（右→左）。CLIはCSSの writing-mode から自動検出しないため必須
  readingProgression: 'rtl',
  entry: [
    'manuscripts/00-tobira.md',
    { rel: 'contents' }, // 目次（EPUBではナビゲーションにも使われる）をこの位置に差し込む
    'manuscripts/01-prologue.md',
    'manuscripts/02-chapter1.md',
    'manuscripts/90-atogaki.md',
    'manuscripts/99-okuzuke.md',
  ],
  toc: {
    title: '目次',
  },
  output: [{ path: 'output/ryu-no-su.epub', format: 'epub' }],
  // PDFビルド（.vivliostyle）と作業ディレクトリを分けて相互干渉を避ける
  workspaceDir: '.vivliostyle-epub',
}
