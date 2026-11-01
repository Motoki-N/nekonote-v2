# 原稿リポジトリテンプレート（縦書きエディタ Phase 1）

SPEC-vertical-editor §3 の原稿リポジトリ構成。VS Code で VFM を書いて push し、
入稿タグを打つと GitHub Actions が入稿品質の PDF を Releases に添付する。

> **テンプレート編集時の注意**: アプリ内の初期セットアップ（SPEC-repo-setup）は、
> サンプル値 `竜の巣`（タイトル）・`灰谷 汀`（著者名）・`ryu-no-su`（出力ファイル名）を
> 目印に文字列置換で作品情報を埋め込む。テンプレートを変更するときはこの3つの表記を
> 維持すること（別の値に変えると置換が効かなくなる）。
>
> また、書籍設定の「組版スタイル」切替（SPEC-horizontal-typesetting）は、下の「組版スタイル」節の
> ファイル名と、出力ファイル名・ワークフロー中の判型トークン（`-a6` / `-b6` / `-a5` / `-b5`、
> `A6版` / `B6判` 等の表記）を目印に書き換える。これらの表記も維持すること。

## 構成

```
├─ manuscripts/          … 本文（VFM形式・章ごとに1ファイル。数字プレフィックスで章順）
├─ book.config.js        … 書誌情報＋ビルド設定（文庫判A6）
├─ book.config.b6.js     … B6判ビルド設定（横書きに切り替えると book.config.b5.js に置き換わる）
├─ book.config.epub.js   … EPUB（電子書籍）ビルド設定
├─ themes/
│   ├─ theme-bunko-a6.css … 文庫判テーマ（theme-bunko派生・16行×40字）
│   ├─ theme-b6.css       … B6判テーマ（theme-bunko派生・17行×44字）
│   ├─ theme-epub.css     … EPUB用テーマ（リフロー型縦書き・自己完結。印刷用と独立）
│   ├─ theme-techbook-a5.css … 横書き・A5判テーマ（theme-techbook派生・34行×40字。横書き切替時に使う）
│   ├─ theme-techbook-b5.css … 横書き・B5判テーマ（theme-techbook派生・38行×46字。同上）
│   ├─ theme-epub-horizontal.css … 横書きEPUB用テーマ（同上）
│   └─ nekonote-parts.css … 共通パーツ（ノンブル・柱・扉・奥付・挿絵・傍点・縦中横・割注・改ページ・塗り足し）
├─ images/               … 挿絵（Git管理。太ったらLFS移行）
├─ scripts/
│   ├─ check-images.mjs  … 画像検査（実効解像度・カラー検出）
│   └─ check-pages.mjs   … ページ数検査（4の倍数）
└─ .github/workflows/
    ├─ build-pdf.yml     … 入稿タグpush → 入稿PDF自動生成
    ├─ build-epub.yml    … EPUBタグpush → EPUB自動生成
    └─ build-ebook-pdf.yml … PDFタグpush → 電子配布用PDF（トンボ・塗り足しなし）自動生成
```

## 組版スタイル（縦書き・横書き）

テンプレートは縦書き（文庫）で展開される。横書き（技術書）にするには、ネコノテAIの
初期セットアップで「横書き」を選ぶか、エディタの書籍設定「組版スタイル」から切り替える
（縦書きへ戻すこともできる）。切替は次のファイルを1コミットで書き換える。

| 項目 | 縦書き（文庫） | 横書き（技術書） |
|---|---|---|
| `book.config.js` の判型・テーマ | A6・`theme-bunko-a6.css` | A5・`theme-techbook-a5.css` |
| 第2判型の設定 | `book.config.b6.js`（B6・`theme-b6.css`） | `book.config.b5.js`（B5・`theme-techbook-b5.css`） |
| EPUB（`book.config.epub.js`） | `theme-epub.css`・`readingProgression: 'rtl'` | `theme-epub-horizontal.css`・`'ltr'` |
| 出力ファイル名・`build-pdf.yml`・`check:pages` | `-a6` / `-b6` | `-a5` / `-b5` |

判型テーマCSSは切り替えても削除しない（組み設定・ノンブル/柱・目次の調整は、戻したときに復元される）。
横書きの本文書体は Noto Sans CJK JP（ゴシック）を優先する。


ノンブル（ページ番号）と柱（章タイトル）をどこに出すかは、判型テーマ（`theme-bunko-a6.css` / `theme-b6.css`。横書きは `theme-techbook-a5.css` / `theme-techbook-b5.css`）の
`:root` にある4つのスロット変数で決める。ネコノテAIの書籍設定フォームからも編集できる。

| 変数 | 位置 |
|---|---|
| `--nekonote--slot-top-outer` | 天・小口（左右ページで自動的に入れ替わる） |
| `--nekonote--slot-top-center` | 天・中央 |
| `--nekonote--slot-bottom-outer` | 地・小口（同上） |
| `--nekonote--slot-bottom-center` | 地・中央 |

値は `none` / `counter(page)`（ノンブル）/ `env(doc-title)`（柱＝章タイトル）と、その連結
（`counter(page) '　' env(doc-title)`）。縦書きの既定は天・小口にノンブル＋柱（横書きの既定は天・小口に柱、地・中央にノンブル）で、**左右どちらのページにも柱が出る**。
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
| 全面挿絵（裁ち落とし） | `![キャプションは刷られない](../images/x.png){.illust-full}`（alt 空の `![](../images/x.png){.illust-full}` も可） |
| 本文中カット | `![キャプション](../images/x.png){.illust-inline}`（alt 空の `![](../images/x.png){.illust-inline}` も可） |
| 本文中カット（ページの四隅） | `![キャプション](../images/x.png){.illust-inline .illust-bottom-left}`（`.illust-top-right` / `.illust-bottom-right` / `.illust-top-left` / `.illust-bottom-left`。ページに収まらないと次のページへ送られる。EPUB では通常のカットとして表示） |
| 扉・奥付 | フロントマターで `class: titlepage` / `class: colophon` |

### 全面挿絵の修正を既存リポジトリへ反映する

以前の `nekonote-parts.css` は、alt 空の全面挿絵（`![](...){.illust-full}`。ネコノテAIから挿入するとこの形になる）を
専用ページにできず、画像が右下にずれて切れていた。`themes/nekonote-parts.css` の「全面挿絵」節で、
`figure:has(> img.illust-full) {` を `:is(figure, p):has(> img.illust-full) {` に置き換える
（`> figcaption` が続くほうは figure 専用なのでそのまま）。ファイルごと置き換える場合は、上記「既存リポジトリへの反映（2ファイルをセットで）」の手順に従うこと。

### 本文中カットの修正を既存リポジトリへ反映する

以前の `nekonote-parts.css` は、alt 空の本文中カット（`![](...){.illust-inline}`。ネコノテAIでキャプション未入力のときこの形になる）に
「本文中カット」節の指定が当たらず、カットがページをまたいで分かれたり前後の余白がなかったりした。`themes/nekonote-parts.css` の「本文中カット」節で、
`figure:has(> img.illust-inline) {` を `:is(figure, p):has(> img.illust-inline) {` に置き換える。ファイルごと置き換える場合は、上記「既存リポジトリへの反映（2ファイルをセットで）」の手順に従うこと。

### 本文中カットの四隅配置を既存リポジトリへ反映する

ネコノテAIの画像ダイアログで配置（ページの右上・右下・左上・左下）を選ぶと、`{.illust-inline .illust-bottom-left}` のような修飾クラスを書き込む。
以前の `nekonote-parts.css` にはこの指定がなく、選んでも本文の流れの中に置かれる（崩れはしない）。
本テンプレートの `themes/nekonote-parts.css` から「本文中カットの四隅配置（ページフロート）」節を、既存リポジトリの同ファイルの「本文中カット」節の直後に追記する。

## ローカルビルド

`package-lock.json` は CI（`npm ci`・`setup-node` の npm キャッシュ）が必須とするため、削除せずコミットしておくこと。

```bash
npm install
npx vivliostyle build -c book.config.js       # 文庫判A6 → output/*.pdf
npx vivliostyle build -c book.config.b6.js    # B6判
npx vivliostyle build -c book.config.epub.js  # EPUB → output/*.epub
node scripts/check-images.mjs                 # 画像検査
node scripts/check-pages.mjs output/ryu-no-su-a6.pdf  # ページ数検査
GS_OPTIONS=-dNOSAFER npx press-ready build --input output/ryu-no-su-a6.pdf --output output/ryu-no-su-a6-press.pdf
```

本文書体は Noto Serif CJK JP を優先する（CI（Linux）の入稿PDFと同じ書体）。
プレビュー端末にも Noto Serif CJK JP を入れておくと、改ページ位置がPDFと揃う。
Google Fonts 配布の「Noto Serif JP」は別名で登録されるため一致しない。CJK版（notofonts/noto-cjk の `NotoSerifCJK*.otf` / `.ttc`）を入れること。
未インストールの macOS では游明朝で組まれる（版面設計＝行数×字数は同一だが、改ページ位置はずれ得る）。

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
ワークフローで、任意のタイミングでビルドできる。書誌・章構成・目次は
`book.config.epub.js` が `book.config.js` を引き継ぐため、変えるのは `book.config.js` だけでよい
（EPUB設定に `entry` 等を直接書くと、EPUBだけ古いまま残る）。
リーダーごとの表示互換は初回頒布前に実機（Kindle・楽天Kobo・Apple Books 等）で確認する。

## 電子配布用PDF

```bash
git tag v1.0-pdf && git push origin v1.0-pdf
```

→ Actions が電子配布用PDF（`output/ryu-no-su-ebook.pdf`）を Releases に添付する。
組版は入稿PDFの主判型（`book.config.js`）と同一で、仕上がりサイズ・トンボと塗り足しなし・
PDF/X-1a 変換なしの点だけが違う（`nekonote-parts.css` の塗り足し・トンボの変数を `--css` で上書きする）。
ローカルでは次で作れる。

```bash
npx vivliostyle build -c book.config.js --css ':root{--vs-page--marks:none;--vs-page--bleed:0mm}' -o output/ryu-no-su-ebook.pdf
```
