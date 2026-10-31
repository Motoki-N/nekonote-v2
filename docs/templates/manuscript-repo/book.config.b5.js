// B5判ビルド設定（判型・テーマ・出力先のみ差し替え。横書き・技術書の第2判型）
const base = require('./book.config.js')

module.exports = {
  ...base,
  size: '182mm,257mm',
  theme: './themes/theme-techbook-b5.css',
  output: ['output/ryu-no-su-b5.pdf'],
  workspaceDir: '.vivliostyle-b5',
}
