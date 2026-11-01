# SPEC: 電子配布用PDF（トンボ・塗り足しなし）のビルド

策定: 2026-11-01（設計論点はユーザーへのインタビューで確定。本書はその具体化）

## 1. 目的と背景

原稿リポジトリからは、GitHub Actions で次の2種類の成果物をビルドできる。

- **入稿PDF**（`v*-nyuko` タグ・`build-pdf.yml`）: 印刷所提出用。トンボ・塗り足し（3mm）付き、PDF/X-1a 変換済み
- **EPUB**（`v*-epub` タグ・`build-epub.yml`）: 電子書籍のリフロー型

電子書籍として**固定レイアウトのPDFを配布**したい場合、入稿PDFはトンボと塗り足しが付いているためそのまま使えない。本機能は、**仕上がりサイズ・トンボなし・PDF/X-1a 変換なしのPDF**（以下「電子配布用PDF」）をビルドできるようにする。

### 1.1 実現方法の前提（検証済み）

トンボと塗り足しは `themes/nekonote-parts.css` の CSS 変数で指定している。

```css
:root {
  --vs-page--bleed: 3mm;
  --vs-page--marks: crop cross;
}
```

Vivliostyle CLI の `--css` オプションでこれを上書きすれば、テーマ・設定ファイルを一切変えずに電子配布用PDFが得られる。実在の原稿リポジトリで次を確認済み（A6 なら 105×148mm、ページ数は入稿版と同じ）。

```bash
npx vivliostyle build -c book.config.js \
  --css ':root{--vs-page--marks:none;--vs-page--bleed:0mm}' \
  -o output/<slug>-ebook.pdf
```

（策定時の検証記録。その後 #364 で奥付の「印刷」行を隠す `.print-only{display:none}` を `--css` に足し、EPUBテーマにも同じ指定を加えた——§3.3）

### 1.2 変えない原則

- **入稿パイプライン（`build-pdf.yml`）と EPUB パイプラインには手を入れない**（EPUB 追加時と同じ方針）
- **テーマCSS・設定ファイルは追加しない**。組版は入稿版と同一で、違いはトンボと塗り足しだけ
- スキーマ変更なし。PAT の権限変更なし（タグ作成は従来どおり Contents 権限）

## 2. 確定した設計判断

| 論点 | 決定 | 理由 |
|---|---|---|
| トリガー | **新しいタグ種別 `v*-pdf`**＋新ワークフロー `build-ebook-pdf.yml` | 電子版の配布は入稿と別のタイミングで起きる。入稿タグを切らずに電子版だけ出し直せる |
| 対象の判型 | **主判型だけ**（縦書きは A6、横書きは A5） | 電子配布で2サイズは不要 |
| ファイル名 | **`<slug>-ebook.pdf`** | 判型名を含めないので、組版スタイル切替（A6 ⇄ A5）でワークフローを書き換える必要がない |
| 全面挿絵（`.illust-full`）の扱い | **仕上がりサイズいっぱいに配置**（CSS 変更なし） | 下記 §4 |
| 既存リポジトリへの導入 | **マニュアルに手順を書く**（ワークフローファイル1つのコピー） | 作業がファイル1つのコピーで済む。アプリからの追加機能は作らない（初期セットアップが求める Workflows 権限で技術的には可能だが、そのためのUIと書き換えロジックを足すほどの手間ではない） |

## 3. テンプレートの変更（`docs/templates/manuscript-repo/`）

### 3.1 追加: `.github/workflows/build-ebook-pdf.yml`

```yaml
name: build-ebook-pdf

on:
  push:
    tags:
      - 'v*-pdf'

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - name: 日本語フォントのインストール
        run: |
          sudo apt-get update
          sudo apt-get install -y fonts-noto-cjk fonts-noto-cjk-extra
      - name: 組版（主判型・トンボ/塗り足しなし）
        run: >-
          npx vivliostyle build -c book.config.js --timeout 600
          --css ':root{--vs-page--marks:none;--vs-page--bleed:0mm}.print-only{display:none}'
          -o output/ryu-no-su-ebook.pdf
      - name: 成果物の存在検査
        run: test -f output/ryu-no-su-ebook.pdf || { echo "::error::…"; exit 1; }
      - name: Releases に添付
        run: gh release create "${{ github.ref_name }}" … output/ryu-no-su-ebook.pdf
```

- 主判型の設定 `book.config.js` を使うため、**組版スタイル（縦書き・横書き）に自動で追従**する。判型トークン・判型表記を含まないので、組版スタイル切替（SPEC-horizontal-typesetting）の書き換え対象に加えない
- 入稿専用の工程（Ghostscript・press-ready の PDF/X-1a 変換、ページ数の4の倍数検査、印刷向け画像検査）は実行しない
- フォントは入稿PDFと同じ Noto CJK を入れる（書体と改ページ位置を入稿版と揃える）
- `ryu-no-su` は初期セットアップの置換目印（SPEC-repo-setup）。新規リポジトリでは作品の出力ファイル名に置き換わる
- セキュリティ: 既存ワークフローと同じくタグ push のみで起動し、`pull_request` では実行しない

### 3.2 README

構成図にワークフローを追記し、「電子配布用PDF」節（タグの打ち方・入稿PDFとの違い）を足す。

### 3.3 奥付の「印刷」行（#364）

電子版（電子配布用PDF・EPUB）は印刷していないため、奥付の「印刷」行（印刷会社名）を出さない。入稿PDF・プレビューには従来どおり出す。

- テンプレートの `99-okuzuke.md` で、`<dl>` 内の「印刷」の dt/dd の組を `<div class="print-only">…</div>` で包む（`<dl>` の子に dt/dd の組を包む `div` を置くのは HTML 仕様上有効）
- 電子配布用PDFは `--css` に `.print-only{display:none}` を足し、EPUB は `theme-epub.css` / `theme-epub-horizontal.css` に同じ指定を持たせる。印刷用テーマには指定しない
- 中の `<dt>印刷</dt><dd>…</dd>` は変えないので、奥付フォーム（`lib/editor/okuzuke.ts`）の正規表現はそのまま「印刷」項目を読み書きできる
- 既存リポジトリはマニュアル §8「入稿ビルド」の手順で移行する（`99-okuzuke.md` の該当行を包み、EPUBテーマとワークフローに指定を足す）。未移行でも「印刷」行が電子版に出るだけでビルドは壊れない

## 4. 全面挿絵の扱い

全面挿絵は `img.illust-full` を「仕上がり寸法＋塗り足し×2」の大きさで、塗り足し分だけ外へずらして置いている（`nekonote-parts.css`）。

```css
top: calc(-1 * var(--vs-page--bleed));
width: calc(var(--nekonote--trim-width) + 2 * var(--vs-page--bleed));
```

`--vs-page--bleed: 0mm` で組むと、この式はそのまま**仕上がりサイズぴったり**になる。`object-fit: cover` は維持されるため、画像は余白なしでページ全面を覆う。印刷版は塗り足し3mmぶん外側が裁ち落とされるのに対し、電子配布用PDFでは仕上がり枠に合わせて縮尺される——見える範囲がわずかに違うだけで、CSS の変更は不要。

## 5. アプリの変更

### 5.1 `lib/actions/editor/build.ts`

- `BuildKind` に `"pdf"` を追加
- タグ検証の正規表現を `-(nyuko|epub|pdf)$` に広げる
- `getBuildTagInfo` が `-pdf` タグの一覧と次タグ提案を返す
- `getBuildStatus` の完了判定は従来どおり（`-epub` 以外は `.pdf` の成果物の出現で完了）

### 5.2 `components/editor/build-dialog.tsx`

- 種別ボタンに 3つ目「**電子配布用PDF**」を追加（タグ `v1.0-pdf`、成果物「電子配布用PDF（トンボ・塗り足しなし）」）
- 完了表示の成果物名を、作成したタグの種別に従って3種から出し分ける
- タイムアウト時、`-pdf` タグなら「`build-ebook-pdf.yml` が原稿リポジトリに無い可能性」を案内する（既存リポジトリは手動導入のため、未導入だとタグを作っても何も起きない）

## 6. 既存リポジトリへの導入（マニュアル §8「入稿ビルド」）

1. 本リポジトリの `docs/templates/manuscript-repo/.github/workflows/build-ebook-pdf.yml` を、原稿リポジトリの同じ場所へコピーする
2. ファイル中の `ryu-no-su`（3か所。出力先・存在検査・Release 添付）を、`book.config.js` の出力ファイル名の作品部分（`output/<ここ>-a6.pdf` の `<ここ>`）に置き換える
3. デフォルトブランチへ push する。以後はビルドダイアログの「電子配布用PDF」で起動できる

## 7. 検証

- `npm run typecheck` / `npm run lint` / `npm run format:check`
- テンプレート一式をスクラッチにコピーし、ワークフローと同じコマンドでローカルビルドして、ページサイズが仕上がり寸法（A6: 105×148mm）であること・ページ数が入稿版（`book.config.js` 素のビルド）と同じであることを確認する
- ビルドダイアログで 3種の切替・タグ提案・形式エラー表示をブラウザで確認する
- Actions 上の実ビルドは、マージ後に実在の原稿リポジトリへワークフローを導入して確認する（ユーザー作業）

## 8. スコープ外

- 第2判型（B6・B5）の電子配布用PDF
- アプリからの既存リポジトリへのワークフロー追加（§2 のとおりマニュアル手順で済ませる）
- PDF のしおり（目次アウトライン）・メタデータの追加調整（Vivliostyle の既定のまま）
