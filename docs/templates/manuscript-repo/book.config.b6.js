// B6判ビルド設定（判型・テーマ・出力先のみ差し替え）
const base = require('./book.config.js')

module.exports = {
  ...base,
  size: '128mm,182mm',
  theme: './themes/theme-b6.css',
  output: ['output/ryu-no-su-b6.pdf'],
  workspaceDir: '.vivliostyle-b6',
}
