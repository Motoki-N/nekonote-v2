# SPEC-vertical-editor-phase2: 2ペインWebエディタ

作成日: 2026-07-16
ステータス: **確定**（2026-07-16 インタビュー済み。§12 参照）
親SPEC: [SPEC-vertical-editor.md](SPEC-vertical-editor.md) §5.1 Phase 2
改訂: 2026-07-23 論点E「デフォルトブランチのみ」を解除（Issue #21・SPEC-vertical-editor-phase5。§11 スコープ外の「ブランチ切替・作成・PR連携」の昇格）
改訂: 2026-08-12 §9 に生HTML実行の受容判断を追記（security-audit-20260812 M-1）

## 1. 目的・完了条件

親SPEC §5.1 Phase 2「2ペインWebエディタ（CodeMirror＋Vivliostyle Viewer）＋GitHub読み書き」の詳細仕様。

**完了条件（親SPEC §10-2）**: ブラウザだけで執筆→保存（コミット）→縦書きプレビューが回る。

1. エディタで章を開く→編集→保存でコミットが作られる→リロードで復元
2. 未保存のままリロードしてもIndexedDB待避分が復元される
3. 縦書きプレビューが判型どおりのページ分割・ノンブルで表示される
4. 他所からのpushと競合した場合に日本語エラー＋マージ支援が出る

## 2. 前提と再利用資産

Phase 1 完了（2026-07-16）により以下が揃っている:

- **原稿リポジトリの規約**: `docs/templates/manuscript-repo/` のテンプレート構成（VFM原稿 `manuscripts/`・`book.config.js`・`themes/`・Actions入稿ビルド）
- **検証リポジトリ**: `<owner>/<poc-repo>`（実原稿「Dシリーズ」パート1のVFM化済み・Actions実走済み）。Phase 2 のGitHub読み書き先として流用する
- **PATは既にwrite権限**: Fine-grained PAT（Contents: Read/Write）は校正コミット書き戻し（Sprint 4）で登録・実書き込み実績済み。**トークンのスコープ変更は不要**（親SPEC §4.1 の「write昇格」は済んでいる）
- **再利用するコード**:
  - `lib/git/github.ts` — `getFileContent`（blob SHA付き取得）・`putFileContent`（SHA楽観ロック付きコミット）・`getManuscriptTree`。エディタ用に拡張（§6）
  - `lib/git/credentials.ts` — `patCredentialProvider`（トークンはserver-only）
  - `projects.repo` / `projects.base_path` — 対象リポジトリの解決（論点A）
  - `AppError`＋共通ハンドラー・`ActionResult` パターン

## 3. 画面構成

### 3.1 ルーティング

`app/(app)/projects/[id]/editor/page.tsx` — プロジェクト配下（board / manuscript と同列のタブ）。repo / base_path の解決がプロジェクト経由で自然につながる（論点Bで確定）。

コンポーネントは `components/editor/`、Server Actions は `lib/actions/editor.ts`、VFM・プレビューのユーティリティは `lib/editor/` に置く。

### 3.2 レイアウト

```
┌─ ヘッダー: 章ファイル名 / 保存ボタン(未保存インジケータ) / プレビュー切替 ─┐
├─ 章一覧サイドバー ─┬─ 入力ペイン(CodeMirror) ─┬─ プレビューペイン(iframe) ─┤
│  (折りたたみ可)    │        横書きVFM          │   Vivliostyle 縦書き        │
└────────────────────┴──────────────────────────┴────────────────────────────┘
```

- デスクトップ: 左右2ペイン。比率はドラッグで可変、プレビューは折りたたみ可（親SPEC §4.4）
- スマホ: Phase 2 は崩れない最低限の表示のみ。入力/プレビューのタブ切替UIは Phase 3（論点Dで確定）
- 色はテーマ用CSS変数のみ。**プレビューiframe内の組版CSSは例外**（書籍テーマが正。アプリのライト/ダークに追従させない。親SPEC §5）

### 3.3 章一覧サイドバー

- `base_path` 配下の `manuscripts/*.md` を一覧表示する
- 並び順は `book.config.js` の `entry` 配列を正とする。`book.config.js` はJSファイルのため**実行せず**、`entry` 配列内の文字列リテラルを正規表現で抽出する。抽出できない場合はファイル名昇順にフォールバック（数字プレフィックス慣習で章順になる）
- 未保存の待避がある章にはインジケータを表示する
- **新規章ファイルの作成**（論点Dで確定・Phase 2 に含める）: ファイル名を入力（`manuscripts/` 配下固定・`NN-slug.md` 形式をプレースホルダで案内・パス検証は `manuscriptFilePathSchema` と同等の再検証）→ 見出しフロントマター入りの雛形で**作成＝コミット**（Contents API PUT・sha なし。既存ファイルと衝突したら日本語エラー）。`book.config.js` の `entry` への追記は自動では行わない（Phase 3 の設定フォーム化まではVS Code等で直接編集。未記載の章は一覧の末尾に「entry未登録」印つきで表示する）

## 4. 入力ペイン（CodeMirror 6）

- 依存: `codemirror` v6系（`@codemirror/state` `@codemirror/view` `@codemirror/language` `@codemirror/lang-markdown` 等）
- プレーンテキスト編集＋Markdownベースのシンタックスハイライトを土台に、VFM固有記法を装飾で重ねる:
  - ルビ `{漢字|かんじ}` — 装飾ハイライト
  - HTMLコメント `<!-- -->` — 色付き表示（コメント一覧UIはPhase 3）
  - 見出し `#` — Markdown標準のハイライト
- 縦書きはしない（横書き専用。IME相性問題の根本回避。親SPEC §4.4）
- 保存ショートカット: `Cmd/Ctrl+S` → 保存ダイアログ（§6）
- 字数カウント・ページ数見積りは **Phase 3**（親SPEC §5.1）

## 5. プレビューペイン（Vivliostyle）

### 5.1 方式: クライアント完結の部分プレビュー

再組版のたびにサーバーを往復しない。編集中テキストの組版はブラウザ内で完結させる。

```
編集テキスト(VFM) ─@vivliostyle/vfm(ブラウザ実行)→ HTML
  ＋ テーマCSSをインライン注入（リポジトリの themes/*.css を初回にサーバー経由で取得）
  ＋ 画像パスを認証プロキシURLへ書き換え（§5.3）
  → Blob URL 化
  → iframe内の Vivliostyle Viewer（自前ホスト）が #src= で読み込み・組版
```

- **Vivliostyle Viewer の自前ホスト**: `@vivliostyle/viewer` の静的ビルドを `public/vivliostyle/` へ配置（postinstall スクリプトで node_modules からコピー）。CDN参照はしない
- **再組版タイミング**: 打鍵ごとではなく**数秒のデバウンス**＋保存時（親SPEC §4.4）。組版中はプレビュー上に「組版中…」を薄く表示
- **判型**: `book.config.js` の `theme` が指すCSS（文庫A6）を既定とする。A6/B6の切替UIはPhase 2では持たない（`book.config.js` の theme を差し替えれば追従する）
- ⚠️ **実装ステップ1で技術スパイク**（§10）: `@vivliostyle/vfm` のブラウザバンドル可否・Blob URLをViewerのiframeが読めるか、を最初に検証する。不成立なら `@vivliostyle/core`（CoreViewer API）での直接埋め込みに切り替える

### 5.2 全体プレビュー（明示操作）

Phase 2 に含める（論点Cで確定）。

- 部分プレビュー（編集章のみ）が既定（親SPEC §8 論点3）
- 全体プレビューは明示操作: 全章をサーバー経由で取得→各章をVFM変換→`entry` 順に結合した単一HTMLとして組版。通しのページ分割・ノンブルを確認できる
- **制約**: 目次ページ（`{ rel: 'contents' }`）は Vivliostyle CLI のビルド時生成物のためプレビューには現れない。目次込みの最終確認は入稿ビルド（Actions）で行う。この制約はUI上に注記する

### 5.3 画像プロキシ

プレビューHTML内の相対画像パス（`../images/xxx.png`）は、PATがないブラウザからは取得できない。route handler で認証プロキシする:

- `GET /api/editor/asset?projectId=...&path=images/xxx.png`
- 認可: セッション必須＋プロジェクト所有確認（RLS越しの取得）＋パス検証（`base_path` 配下・`..` 拒否・拡張子allowlist: png/jpg/jpeg/webp/gif）
- サーバーがPATでGitHubから取得してそのまま返す（`Cache-Control: private, max-age=300`）
- **security-reviewer の対象**（§9）

## 6. 保存＝コミット

- **保存＝コミット**（親SPEC §4.1）。`Cmd/Ctrl+S` または保存ボタン → ダイアログでコミットメッセージを確認・編集 → コミット
- メッセージ自動生成: `執筆: {ファイル名} を更新（ネコノテAI 縦書きエディタ）` を初期値とし編集可
- 既存 `putFileContent` を拡張し、レスポンスの `content.sha`（新blob SHA）も返す — コミット後の再取得なしで楽観ロックの基準SHAを進める（校正機能の `last_reviewed_commit` 前進と同じ発想の自己更新）
- 対象ブランチ: **デフォルトブランチのみ**（論点Eで確定。ブランチ切替・作成のUIは後続フェーズ）
- 書き込みは編集対象の1ファイルのみ。`book.config.js`・`themes/` の編集はスコープ外（Phase 3のフォーム化まではVS Code等で直接編集）

## 7. 未保存編集の待避（IndexedDB）

- ストア: `nekonote-editor` DB / `drafts` ストア。キーは `{repo}:{branch}:{path}`
- 値: `{ content, baseSha, updatedAt }`（`baseSha` = 編集開始時点の blob SHA）
- 書き込み: 入力のデバウンス（1秒程度）ごとに待避
- 復元フロー（章を開いたとき）:
  1. リモートの最新内容＋blob SHAを取得
  2. 待避があり `content` がリモートと異なる場合 → 復元バナー「未保存の編集があります」＋[復元する / 破棄する]
  3. 待避の `baseSha` とリモートSHAが異なる場合（待避中に他所が更新）→ 競合フロー（§8）へ
- クリア: コミット成功時・明示破棄時。待避はキャッシュであり**正は常にGitHub**（親SPEC §6）
- 依存追加なし（素のIndexedDBを薄いヘルパー `lib/editor/draft-store.ts` で包む）

## 8. 競合処理（マージ支援）

発生点は2つ。どちらも**リモート優先で再取得→ローカルはマージ支援**（親SPEC §5）:

1. **保存時の409**（blob SHA不一致）: `putFileContent` の既存 conflict 正規化を流用
2. **復元時のSHAずれ**（§7-3）

処理: 日本語メッセージ「原稿がリモートで更新されています」→ マージビューへ。`@codemirror/merge` の2ペインdiff（左=リモート最新・右=ローカル編集、チャンク単位で取り込み操作）で手動マージ→通常の保存フローへ戻る。自動マージはしない（最もシンプルな方法）。

## 9. データ・セキュリティ

- **DBスキーマ変更なし**（論点Aで確定）。対象リポジトリは既存の `projects.repo` / `projects.base_path` をそのまま使う。`base_path` は**プロジェクトルート（`book.config.js` のある階層）**を指す規約とし、エディタはその配下の `manuscripts/` と `themes/` を参照する
- **竜の巣プロジェクトの repo 設定を `<owner>/<poc-repo>`（base_path 空）へ切り替える**（設定画面からユーザーが実施）。校正・進捗も同じVFM原稿を見るようになる（`.md` は既存機能でサポート済み）。<manuscripts-repo> への本適用（.txt との同居設計）は行わない——<poc-repo> をこのまま執筆リポジトリとして育てるか、後日改めて判断する
- 原稿・設定・テーマの実体はすべてGitHub。アプリDBには置かない（親SPEC §6）
- PATはserver-onlyのまま。クライアントに渡るのは本文テキスト・テーマCSS・プロキシ経由の画像のみ
- **security-reviewer 必須ゲート**（親SPEC §9・CLAUDE.md）:
  - 画像プロキシ route handler（認可・パス検証）
  - エディタからの新規書き込み経路（コミットAPI）
- レート制限: 保存（コミット）とアセットプロキシに `lib/rate-limit.ts` を適用する
- **プレビューの生HTML実行は受容済みリスク（self-XSSの範囲）**（security-audit-20260812 M-1）:
  VFM は原稿中の生HTMLを素通しし、その出力を Blob URL 化してアプリと同一オリジンの
  Vivliostyle Viewer に読ませるため、**原稿に書いた `<script>` やイベントハンドラ属性
  （`onerror` 等）はプレビュー描画時にアプリのオリジンで実行される**（2026-08-12 に実機再現で確認。
  `parent` 経由でアプリ側 window へも到達できる）。
  生HTMLの許容は仕様上必須で（`components/editor/codemirror.ts` の `insertWarichuText` /
  `insertPageBreak` が挿入する割注 `<span class="warichu">`（インライン）と改ページ
  `<div class="page-break">`（ブロック）が生HTMLの素通しを前提とする。記法の定義は
  SPEC-aozora-export §3）、全面サニタイズはこの機能と両立しない。
  単一許可ユーザー制では原稿の書き手＝閲覧者本人のため self-XSS の範囲として受容する。
  **再評価トリガー**: ①複数ユーザー化・原稿の共有機能の導入 ②リポジトリに外部コントリビュータが
  入る運用（phase5 のブランチ切替でPRブランチの原稿もプレビューできるため）。
  そのときは allowlist サニタイズ（割注・改ページ・ルビのみ許可）か、
  Viewer への CSP 付与を検討する（`sandbox` は `allow-same-origin` を外すと blob: 読み込みと
  ページ数取得が壊れるため単純適用は不可）

## 10. 実装ステップ

| # | 内容 | 検証 |
|---|---|---|
| 1 | **技術スパイク**: VFMブラウザ変換＋Viewer自前ホスト＋Blob URL組版（<poc-repo>のテーマCSSをハードコードで注入した最小ページ） | 縦書き・判型・ノンブルが出ることを目視 |
| 2 | 章一覧＋読み込み（entry順・base_path解決）＋CodeMirror表示 | 章を開いて本文が出る |
| 3 | プレビュー接続（デバウンス・テーマCSS取得・画像プロキシ） | 編集がプレビューに反映 |
| 4 | 保存＝コミット（ダイアログ・SHA前進）＋IndexedDB待避・復元 | E2E完了条件1・2 |
| 5 | 競合処理（409・SHAずれ→マージビュー） | E2E完了条件4 |
| 6 | 全体プレビュー・新規章作成・レイアウト磨き（比率可変・折りたたみ） | E2E完了条件3の全体版＋新規章 |

各ステップで typecheck / lint。ステップ4以降で security-reviewer。E2Eはアプリ内ブラウザペインで <poc-repo> に対して実施（実コミットが発生するため、検証後は履歴に残ってよいリポジトリであることを確認済み——検証リポジトリの本来の用途）。

## 11. スコープ外（Phase 3以降へ）

- コメント一覧UI・ルビ入力補助・字数/ページ数見積り
- 画像アップロード（D&D→コミット＋記法挿入）
- `book.config.js`・奥付・判型設定のフォームUI（`entry` への章追記の自動化を含む）
- 入稿ビルドのUI起動（タグ作成代行）
- ~~ブランチ切替・作成・PR連携（デフォルトブランチのみで開始）~~ → **phase5 で実装済み**（Issue #21・2026-07-23。SPEC-vertical-editor-phase5）
- テーマCSS・`book.config.js` のアプリ内編集・判型切替UI
- スマホの入力/プレビュータブ切替（崩れない表示まで）
- ネコノテのレビュー・校正・進捗機能の変更（回帰しないことのみ確認）

## 12. 決定事項（インタビュー結果・2026-07-16）

| # | 論点 | 決定 |
|---|---|---|
| A | 対象リポジトリの解決 | **既存 `projects.repo/base_path` を共有**。竜の巣の設定を <poc-repo> へ切り替える（スキーマ変更なし。校正・進捗も同じVFM原稿を見る） |
| B | ルーティング | **`/projects/[id]/editor`**（プロジェクト配下・board / manuscript と同列） |
| C | 全体プレビュー | **Phase 2 に含める**（明示操作・目次ページなしの制約つき） |
| D | 快適性の取捨 | **新規章ファイル作成は含める**。スマホのタブ切替は Phase 3 へ（崩れない表示まで） |
| E | ブランチ対応 | **デフォルトブランチのみ**。切替・作成UIは後続フェーズ |

## 13. E2E検証手順

1. 竜の巣プロジェクトからエディタを開く → 章一覧が `entry` 順に出る
2. 章を開く → 本文がCodeMirrorに表示され、数秒後に縦書きプレビュー（文庫A6・ページ分割・ノンブル）が出る
3. 本文を編集 → デバウンス後にプレビューへ反映。ルビ・コメントがハイライトされる
4. 未保存のままリロード → 復元バナー → 復元で編集が戻る
5. `Cmd+S` → メッセージ編集 → コミット → GitHub上にコミットが存在し、リロード後も保存済み内容が出る
6. 別経路（gh CLI）で同ファイルを更新してから保存 → 日本語の競合メッセージ → マージビューで取り込み → 再保存が成功する
7. 画像入りの章でプレビューに挿絵が表示される（プロキシ経由）。未ログインでプロキシURLを直叩きすると拒否される
8. 全体プレビューを明示操作で起動 → 全章が `entry` 順に結合され、通しのページ分割・ノンブルが出る（目次ページなしの注記が表示される）
9. 新規章ファイルを作成 → 雛形入りでコミットされ、一覧に「entry未登録」印つきで現れる。既存名と衝突させると日本語エラー
10. 回帰: 原稿タブ（校正）・進捗集計が <poc-repo> のVFM原稿に対して従来どおり動く
