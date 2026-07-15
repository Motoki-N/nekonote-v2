# 原稿リポジトリテンプレート（縦書きエディタ Phase 1）

SPEC-vertical-editor §3 の原稿リポジトリ構成。VS Code で VFM を書いて push し、
入稿タグを打つと GitHub Actions が入稿品質の PDF を Releases に添付する。

## 構成

```
├─ manuscripts/          … 本文（VFM形式・章ごとに1ファイル。数字プレフィックスで章順）
├─ book.config.js        … 書誌情報＋ビルド設定（文庫判A6）
├─ book.config.b6.js     … B6判ビルド設定
├─ themes/
│   ├─ theme-bunko-a6.css … 文庫判テーマ（theme-bunko派生・16行×40字）
│   ├─ theme-b6.css       … B6判テーマ（theme-bunko派生・17行×44字）
│   └─ nekonote-parts.css … 共通パーツ（扉・奥付・挿絵・傍点・縦中横・塗り足し）
├─ images/               … 挿絵（Git管理。太ったらLFS移行）
├─ scripts/
│   ├─ check-images.mjs  … 画像検査（実効解像度・カラー検出）
│   └─ check-pages.mjs   … ページ数検査（4の倍数）
└─ .github/workflows/build-pdf.yml … タグpush → 入稿PDF自動生成
```

## 記法

| 用途 | 記法 |
|---|---|
| ルビ | `{漢字|かんじ}` |
| コメント（出力に出ない） | `<!-- メモ -->` |
| 縦中横 | `<span class="tcy">10</span>年` |
| 傍点 | `<span class="tenten">ここぞ</span>` |
| 全面挿絵（裁ち落とし） | `![キャプションは刷られない](../images/x.png){.illust-full}` |
| 本文中カット | `![キャプション](../images/x.png){.illust-inline}` |
| 扉・奥付 | フロントマターで `class: titlepage` / `class: colophon` |

## ローカルビルド

```bash
npm install
npx vivliostyle build -c book.config.js       # 文庫判A6 → output/*.pdf
npx vivliostyle build -c book.config.b6.js    # B6判
node scripts/check-images.mjs                 # 画像検査
node scripts/check-pages.mjs output/ryu-no-su-a6.pdf  # ページ数検査
GS_OPTIONS=-dNOSAFER npx press-ready build --input output/ryu-no-su-a6.pdf --output output/ryu-no-su-a6-press.pdf
```

macOS でのプレビューは組版に游明朝、CI（Linux）では Noto Serif CJK JP が使われる。
書体は変わるが版面設計（行数×字数）は同一。

## 入稿

```bash
git tag v1.0-nyuko && git push origin v1.0-nyuko
```

→ Actions が PDF/X-1a 変換済みPDFを Releases に添付する。
