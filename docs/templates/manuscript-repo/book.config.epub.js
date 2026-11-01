// EPUB（電子書籍）ビルド設定（Issue #119）
// 書誌情報・章構成（entry）・目次は book.config.js をそのまま引き継ぐ（第2判型の設定と同じ作り）。
// ネコノテAIが章を追加・並べ替えるのは book.config.js だけなので、ここに entry を書くと EPUB だけ古くなる
const base = require('./book.config.js')

module.exports = {
  ...base,
  // リフロー型のため判型（size）はEPUBの出力に影響しない。テーマは印刷用と独立（トンボ・塗り足しなし）
  theme: './themes/theme-epub.css',
  // 縦書きのページ送り（右→左）。CLIはCSSの writing-mode から自動検出しないため必須
  readingProgression: 'rtl',
  output: [{ path: 'output/ryu-no-su.epub', format: 'epub' }],
  // PDFビルド（.vivliostyle）と作業ディレクトリを分けて相互干渉を避ける
  workspaceDir: '.vivliostyle-epub',
}
