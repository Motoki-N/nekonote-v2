# SPEC: 横書き（技術書）組版のアプリ内切替（Issue #356）

策定: 2026-11-01（設計論点は Issue #356 のコメントで確定済み。本書はその具体化）

## 1. 目的と背景

#97（PR #116）でエディタのプレビューは原稿リポジトリのテーマに追従して横書きになるようになった（テーマ追従方式。アプリは書字方向を持たない）。しかし**横書きへ切り替える手段がアプリにない**。現状は原稿リポジトリの `book.config.js`・`package.json`・EPUB設定・ワークフローを手で書き換える必要があり、さらに書籍設定フォームの組み設定・ノンブル/柱・目次は文庫テーマ（theme-bunko 派生）の CSS 構造を前提にしているため、techbook テーマを直接指定すると読み取り専用になる。

本機能は、**原稿リポジトリの組版スタイル（縦書き・文庫 ⇄ 横書き・技術書）をアプリ上から選べるようにする**。

- 案A: 初期セットアップ（SPEC-repo-setup）で組版スタイルを選ぶ
- 案B: 書籍設定から既存リポジトリの組版スタイルを切り替える（往復対応）

### 1.1 変えない原則

- **書字方向の単一情報源は原稿リポジトリ**（#97 の方針を維持）。アプリの DB には持たない。スキーマ変更なし
- **壊れた書き換えはしない**（書籍設定フォームの既存方針）。想定外の構造のファイルは書き換えず、手動手順を案内する
- 変更は **差分プレビュー → 1コミット**（既存の書籍設定と同じ流儀）

## 2. 確定済みの設計判断（Issue #356 より）

| 論点 | 決定 |
|---|---|
| スコープ | 案A＋案B。切替は縦書き⇄横書きの往復に対応 |
| 横書きの判型 | **A5（主）＋ B5** の2判型（文庫の A6＋B6 と同じ構成） |
| 既存リポジトリの書き換え範囲 | 関係ファイル一式を1コミットで。想定外の構造のファイルがあれば切替を止めて手動手順を案内 |
| 組み設定の項目 | **字詰め×行数で統一**（縦書きと同じフォーム項目） |
| 本文書体 | **ゴシック**（techbook 既定の系統）。入稿ビルドで確実に効くよう Noto Sans CJK JP を明示 |
| 版面の初期値 | **A5: 40字×34行 ／ B5: 46字×38行** |

## 3. 組版スタイルの定義

「組版スタイル」は、原稿リポジトリ内のファイル名・値の組（**スタイルセット**）として定義する。アプリはこの対応表だけを知っている（`lib/editor/typesetting-style.ts` に定数として置く）。

| 項目 | 縦書き（文庫） `vertical` | 横書き（技術書） `horizontal` |
|---|---|---|
| 主判型 | A6 `105mm,148mm` | A5 `148mm,210mm` |
| 主判型テーマ（`book.config.js` の theme） | `./themes/theme-bunko-a6.css` | `./themes/theme-techbook-a5.css` |
| 第2判型の設定ファイル | `book.config.b6.js` | `book.config.b5.js` |
| 第2判型 | B6 `128mm,182mm` | B5 `182mm,257mm` |
| 第2判型テーマ | `./themes/theme-b6.css` | `./themes/theme-techbook-b5.css` |
| 出力ファイル名の判型トークン | `-a6` / `-b6` | `-a5` / `-b5` |
| EPUB テーマ | `./themes/theme-epub.css` | `./themes/theme-epub-horizontal.css` |
| EPUB `readingProgression` | `'rtl'` | `'ltr'` |

**現在のスタイルの判定**: `book.config.js` の `theme` が上表の主判型テーマのどちらかと一致すればそのスタイル。どちらでもなければ「**カスタム**」（切替UIは出さず、手動編集の案内のみ）。プレビューの書字方向判定（`lib/editor/theme.ts` の `resolveThemeAssets`）は従来どおりテーマCSSから行い、本判定とは独立している（カスタムテーマでもプレビューは正しく追従する）。

## 4. テンプレートの変更（`docs/templates/manuscript-repo/`）

テンプレートは**縦書きのまま単一**とし、横書き用ファイルを**追加**する。横書き用のファイルは縦書きリポジトリにも展開される（未使用だが、往復切替をファイルの付け替えだけで済ませるため。README の構成表に「横書き切替時に使う」と明記する）。

### 4.1 追加するファイル

**`themes/theme-techbook-a5.css` / `themes/theme-techbook-b5.css`**（横書き判型テーマ）

```css
@import url(../node_modules/@vivliostyle/theme-techbook/theme.css);
@import url(./nekonote-parts.css);

:root {
  --vs-font-size-on-print: 70.83%;   /* A5: 8.5pt（B5 は 79.17% = 9.5pt） */
  --vs-line-height: 1.7;
  --vs-theme--num-of-line: 34;       /* B5: 38 */
  --vs-theme--num-of-character: 40; /* B5: 46 */

  /* 版面を字詰め×行数から決める（theme-bunko と同じ方式の横書き版）。
   * techbook 既定の固定余白（天地25mm・左右22mm）は使わず、余白は auto で版面を中央に置く */
  --vs-page--width: calc(1rem * var(--vs-theme--num-of-character) + 1px);
  --vs-page--height: calc(1rem * var(--vs-line-height) * var(--vs-theme--num-of-line));
  --vs-page--margin-top: auto;
  --vs-page--margin-bottom: auto;
  --vs-page--margin-inner: auto;
  --vs-page--margin-outer: auto;

  --nekonote--trim-width: 148mm;     /* B5: 182mm */
  --nekonote--trim-height: 210mm;    /* B5: 257mm */

  /* 書体: nekonote-parts.css の明朝指定を上書き。入稿ビルド（Linux）と同じ Noto を先頭に */
  --vs-font-family: 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', sans-serif;
  --vs--monospace-font-family: 'Noto Sans Mono CJK JP', Consolas, Monaco, monospace;

  /* techbook の柱・ノンブル既定を無効化してスロットへ一本化（nekonote-parts.css は top-left/right のみ無効化している） */
  --vs-theme--page-bottom-content: none;

  /* ノンブル・柱（設定フォームが書き換える4行。初期値: 柱=天・小口、ノンブル=地・中央） */
  --nekonote--slot-top-outer: env(doc-title);
  --nekonote--slot-top-center: none;
  --nekonote--slot-bottom-outer: none;
  --nekonote--slot-bottom-center: counter(page);
}

/* nekonote-toc: begin … end（目次ブロック。ページ番号は算用数字 decimal・リーダー点線・扉/奥付を除外） */
```

- 組み設定フォームが扱う変数名（`KUMI_VAR_NAMES`）・ノンブル/柱のスロット変数・目次ブロックの書式は**縦書きテーマと同一**。これにより書籍設定フォームは無改修で横書きテーマを編集できる（§6.3 の表示まわりの調整のみ）
- 初期値の文字サイズ・行送りは、字詰め×行数（確定値）を保ったまま**ノド余白が 14mm 以上**になるよう選んだ見込み値（A5: 8.5pt/1.7 → 版面 約120×173mm、B5: 9.5pt/1.7 → 約154×217mm）。実装時にプレビューと入稿PDFで確認し、必要なら文字サイズ・行送りだけを微調整する
- nekonote-parts.css の `@page :left/:right` のスロット割り当ては、横書き（左綴じ）でも「左ページの外側＝左端」なので小口の入れ替えはそのまま正しい

**`book.config.b5.js`**（`book.config.b6.js` と同じ形。`...base` に size/theme/output/workspaceDir だけを差し替え）

**`themes/theme-epub-horizontal.css`**（`theme-epub.css` の横書き版。`writing-mode` 指定を除き、段落を技術書様式＝段落間アキ・字下げなしにする以外は同一の自己完結CSS）

### 4.2 変更するファイル

- **`package.json` / `package-lock.json`**: devDependencies に `@vivliostyle/theme-techbook` を追加（**縦書きのテンプレートでも常に入れる**。新規リポジトリは最初から切替可能になる）。lock は実装時に実際の `npm install` で生成する
- **`README.md`**: 構成表に横書き用ファイルと切替の説明を追記。テンプレート編集時の注意に「判型トークン（`-a6` 等）と §3 のファイル名を維持すること」を追加

### 4.3 書き換えないファイル（調査結果）

- **扉・奥付（`00-tobira.md` / `99-okuzuke.md`）**: 本文に書字方向依存の記述はなく（見た目は nekonote-parts.css が論理プロパティで指定）、そのまま横書きで成立する。Issue 時点では「扉/奥付まで書き換える」としていたが、**書き換える必要がないことが判明したため対象外**。奥付の発行日が漢数字である点は作品の内容としてユーザーが書籍設定の奥付フォームで直す
- **`build-epub.yml`**: 書字方向・判型に依存する記述がない

## 5. スタイル変換（案A・案B 共通のコア）

純関数 `convertTypesettingStyle(files, from, to)`（`lib/editor/typesetting-style.ts`）が、リポジトリのファイル群を受け取り、変更後のファイル群または「変換できない理由のリスト」を返す。案A（テンプレート展開時）と案B（既存リポジトリ）が**同じ関数**を使うことで、新規作成と切替の結果が常に一致する。

### 5.1 変換規則

| 対象 | 規則 | 変換できない条件（→手動） |
|---|---|---|
| `book.config.js` | `theme` と `size` を `replaceStringValue` で置換。`output` 内の判型トークン（`-a6` ⇄ `-a5`）を置換 | theme/size が文字列リテラルで取れない／output に判型トークンが1つもない |
| 第2判型の設定 | 旧ファイル（`book.config.b6.js`）を**削除**し、新ファイル（`book.config.b5.js`）を**作成**。内容は旧ファイルの size/theme/output/workspaceDir の値だけを差し替えたもの | 旧ファイルの size/theme/output が取れない（旧ファイルがない場合はテンプレートから生成） |
| 判型テーマCSS | 移行先のテーマCSSが**なければテンプレートから追加**。あれば**触らない**（前回の組み設定・ノンブル/柱・目次の調整を保持） | なし |
| 移行元のテーマCSS | **残す**（往復時に設定を復元するため） | — |
| `book.config.epub.js` | `theme` と `readingProgression` を置換 | 値が取れない場合は **EPUB だけスキップ**して警告（目次保存の `epubSkipped` と同じ扱い。EPUB はオプション） |
| EPUB テーマ | 移行先がなければテンプレートから追加。あれば触らない | なし |
| `.github/workflows/build-pdf.yml` | 判型トークンを置換: 設定ファイル名（`book.config.b6.js` ⇄ `book.config.b5.js`）・出力名（`-a6`/`-b6` ⇄ `-a5`/`-b5`）・ステップ名とメッセージの判型表記（`文庫判 A6`/`A6版`/`B6判`/`B6版` ⇄ `A5判`/`A5版`/`B5判`/`B5版`） | 置換後に移行元の判型トークンが残る、または移行先のトークンが1つも現れない |
| `package.json` | `check:pages` の出力パスの判型トークンを置換。devDependencies に `@vivliostyle/theme-techbook` がなければ追加（横書きへの切替時のみ。**削除はしない**） | JSON として読めない |
| `package-lock.json` | theme-techbook がなければ、テンプレートの lock から該当エントリ（`node_modules/@vivliostyle/theme-techbook` とその入れ子依存）をコピーし、ルートの devDependencies に追記 | lockfileVersion が 3 でない／同名キーが別バージョンで存在する |

- ワークフローを**全文一致ではなくトークン置換**にするのは、テンプレートの過去版から作られたリポジトリ（ステップの追加・コメント差分など）でも切り替えられるようにするため。置換後の検証（移行元トークンの残存なし・移行先トークンの出現あり）で、想定外の構造を「手動」に倒す
- 変換は**全か無か**: EPUB 以外のどれか1つでも「変換できない」なら何もコミットせず、理由と手動手順を一覧で示す
- lock の直接編集は本機能でいちばん不確実な部分。**実装時に、編集後の lock で `npm ci` が通ることをスクラッチ環境で実証する**（失敗する場合は「横書き切替時は `package.json` だけ書き換え、ワークフローの `npm ci` を `npm install` にする」等の代替を、実装を止めて相談する）

### 5.2 案A（初期セットアップ）での使い方

`loadManuscriptTemplate` で置換済みテンプレートを得た後、横書きが選ばれていれば `convertTypesettingStyle(files, 'vertical', 'horizontal')` を適用してから既存の1コミット展開（SPEC-repo-setup §4.3）に渡す。テンプレートは縦書き単一なので、横書き用の「変換できない」は起きない（起きたらテンプレート側の不整合＝internal エラー）。

## 6. UI

### 6.1 初期セットアップダイアログ（案A。`components/projects/repo-setup-dialog.tsx`）

- 入力項目に「**組版スタイル**」を追加（ラジオ）: 縦書き（文庫 A6・B6）／横書き（技術書 A5・B5）
- 既定値はプロジェクトの執筆ジャンル（SPEC-genre の `writing_genre`）から: 技術書 → 横書き、小説・その他 → 縦書き。呼び出し元（`project-form-dialog.tsx`）から props で渡す
- `repoSetupInputSchema` に `style: z.enum(['vertical', 'horizontal'])` を追加（省略時 vertical＝後方互換）

### 6.2 書籍設定ダイアログの「組版スタイル」区画（案B。`components/editor/settings-dialog.tsx`）

- 区画の先頭（書誌情報の前）に置く
- 表示: 現在のスタイル（縦書き・文庫 ／ 横書き・技術書 ／ カスタム）
- 縦書き・横書きのとき: 「横書き（技術書）に切り替える」／「縦書き（文庫）に切り替える」ボタン
  1. クリックで変換を試算（Server Action `previewTypesettingSwitch`）
  2. 変換できる場合: **変更されるファイルの一覧**（変更／追加／削除の別）と、`book.config.js`・ワークフローの差分を表示。EPUB をスキップする場合はその警告。「判型が変わるため、組み設定の行数・字詰めは移行先のテーマの値になります（移行元の設定は残り、戻せば復元されます）」の注記
  3. 「切り替えてコミット」→ Server Action `switchTypesettingStyle` → 成功でダイアログ内容とプレビューを再読込
  4. 変換できない場合: 理由のファイル別一覧と、マニュアルの手動手順へのリンク
- カスタムのとき: 切替ボタンは出さず、「テーマを手で指定しているため、アプリからは切り替えられません」とマニュアルへの案内
- 未保存の章編集があっても切替はできる（本文には触れないため）。ただしコミット先は章一覧上部で選んでいるブランチ（既存設定と同じ）

### 6.3 既存の書籍設定区画の調整

- **判型ラベル**: 現在「既定（A6）」「B6」と固定。§3 の対応表から現在のスタイルの判型名で表示する（カスタムは「既定」「第2判型」）
- **第2判型の設定ファイル**: `book.config.b6.js` 固定の読み取り（`getBookSettings`・`saveThemeVars` 系の許可リスト・`saveTocSettings`）を、現在のスタイルの第2判型ファイル（カスタム時は b6/b5 のうち存在するもの）へ一般化する
- **目次のページ番号**: 横書きのときは「算用数字・縦中横」を選択肢から外す（縦中横は縦書き専用。ツールバーの傍点・縦中横と同じ出し分け）。横書きで既にこの値が入っていたら「算用数字」として表示する
- 目次の食い違い注記の「判型（A6・B6）」も判型名を動的にする

## 7. サーバー処理

### 7.1 Server Actions（`lib/actions/editor/typesetting.ts` 新規）

- `previewTypesettingSwitch(projectId, { to, branch })`: 対象ファイルを HEAD から読み、`convertTypesettingStyle` を実行して、変更予定（パス・種別・差分用の before/after）または変換できない理由を返す。対象ファイルの blob SHA を `baseShas` として返す
- `switchTypesettingStyle(projectId, { to, baseShas, branch })`:
  1. `loadEditorContext`・`enforceRateLimit(userId, 'editor-save', …)`
  2. HEAD とツリーを取得し、`baseShas` と照合（1つでも変わっていれば conflict。`saveTocSettings` と同じ作法。プレビュー後に増えたファイルも conflict）
  3. HEAD の内容で再度 `convertTypesettingStyle` を実行（プレビュー時の結果を信用しない）
  4. 変更・追加は `{ path, content }`、削除は `{ path, sha: null }` のツリーエントリで `createTree` → `createCommit` → `updateBranchRef`
  5. コミットメッセージ: 「設定: 組版スタイルを横書き（技術書）に切り替え（ネコノテAI）」／縦書き版
- 書き換え対象のパスは §3 の定数表から組み立てたものに限る（クライアントから任意パスを受け取らない）

### 7.2 エラー

- PAT に Workflows 権限がない（ワークフロー書き換えで 403/422）→ SPEC-repo-setup と同じ validation 文言で案内（正規化処理を共有する）
- 変換できない → validation（理由一覧はプレビュー側で返すため、ここでは要約のみ）
- 楽観ロック不一致 → conflict「設定ファイルがリモートで更新されています。設定を開き直してください」

## 8. テスト・検証

- 純関数 `convertTypesettingStyle` の往復検証（縦→横→縦で、追加ファイル以外が元と同一になること）。本リポジトリにはテストランナーがないため、テンプレートを入力にした使い捨ての検証スクリプト（スクラッチ）で確認し、結果を dev-log に残す
- typecheck / lint / format:check
- テスト用リポジトリで:
  1. 初期セットアップで横書きを選択 → エディタで横書きA5プレビュー・ノンブル/柱・目次・組み設定フォームが編集可能
  2. 既存の縦書きリポジトリ（theme-techbook が package.json にない旧テンプレート由来）を横書きへ切替 → 入稿ビルド（PDF A5/B5・EPUB）が成功
  3. 横書き → 縦書きへ戻す → 縦書きの組み設定が切替前の値で復元される → 入稿ビルド成功
  4. ワークフローを手で編集したリポジトリで切替が止まり、理由が表示される
- 入稿PDF で、ゴシック（Noto Sans CJK JP）が埋め込まれていること、ノド余白が想定どおりであること
- ワークフローを書き換えるため、実装後に **security-reviewer** を通す（PAT でのワークフロー書き込み経路の追加）

## 9. ドキュメント

- manual.md §8: 「組版スタイル（縦書き・横書き）」の節を追加（初期セットアップでの選択・書籍設定からの切替・切替できないときの手動手順）。§8 の見出しは「縦書きエディタ」のまま、冒頭に「横書き（技術書）にも対応」と明記する
- SPEC-index: §4 縦書きエディタの表に本 SPEC を追加。§7 の「エディタの横書き対応」行に本 SPEC への参照を追記
- SPEC-repo-setup・SPEC-vertical-editor の冒頭に「改訂:」行で本 SPEC への参照を追加
- テンプレート README（§4.2）

## 10. スコープ外

- 縦書き・横書き以外のスタイル（例: 縦書きの A5、横書きの文庫判）や、判型の自由選択
- カスタムテーマからの切替（判定できない構造は手動）
- 本文（章ファイル）の書き換え（縦中横・傍点の記法は横書きでもそのまま残り、組版上は横書きテーマで無害）
- 移行元のテーマCSSの削除・整理
- `package.json` からの theme-techbook の削除
