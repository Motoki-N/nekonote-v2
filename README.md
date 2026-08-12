# 🐱 ネコノテAI（第二期）

小説執筆を支援するWebアプリ。小説そのものは人間が執筆し、AIはペルソナを持つエージェント（担当編集・校正さん・アシスタント等）として、構想のネタ出し・企画レビュー・構成設計・校正の各フェーズに伴走する。原稿の実体はGitHubリポジトリで管理し、本アプリはレビューと進捗管理に専念する。

## 主な機能

- **ペルソナ制AIレビュー**: 企画書・構成・原稿を、役割の異なるAIエージェントがレビュー（Anthropic / OpenAI / Google をマルチプロバイダで呼び分け）
- **手帳（ノート）**: ネタ・設定を貯める自由記述ノート＋タグ・テンプレート・版履歴
- **ビートボード / 目次ボード**: 章・シーン単位の構成管理と進捗集計（小説は6種の構成テンプレート、技術書等は目次形式）
- **原稿連携**: GitHub上の原稿リポジトリを読み書き（校正の書き戻し・Webエディタ・縦書きプレビュー・Vivliostyleによる入稿PDF/EPUBビルド）
- **対話型ペルソナ**: 構想の壁打ちと執筆スケジュールの提案・管理（締切リマインドメール付き）
- **アトリエ**: 表紙・挿絵・キャラクター・コンセプトアートのイラスト生成
- **Zenn連携**: Zenn記事リポジトリへの直接執筆・投稿

## 技術スタック

- Next.js（App Router）+ TypeScript（strict）
- UI: shadcn/ui + Tailwind CSS
- DB/認証: Supabase（PostgreSQL + Auth、全テーブルRLS）
- AI: Vercel AI SDK
- デプロイ: Vercel

## 重要な設計前提

本アプリは**単一ユーザー（もしくはごく少人数の許可リスト制）での運用を前提**としている。

- 認証はメール許可リストのフェイルクローズ2層ゲート（環境変数＋DBテーブル）。リストが空なら誰もログインできない
- レートリミットはインメモリ方式で、サーバーレスのインスタンス間では共有されない
- 不特定多数向けサービスとして運用する場合は上記の見直しが必要（[SECURITY.md](SECURITY.md) 参照）

## セットアップ

### 1. Supabase プロジェクトの作成とマイグレーション適用

[Supabase](https://supabase.com/) でプロジェクトを作成し、CLIでリンクしてマイグレーションを適用する。

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**注意**: `supabase/migrations/20260712000001_auth_allowlist.sql` の許可リスト投入行はコメントアウトされている。適用前に自分のメールアドレスへ書き換えるか、適用後に Supabase の SQL Editor から `insert into private.auth_allowlist (email) values ('you@example.com');` を実行すること（未投入だと全サインアップが拒否される）。

あわせて Supabase Dashboard で Google OAuth プロバイダを設定する（詳細は [docs/SPEC-auth.md](docs/SPEC-auth.md)）。

### 2. 環境変数の設定

```bash
cp .env.local.example .env.local
```

| 変数                                                                    | 用途                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`            | Supabase 接続情報                                                  |
| `ALLOWED_EMAILS`                                                        | ログインを許可するメール（カンマ区切り。DB側許可リストと手動同期） |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | AIプロバイダのAPIキー（使うものだけでよい）                        |
| `ENCRYPTION_KEY`                                                        | GitHub PAT の暗号化キー（32バイトのbase64。再発行不能）            |
| `SUPABASE_SERVICE_ROLE_KEY`                                             | cron（締切リマインド）用。クライアントへ露出しないこと             |
| `RESEND_API_KEY` / `REMINDER_FROM_EMAIL` / `CRON_SECRET`                | リマインドメール送信と cron 認証                                   |

### 3. 起動

```bash
npm install
npm run dev
```

`postinstall` で Vivliostyle Viewer が `public/vivliostyle/` へコピーされる（縦書きプレビュー用）。

### 検証コマンド

```bash
npm run typecheck
npm run lint
```

## ドキュメント

- [変更履歴（CHANGELOG）](CHANGELOG.md)
- [ユーザーマニュアル](docs/manual.md)
- [運用ランブック（RUNBOOK）](docs/RUNBOOK.md)
- [要求仕様](docs/ネコノテAI_第二期_要求仕様ドキュメント.md)
- [実装計画](docs/ネコノテAI_第二期_実装計画.md)
- [機能仕様の索引（SPEC-index.md）](docs/SPEC-index.md)
- [Claude Code 運用計画](docs/claude-code-operation-plan.md)
- [開発ログ](docs/dev-log.md)
- [開発記録（書籍ドラフト）](docs/dev-story/README.md)

## ライセンス

[MIT](LICENSE)
