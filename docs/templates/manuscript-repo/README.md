# 原稿リポジトリテンプレート（縦書きエディタ Phase 1）

SPEC-vertical-editor §3 の原稿リポジトリ構成。VS Code で VFM を書いて push し、
入稿タグを打つと GitHub Actions が入稿品質の PDF を Releases に添付する。

> **テンプレート編集時の注意**: アプリ内の初期セットアップ（SPEC-repo-setup）は、
> サンプル値 `竜の巣`（タイトル）・`灰谷 汀`（著者名）・`ryu-no-su`（出力ファイル名）を
> 目印に文字列置換で作品情報を埋め込む。テンプレートを変更するときはこの3つの表記を
> 維持すること（別の値に変えると置換が効かなくなる）。

## 構成

```
├─ manuscripts/          … 本文（VFM形式・章ごとに1ファイル。数字プレフィックスで章順）
├─ book.config.js        … 書誌情報＋ビルド設定（文庫判A6）
├─ book.config.b6.js     … B6判ビルド設定
├─ book.config.epub.js   … EPUB（電子書籍）ビルド設定
├─ themes/
│   ├─ theme-bunko-a6.css … 文庫判テーマ（theme-bunko派生・16行×40字）
│   ├─ theme-b6.css       … B6判テーマ（theme-bunko派生・17行×44字）
│   ├─ theme-epub.css     … EPUB用テーマ（リフロー型縦書き・自己完結。印刷用と独立）
│   └─ nekonote-parts.css … 共通パーツ（ノンブル・柱・扉・奥付・挿絵・傍点・縦中横・割注・改ページ・塗り足し）
├─ images/               … 挿絵（Git管理。太ったらLFS移行）
├─ scripts/
│   ├─ check-images.mjs  … 画像検査（実効解像度・カラー検出）
│   └─ check-pages.mjs   … ページ数検査（4の倍数）
└─ .github/workflows/
    ├─ build-pdf.yml     … 入稿タグpush → 入稿PDF自動生成
    └─ build-epub.yml    … EPUBタグpush → EPUB自動生成
```

## ノンブル・柱

ノンブル（ページ番号）と柱（章タイトル）をどこに出すかは、判型テーマ（`theme-bunko-a6.css` / `theme-b6.css`）の
`:root` にある4つのスロット変数で決める。ネコノテAIの書籍設定フォームからも編集できる。

| 変数 | 位置 |
|---|---|
| `--nekonote--slot-top-outer` | 天・小口（左右ページで自動的に入れ替わる） |
| `--nekonote--slot-top-center` | 天・中央 |
| `--nekonote--slot-bottom-outer` | 地・小口（同上） |
| `--nekonote--slot-bottom-center` | 地・中央 |

値は `none` / `counter(page)`（ノンブル）/ `env(doc-title)`（柱＝章タイトル）と、その連結
（`counter(page) '　' env(doc-title)`）。既定は天・小口にノンブル＋柱で、**左右どちらのページにも柱が出る**。
仕組み（`@page` ルール）は `nekonote-parts.css` 側にある。

本文との間隔を広げたいときは、判型テーマの字詰め（`--vs-theme--num-of-character`）を減らして
天地マージンごと広げる。

### 既存リポジトリへの反映（2ファイルをセットで）

このノンブル機構を後から取り込むときは、**`nekonote-parts.css` と判型テーマの2つを必ずセットで**更新する。
`nekonote-parts.css` だけを差し替えると、スロット変数が未定義のまま `none` にフォールバックし、
**ノンブルも柱も出なくなる**（エラーは出ない）。

1. `themes/nekonote-parts.css` を新しい版で置き換える
2. `themes/theme-bunko-a6.css` と `themes/theme-b6.css` の `:root` に上表の4変数を追記する

## 記法

| 用途 | 記法 |
|---|---|
| ルビ | `{漢字|かんじ}` |
| コメント（出力に出ない） | `<!-- メモ -->` |
| 縦中横 | `<span class="tcy">10</span>年` |
| 傍点 | `<span class="tenten">ここぞ</span>` |
| 割注（2行組みの注記） | `<span class="warichu"><span>前半</span><span>後半</span></span>` |
| 改ページ | `<div class="page-break"></div>`（独立行に置く） |
| 全面挿絵（裁ち落とし） | `![キャプションは刷られない](../images/x.png){.illust-full}` |
| 本文中カット | `![キャプション](../images/x.png){.illust-inline}` |
| 扉・奥付 | フロントマターで `class: titlepage` / `class: colophon` |

## ローカルビルド

```bash
npm install
npx vivliostyle build -c book.config.js       # 文庫判A6 → output/*.pdf
npx vivliostyle build -c book.config.b6.js    # B6判
npx vivliostyle build -c book.config.epub.js  # EPUB → output/*.epub
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

## 電子版（EPUB）

```bash
git tag v1.0-epub && git push origin v1.0-epub
```

→ Actions が EPUB（リフロー型縦書き）を Releases に添付する。入稿とは独立のタグ・
ワークフローで、任意のタイミングでビルドできる。書誌・章構成を変えたときは
`book.config.js` と `book.config.epub.js` の両方を更新すること。
リーダーごとの表示互換は初回頒布前に実機（Kindle・楽天Kobo・Apple Books 等）で確認する。
