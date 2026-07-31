# SPEC-zenn-integration: Zenn連携（記事の新規投稿）

作成日: 2026-07-25（Issue #126 のインタビュー駆動で策定）
改訂: 2026-07-30（Issue #132・§11 画像アップロードを追加。§9 から画像アップロードを除外）
ステータス: **確定**（2026-07-25 レビュー済み・プラン承認をもって設計確認とする）
起点Issue: #126（ネコノテで執筆した記事をGitHub経由でZennへ投稿したい）

## 1. 目的

技術書執筆と技術ブログのシナジーを活かすため、ネコノテからZenn連携リポジトリ
（GitHub連携済みの `<owner>/zenn-docs` 等）へ記事を直接執筆・投稿できるようにする。
Zenn の GitHub 連携（リポジトリへの push が即デプロイ）はネコノテの
「原稿の実体はGitHub」という思想と相性がよく、記事本文もDBに持たない。

## 2. 決定事項（インタビュー結果・2026-07-25）

| 論点 | 決定 |
|---|---|
| 記事の実体 | Zenn連携リポジトリの `articles/<slug>.md` を直接編集。**DBに本文を持たない**（原稿リポジトリと同じ思想） |
| 投稿フロー | デフォルトブランチ（main）へ直接コミット。Zenn側が自動デプロイ |
| スコープ | **新規投稿のみ**。既存記事の一覧・開き直し編集はスコープ外。ただし執筆画面を開いている間の再保存（同一ファイルへの再コミット）は可 |
| 設定保存 | `user_settings.zenn_repo`（owner/repo形式テキスト）を追加。/settings から登録 |
| 執筆UI | CodeMirror の Markdown 直接編集 + `zenn-markdown-html` によるZennと同じ見た目のプレビュー（2ペイン） |
| slug | 自動生成（Zenn仕様: `[a-z0-9_-]{12,50}`）＋手直し可。バリデーション付き |
| published | フォームで選択可（**デフォルト false**）。コミット前の確認ダイアログで毎回明示 |
| frontmatter | title / emoji / type (tech\|idea) / topics (最大5) / published をフォーム入力し、サーバー側で合成 |

決定の背景（インタビューで確認）:

- **Markdown直接編集を選んだ理由**: Zenn独自記法（```js:ファイル名、`:::message`、URL埋め込み等）を
  壊さないこと。また将来「Zenn記事→技術書（Vivliostyle組版）」の流用構想があり、
  `zenn-markdown-html` でHTML化→Vivliostyleへ渡すパイプラインの素材として
  Markdownソースそのものが成果物である必要がある
- ノートのリッチエディタ（TipTap）流用は、変換の方式差でZenn独自記法が残せないため不採用

## 3. 画面とUX

### 3.1 設定画面（/settings）

- 「Zenn連携」セクションを GitHub連携セクションの直後に追加
- 未登録: `owner/repo` 入力フォーム＋登録ボタン。登録時にサーバーで形式検証＋
  `getDefaultBranch` による疎通検証（タイポ・PAT権限不足をここで弾く）
- 登録済み: リポジトリ名表示＋差し替え＋削除（`github-connection.tsx` と同型のUI）
- 前提: GitHub PAT が登録済みであること（未登録なら「先にPATを登録してください」）。
  PATの対象リポジトリに zenn-docs を含める必要がある旨をヘルプテキストに明記

### 3.2 投稿画面（/zenn/new）

- グローバルナビに「Zenn」を追加（行き先・ハイライトとも `/zenn/new`。将来 `/zenn` 一覧を
  作る際は href を `/zenn` へ変更する）
- ゲート表示（`getEditorWorkspace` と同じ gate 方式）:
  - PAT未登録 → 設定画面への誘導文
  - zenn_repo 未登録 → 設定画面への誘導文
- 本体は2ペイン（モバイルはタブ切替でなく縦積み）:
  - 上部: frontmatterフォーム（タイトル・絵文字・type・topics・slug・公開チェック）
  - 左: CodeMirror Markdownエディタ（横書き・折り返し）
  - 右: Zennプレビュー（`zenn-markdown-html` の出力を `.znc` コンテナで表示、300msデバウンス）
- slug: 初期表示時に自動生成（`crypto.randomUUID()` のhex 14字）。手直し可。
  **初回コミット後は変更不可（disabled）**——変更すると別ファイルになるため
- 保存ボタン → 確認ダイアログ（3.3）→ コミット。初回は新規作成、以降は同一ファイルへの
  再コミット（楽観ロック）。成功トーストにコミット先（repo/articles/slug.md）を表示
- 未保存変更があるままの離脱は beforeunload で警告（IndexedDB待避はスコープ外）

### 3.3 公開確認ダイアログ（誤爆防止）

- コミット前に必ず表示: リポジトリ名・ファイルパス・公開状態を明示
- `published: false` →「下書きとして投稿します（Zennには公開されません）」
- `published: true` →「**公開記事として投稿します。コミットと同時にZennで公開されます**」を
  強調表示（`text-destructive` 等のテーマ変数。色のハードコード禁止）
- published のデフォルトは常に false。サーバー側も boolean を明示的に受けるのみで
  隠れたデフォルトを持たない

### 3.4 プレビューのテーマ例外

`.znc` コンテナ内は「Zennと同じ見た目」が目的の例外領域として、`zenn-content-css` の
スタイル＋ライト背景固定とする（アプリ側ダークテーマでも切り替えない）。
縦書きエディタのVivliostyleテーマプレビューと同じ扱い。周囲のUI（フォーム・ボタン）は
通常どおりテーマ用CSS変数のみを使う。

## 4. API・データフロー

新規APIルートは作らない。Server Actions（`lib/actions/zenn.ts`）のみ。

```
loadZennContext()（内部関数）
  認証 → user_settings から zenn_repo 取得（RLS越し・null は AppError validation）
  → repoSchema.parse で使用時再検証 → patCredentialProvider.getCredential
  → { userId, repo, token }

getZennWorkspace(): ActionResult<
  | { gate: 'no_pat' } | { gate: 'no_zenn_repo' }
  | { gate: 'ok'; repo: string; defaultBranch: string }>
  // defaultBranch 取得が疎通確認を兼ねる

publishZennArticle(input: ZennArticleInput):
  ActionResult<{ path: string; commitSha: string; blobSha: string }>
  // zod検証 → buildZennArticleFile で合成 → createFileContent(articles/<slug>.md)
  // slug衝突: 事前の存在確認GETはしない（TOCTOU回避）。sha なしPUTの409/422を
  // createFileContent が conflict に正規化するので、それを slug 文脈の文言
  // 「このslugの記事が既に存在します。slugを変更してください」に置換して表示。1往復で原子的

saveZennArticle(input: ZennArticleInput & { baseSha: string }):
  ActionResult<{ commitSha: string; blobSha: string }>
  // putFileContent の楽観ロック（saveChapter と同一作法）。
  // 成功のたび戻り値 blobSha でクライアントの baseSha を進める。
  // リモート先行更新（Zenn/GitHub側で編集された）は conflict の日本語エラー
```

- ブランチは常に省略（=デフォルトブランチへ直接コミット。既存APIの省略時挙動どおり）
- コミットメッセージは固定: `Zenn: articles/<slug>.md を新規作成（ネコノテAI）` /
  `Zenn: articles/<slug>.md を更新（ネコノテAI）`
- レート制限: 書き込み系に `enforceRateLimit(userId, 'zenn-save', { perMinute: 12, perDay: 600 })`
  （editor-save と同水準）

設定側（`lib/actions/settings.ts` に追加）:

```
getZennRepo(): ActionResult<{ repo: string | null }>
registerZennRepo(repo): repoSchema.parse → PAT取得（未登録はエラー）
  → getDefaultBranch で疎通検証 → user_settings に upsert
deleteZennRepo(): zenn_repo を null に update
```

## 5. frontmatter 仕様

`lib/zenn/frontmatter.ts` の純関数 `buildZennArticleFile(input)`（`server-only`）で合成する。

- 出力はフラット5キー固定。YAML 1.2 はJSONの上位集合なので、文字列・配列は
  **`JSON.stringify` の二重引用符スカラー/フロー配列**として出力する。
  これでコロン・引用符・絵文字・バックスラッシュを含む title でも常に正しいYAMLになる
  （js-yaml 等の依存追加はしない）

```yaml
---
title: "\"引用符\"と: コロンも安全"
emoji: "🐱"
type: "tech"
topics: ["nextjs","supabase"]
published: false
---
```

zodスキーマ（`lib/schemas/zenn.ts`）:

| フィールド | 検証 |
|---|---|
| slug | `/^[a-z0-9_-]{12,50}$/`（Zenn仕様どおり） |
| title | trim・1〜100字・改行/制御文字拒否 |
| emoji | trim・1〜16字（ZWJ合成絵文字はUTF-16で10単位超のため）・空白/改行拒否（厳密な絵文字判定はせずZenn側検証に委ねる） |
| type | `'tech' \| 'idea'` |
| topics | 0〜5件・各 trim 1〜50字・制御文字拒否・重複除去 |
| published | boolean |
| body | 最大200,000字（GitHub Contents API 1MB制限に余裕を持たせる） |

## 6. スキーマ（マイグレーション）

`supabase/migrations/20260725000001_zenn_repo.sql`:

```sql
alter table public.user_settings add column zenn_repo text;
```

- 検証はアプリ層（登録時・使用時の二重で `repoSchema`）。DB制約は付けない
- RLSは既存の user_settings 本人のみポリシーがそのまま効く（`20260713000003` の先例どおり
  追加ポリシー不要）
- 適用後 `npm run db:types` で `lib/database.types.ts` を再生成

## 7. 対象ファイル

| ファイル | 変更 |
|---|---|
| `supabase/migrations/20260725000001_zenn_repo.sql` | 新規（§6） |
| `lib/schemas/zenn.ts` | 新規（slug・記事入力のzod） |
| `lib/zenn/frontmatter.ts` | 新規（合成純関数・server-only） |
| `lib/actions/zenn.ts` | 新規（getZennWorkspace / publishZennArticle / saveZennArticle） |
| `lib/actions/settings.ts` | getZennRepo / registerZennRepo / deleteZennRepo 追加 |
| `app/(app)/zenn/new/page.tsx` | 新規（投稿画面ルート） |
| `components/zenn/zenn-workspace.tsx` | 新規（クライアント親。フォーム＋2ペイン＋baseSha管理） |
| `components/zenn/frontmatter-form.tsx` | 新規（frontmatter入力＋slug自動生成） |
| `components/zenn/zenn-codemirror.ts` | 新規（横書きMarkdown用の最小CodeMirror拡張。縦書き用 `components/editor/codemirror.ts` はVFM前提のため流用しない） |
| `components/zenn/zenn-preview.tsx` | 新規（zenn-markdown-html・遅延ロード・znc） |
| `components/zenn/publish-dialog.tsx` | 新規（公開確認ダイアログ） |
| `components/settings/zenn-repo-settings.tsx` | 新規（設定セクションUI） |
| `app/(app)/settings/page.tsx` | Zenn連携セクション追加 |
| `components/layout/app-header.tsx` | ナビに「Zenn」追加 |
| `lib/database.types.ts` | 再生成 |
| `package.json` | `zenn-markdown-html` / `zenn-content-css` 追加 |

## 8. セキュリティ

- 全アクションで `supabase.auth.getUser()` 必須。zenn_repo・PATはRLS越しに本人行のみ。
  復号トークンはコンテキスト内に閉じ、戻り値・ログに含めない
- zenn_repo は登録時（repoSchema＋疎通）と使用時（repoSchema、さらに github.ts の
  validRepo）の多層検証
- ファイルパスはサーバーで `articles/${slug}.md` を合成。slug は `[a-z0-9_-]` のみで
  パストラバーサル不能。クライアントから生パスは受け取らない
- published はデフォルト false＋確認ダイアログで毎回明示（誤公開防止）
- プレビューの `dangerouslySetInnerHTML` は本人がいま入力中の本文のみが入力
  （self-XSSの範囲。リモート由来コンテンツは描画しない。embedOrigin 無効のため iframe も生成されない）
- PAT復号を伴う Server Action の追加のため **security-reviewer を必ず通す**

## 9. スコープ外（次期以降）

- 既存記事の一覧・開き直し編集・published切替・削除
- 埋め込みプレビュー（embedOrigin。リンク・カード・ツイート等はプレビュー上ではリンク表示）
- books/（Zennの本）対応・「Zenn記事→技術書」ビルドパイプライン
- KaTeX数式CSS・mermaid のプレビュー完全対応
- 初回コミット後のslug変更（リネーム）
- ノートからの記事化（ノート本文の取り込み）
- IndexedDB への下書き待避

## 10. E2E検証手順

1. **設定登録**: /settings で `<owner>/zenn-docs` を登録→表示反映。不正形式（`foo`）と
   存在しないrepo（`<owner>/no-such-repo`）で日本語エラー
2. **ゲート**: zenn_repo 未登録状態で /zenn/new → 設定への誘導表示（PAT未登録側の誘導は
   実PATを消さずコード確認で代替可）
3. **slug検証**: 自動生成値が `[a-z0-9_-]{12,50}` を満たす。11字に手直し→エラー、大文字→エラー
4. **frontmatter安全性**: title に `"引用符"と: コロン` を含め published オフで投稿 →
   GitHub上の `articles/<slug>.md` の frontmatter が壊れていない・`published: false`
5. **再保存**: 投稿後に本文を編集→再保存→同一ファイルに2コミット目（conflictにならない）
6. **競合検知**: GitHub Web で同ファイルを直接編集→ネコノテから再保存→conflict の日本語エラー
7. **slug重複**: 既存記事と同じ slug で新規投稿→「このslugの記事が既に存在します」
8. **公開投稿**: published チェックオン→確認ダイアログの強調表示→コミット→Zenn側に反映
9. **プレビュー**: `:::message`・ファイル名つきコードブロックがZennの見た目で表示。
   アプリをダークテーマにしてもプレビューはライト背景のまま。フォーム・ボタンはテーマ追従
10. **回帰**: 既存の原稿タブ・縦書きエディタ・設定画面（PAT登録）が従来どおり動く

## 11. 画像アップロード（Issue #132・2026-07-30 改訂）

§9 でスコープ外としていた「画像アップロード」を実装する（#128 のドッグフーディング実需）。

### 11.1 決定事項

| 論点 | 決定 |
|---|---|
| 配置先 | `images/<slug>/`（Zenn公式推奨の記事ごとフォルダ分け。Zennはリポジトリルート `/images` 配下の任意サブフォルダを認める） |
| 本文への挿入記法 | `![<ファイル名のstem>](/images/<slug>/<ファイル名>)`（Zennは `/images/` 始まりの絶対パス参照） |
| 挿入トリガー | ヘッダーの「画像を挿入」ボタンのみ（ファイル選択→即コミット→カーソル位置へ記法挿入）。D&D・クリップボードペーストはスコープ外 |
| 制約 | Zenn仕様に合わせ 1枚 **3MB以内**・png / jpg / jpeg / webp / gif のみ |
| コミット方式 | アップロード＝即コミット（縦書きエディタ phase3 §6 と同じ「本文とは独立に画像だけ先にコミット」方式）。同名衝突は `-2` からの連番リネームで自動回避（最大5回） |
| プレビュー | アップロード時にブラウザ内で保持した Blob URL を `/images/...` パスへ割り当てて表示。**新規APIルート・PATプロキシは作らない**（この画面で上げた画像のみ表示＝「新規投稿のみ」の現行スコープと一致。リロード後のプレビューには出ないが、参照パス自体は正しい） |
| slug変更との関係 | 初回コミット前に slug を変えても、挿入済み記法はアップロード先の実パスを指すため壊れない（フォルダ名と最終slugがズレるだけ・許容） |

### 11.2 Server Action（lib/actions/zenn.ts に追加）

```
uploadZennImage(slug, fileName, base64Content):
  ActionResult<{ path: string; fileName: string }>
  // loadZennContext → enforceRateLimit(userId, 'zenn-upload', { perMinute: 6, perDay: 100 })
  //   （editor-upload と同水準）
  // zennSlugSchema / zennImageFileNameSchema / zennImageBase64Schema（3MB・二段検査）で検証
  // パスはサーバーで images/<slug>/<name> を合成（クライアントから生パスは受け取らない）
  // createBinaryFileContent で即コミット。conflict は連番リネームで再試行
  // 戻り値 path はリポジトリパス（images/<slug>/<name>）。記法の先頭 / はクライアントで付す
```

### 11.3 セキュリティ

- パス成分は slug（`[a-z0-9_-]{12,50}`）とファイル名（英数字始まり・英数と `._-` のみ・
  `..` 拒否・拡張子allowlist）のみで合成し、パストラバーサル不能
- base64 は正規表現＋長さの粗検査に加え、デコード後バイト数で 3MB を再検査（二段）
- PAT復号を伴う Server Action の追加のため **security-reviewer を必ず通す**（§8 どおり）

### 11.4 対象ファイル

| ファイル | 変更 |
|---|---|
| `lib/schemas/zenn.ts` | zennImageFileNameSchema / zennImageBase64Schema / ZENN_MAX_IMAGE_BYTES 追加 |
| `lib/actions/zenn.ts` | uploadZennImage 追加 |
| `components/zenn/zenn-workspace.tsx` | 「画像を挿入」ボタン・アップロード→記法挿入・Blob URL管理 |
| `components/zenn/zenn-preview.tsx` | imageUrls による `/images/...` → Blob URL の差し替え |

クライアントの `sanitizeImageFileName` / `fileToBase64` は `lib/editor/image.ts` を流用する
（汎用ユーティリティのため。挿入記法だけはZenn形式なので流用しない）。

### 11.5 E2E検証手順（追加分）

1. 画像を選択→`images/<slug>/<name>` へコミットされ、カーソル位置に
   `![stem](/images/<slug>/<name>)` が挿入される。プレビューに画像が表示される
2. 同名ファイルを再アップロード→`-2` 連番でコミットされる
3. 3MB超の画像→アップロード前に日本語エラーで拒否（コミットされない）
4. 非対応形式（svg等）→拒否
5. 記事本文の保存フローが従来どおり動く（画像コミットと本文コミットが独立）
