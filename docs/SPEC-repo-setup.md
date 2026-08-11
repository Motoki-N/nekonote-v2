# SPEC: 原稿リポジトリの初期セットアップ（Issue #121）

## 1. 目的と背景

新しい原稿リポジトリの作成は、これまで手動手順（manual.md §8: テンプレートをローカルへコピー → 置換 → git push）だった。ソースコードをクローンしていない環境（別PC・タブレット等）では新規作品を始められず、Git の知識も要求される。

本機能は、**repo / base_path の初回設定時に、アプリ内から GitHub API 経由でテンプレートを展開する**初期セットアップを提供する。原稿の実体を GitHub に置き、アプリは DB に原稿を持たないという基本方針（要求仕様ドキュメント）は変えない。

## 2. 前提

- ユーザーが GitHub 上で原稿用リポジトリを新規作成済み（空でも README 付きでもよい）
- Fine-grained PAT が登録済みで、対象リポジトリに以下の権限があること
  - **Contents: Read and write**（従来どおり）
  - **Workflows: Read and write**（`.github/workflows/` をAPIで書き込むために必要。無いとセットアップが失敗する）
- テンプレートの実体はアプリリポジトリの `docs/templates/manuscript-repo/`（全ファイルがテキスト。単一情報源であり、本機能のための複製は持たない）

## 3. UIフロー

### 3.1 起動タイミング

プロジェクト編集ダイアログ（`components/projects/project-form-dialog.tsx`）で、**repo が「未設定 → 設定」に変わって保存に成功したとき**、続けてセットアップダイアログを開く。

- repo を変更しただけ（設定済み → 別リポジトリ）の場合は開かない（誤爆防止。必要なら再度 repo を空にして設定し直せば起動できる）
- セットアップはスキップ（キャンセル）できる。スキップしても repo / base_path の保存自体は完了している

### 3.2 セットアップダイアログ（`components/projects/repo-setup-dialog.tsx`）

入力フィールド:

| 項目 | 既定値 | 検証 |
|---|---|---|
| 作品タイトル | プロジェクトのタイトル | 必須・100文字以内 |
| 著者名 | （空） | 必須・100文字以内 |
| 出力ファイル名（slug） | リポジトリ名 | `^[a-z0-9][a-z0-9-]*$`・50文字以内 |

注意書きとして明示するもの:

- リポジトリに既にファイルがある場合、**全ファイルが `backup-<日時>/` へ退避**されてからテンプレートが展開される
- セットアップ完了時に **base_path は空（リポジトリルート）に自動設定**される（別の値を設定していても上書き。base_path は「プロジェクトルート＝book.config.js のある階層」を指す規約——SPEC-vertical-editor-phase2 §7。Issue #176 で `manuscripts` 設定がエディタ章一覧を壊すことが判明し修正）
- PAT に **Workflows: Read and write** 権限が必要

実行中はボタンを無効化し進行中表示。成功したらトースト＋ダイアログを閉じて画面を更新。失敗したら AppError 由来の日本語メッセージを表示する（ダイアログは開いたままにし、再実行できる）。

## 4. サーバー処理

### 4.1 Server Action: `setupManuscriptRepo(projectId, input)`（`lib/actions/repo-setup.ts`）

1. projectId / input を zod で検証（スキーマは `lib/schemas/projects.ts` の `repoSetupInputSchema`）
2. RLS 越しに project を取得。`repo` 未設定なら validation エラー
3. `patCredentialProvider`（`lib/git/credentials.ts`）で PAT を復号。未登録なら validation エラー
4. テンプレートを読み込み・置換（§4.2）
5. GitHub へ 1 コミットで反映（§4.3）
6. 成功後、`projects.base_path = ''`（ルート）に更新し、`revalidatePath`

### 4.2 テンプレート読み込みと置換（`lib/git/template.ts`）

- `docs/templates/manuscript-repo/` を fs で再帰的に読む（Vercel では `next.config.ts` の `outputFileTracingIncludes` でバンドルに含める）
- 除外: `images/.gitignore`（検証用に画像をGit管理から外す設定。実作品では挿絵をGit管理するため展開しない。manual §8 手順3 に対応）
- 全テキストファイルに対する置換:
  - `竜の巣` → 作品タイトル
  - `灰谷 汀` → 著者名
  - `ryu-no-su` → slug（出力ファイル名・check:pages のパス等）
  - `manuscript-repo-template`（package.json の name）→ slug

置換はサンプル値の文字列置換であり、テンプレート側がこの3つの目印を維持することが本機能の前提（テンプレートを変更する際の制約としてテンプレート README にも明記する）。

### 4.3 GitHub への反映（Git Data API）

すべての変更（退避＋テンプレート展開）を原則 **1 コミット**で行う。コミットメッセージは「原稿リポジトリを初期セットアップ（ネコノテAI）」。

1. デフォルトブランチ名を取得（`getDefaultBranch`）
2. ブランチ HEAD を取得。**404/409 なら空リポジトリ**（`getBranchHeadShaOrNull`）
3. **空リポジトリの場合**: コミットが1つもないリポジトリには Git Data API（trees / commits）自体が 409 を返すという GitHub API の制約があるため、まず Contents API（`createFileContent`）で README.md を書いて初回コミットを作り、以降は非空として続行する（この場合のみ計2コミットになる）
4. 全ファイルの path＋blob SHA を取得（`getFullTree`）し、既存ファイルがあればツリーエントリを作る
   - 退避: 既存の各ファイルについて `{ path: "backup-<YYYYMMDD-HHmmss>/<元パス>", sha: <既存blob> }`（内容の再アップロードなしで移動できる。mode は元の値を保持）
   - 削除: `{ path: <元パス>, sha: null }`。ただしテンプレートが同じパスを書く場合は、同一ツリー内の削除＋追加の衝突を避けるため削除エントリを出さない（追加が上書きする）
5. テンプレートファイルは `{ path, content }`（UTF-8 テキストとして API が blob 化する）
6. `createTree`（`base_tree` = HEAD のツリー）→ `createCommit`（parent = HEAD）→ `updateBranchRef`（fast-forward。HEAD 取得後に他所から push があれば conflict）

エラー正規化（`AppError`）:

- Workflows 権限不足（403/422 で workflow 文言）→ validation「PATに Workflows: Read and write 権限が必要です…」
- その他は既存の `toGithubError` に準ずる（401/403 = PAT、404 = リポジトリ不達）

### 4.4 やらないこと

- リポジトリの新規作成そのもの（PAT に Administration 権限を要求しないため。ユーザーが GitHub 上で作る）
- 差分マージや選択的展開（既存ファイルは全退避で単純化）
- ローカル git / push（Contents・Git Data API のコミットは即リモート反映されるため push という工程がない）

## 5. セキュリティ

- PAT は既存の `patCredentialProvider` 経由でサーバー内のみで復号し、クライアントへ返さない
- repo は既存の `validRepo`（`repoSchema` 再検証)を通す
- slug・タイトル・著者名はサーバー側でも zod 検証（ファイルパスには slug を使わない。パスはテンプレート由来の固定値のみ）
- 秘密情報の取り扱いに触れるため、実装時は security-reviewer のレビューを必須とする

## 6. 検証

- typecheck / lint
- UIフロー（編集ダイアログ → セットアップダイアログ）
- テスト用リポジトリ（空／README あり）への実行: 1コミットで展開・全ファイル退避・base_path 自動設定・エディタタブで章一覧が出ること
