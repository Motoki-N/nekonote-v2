# ネコノテAI 第二期 開発ログ

技術書典21（11/23）向けの記録。うまくいったプロンプト・失敗パターン・hooks / skills の改善履歴を週末に追記する。

---

## 2026-07-12

- 第二期リポジトリ `nekonote-v2` を初期化。第二期3ドキュメント（要求仕様・実装計画・Claude Code運用計画）を `docs/` に配置
- CLAUDE.md v2 草案を作成（第一期の詳細指示書型 → 短い常駐コンテキスト＋SPEC分業型への転換）

### セッション①: フェーズ0環境整備＋SPEC-auth策定＋開発計画

- **hooks 3種を設定**（typecheck / lint / migration-guard、`.claude/settings.json`）
  - 設定前にコマンド単体を「合成したstdin JSONをパイプして検証」する手法が有効だった（設定してから壊れているのに気づくより早い）
  - 学び: zshはパイプ末尾を現在シェルで実行するため、`exit`入りフックコマンドのテストは `bash -c` 経由で行う
  - 学び: セッション開始時に存在しなかった settings.json は同一セッション内では発火しない（次セッションから有効）
  - 設計判断: migration-guard は完全ブロック（deny）でなく**確認（ask）**にした。denyだとプランモード承認後の正規マイグレーション作成まで塞いでしまい運用と矛盾するため
  - package.json 未整備の段階でも壊れないよう「scripts.typecheck / eslint が存在するまで自動スキップ」のガードを入れた（スキャフォールド時に無変更で自動有効化）
- **SPEC-auth.md をインタビュー駆動で策定**: AskUserQuestion 2ラウンド8問。「自明な質問でなくエッジケースを掘る」方針が機能した
  - 1巡目（方針）: 登録制御→メール許可リスト／セッション寿命→実質無期限／複数デバイス→無制限／切断時→ドラフト退避
  - 2巡目（1巡目から派生する落とし穴）: 拒否タイミング→DBトリガーでauth.users作成自体を拒否／リスト管理→環境変数／Vercelプレビューは OAuth リダイレクトと相性が悪い→本番＋localhostのみ対応／PAT→スコープ外（GitHub連携SPECへ）
  - 対象ファイル・スコープ外・E2E検証手順9項目を必須構成として含めた
- **開発計画を具体化**: 実装計画Draft v1のスプリント枠組みを、日次のセッション計画（1機能=1セッション、各スプリント初日朝にSPECインタビューを組込み）に展開。スコープカット判断日 7/25
- **フェーズ0完遂**: skills 3種（story-engineering / draft-to-clean-model / review-profiles）＋ security-reviewer subagent を配置、gh CLI 認証確認（失効トークンの再ログインはユーザー実施）

### セッション②: Next.jsスキャフォールド＋テーマ基盤＋初回Vercelデプロイ

- Next.js 16.2.10（App Router / TypeScript strict / Tailwind v4 / ESLint 9）をスキャフォールド。既存リポジトリと衝突するREADME・CLAUDE.md等は除外してマージ
- shadcn/ui 初期化（base-nova プリセット、CSS変数テーマ）＋ next-themes でライト/ダーク切り替えの土台。コンポーネントはテーマ変数（`bg-background` 等）のみ使用
- `typecheck` スクリプト追加。**hooks 3種の実地発火を確認**（.tsx編集ごとにtypecheck/eslintが自動実行され通過）— フェーズ0の宿題完了
- typecheck / lint / build 全通過。ブラウザでテーマ切り替え（ダーク⇄ライト、localStorage永続化）を動作確認
- 既知の残課題: `npm audit` にnext同梱postcssのmoderate 2件（fix はnext@9への破壊的ダウングレードのため見送り）
- Vercel初回デプロイ完了: プロジェクト `nekonote-v2` を作成・リンクし、本番URL **https://nekonote-v2.vercel.app** で稼働確認（CLI認証はデバイスフローでユーザーが承認）
- Sprint 0 残タスク: 認証（SPEC-auth実装）、DBスキーマ全体のマイグレーション＋Zod＋型生成、AppError＋共通ハンドラー、GitHubリポジトリ連携（vercel.link/git で自動デプロイ化も検討）
- GitHubリモート設定完了（ユーザー作業）: https://github.com/Motoki-N/nekonote-v2

### セッション③: 認証実装（SPEC-auth）＋AppError

- AppError＋共通ハンドラー（`lib/errors.ts`）: code→status マッピング、internal の詳細はログのみでクライアントには固定文言
- 認証一式を SPEC-auth 準拠で実装:
  - `@supabase/ssr` Cookieセッション＋ `middleware.ts` で全リクエスト `getUser()`（リフレッシュをユーザー操作に依存させない）
  - `/login`（Google OAuth PKCE）・`/auth/callback`・`/logout`（POST限定）
  - 許可リスト2層ゲート: DBトリガー（`supabase/migrations/20260712000001_auth_allowlist.sql`）＋ middleware の `ALLOWED_EMAILS` チェック。両層フェイルクローズ
  - returnTo はサイト内パスのみ許可（オープンリダイレクト対策、login/callback 両方でサニタイズ）
- **security-reviewer 必須ゲート通過**: Critical/High なし。Medium 2件を修正（internal エラーメッセージ漏洩、`ALTER DATABASE ... SET` の既存接続非反映の運用注意）
- 学び: middleware.ts を後から追加すると Next.js dev サーバーは再起動が必要（「Cannot find the middleware module」）
- 未完了（外部セットアップ待ち）: Supabaseプロジェクト作成、Google OAuth設定、Vercel/ローカルのenv設定、マイグレーション適用、E2E検証1〜9
- 次セッション: DBスキーマ全体（プランモード承認→マイグレーション→Zod＋型生成）

### セッション④: Supabase外部セットアップの検証＋マイグレーション適用

- ユーザー設定の検証で2件の不備を発見・解消:
  1. `.env.local` の SUPABASE_URL に RESTエンドポイント（`/rest/v1/` 付き）が入っていた → ベースURLに修正
  2. Googleプロバイダが「トグルONだがシークレット未登録」（authorize が `missing OAuth secret`）→ ユーザーが登録して解消
- 検証手法メモ: `GET /auth/v1/settings`（プロバイダ有効状態）と `GET /auth/v1/authorize?provider=google` の302先で、ダッシュボードを見ずにOAuth設定を外形検証できる
- **`ALTER DATABASE ... SET` はホスト版Supabaseで権限エラー（42501）**。postgresロールはDB所有者ではない（supabase_admin所有）。許可リストをGUC方式→ `private.auth_allowlist` テーブル方式に変更（SPEC-auth 4.2改訂）。怪我の功名でGUCの接続キャッシュ問題も解消
- security-reviewer 差分レビュー通過（新規Critical/High/Mediumなし）→ `supabase db push` で適用完了（migration list で local/remote 一致確認）
- 残: ログインE2E検証（ユーザーのGoogle操作が必要な項目）、Vercel環境変数、reuse interval確認
- **E2E検証 1・2 通過**（ユーザー実施）: 許可アカウントでログイン成功／リスト外アカウントは拒否＋auth.usersにレコードなし（DBトリガーの実動確認）。E2E 7（未認証ガード）はローカルで確認済み。3〜6（セッション永続・複数デバイス/タブ）は運用しながら確認、8（RLS）はスキーマ実装後、9（ログアウト）は本番デプロイ後に確認
- Vercel環境変数3種をProductionに設定（CLI）→ 本番デプロイ。`/` が 307 で `/login?returnTo=%2F` にリダイレクトされることを確認（本番ログインゲート稼働）
- **Sprint 0 完了条件「ログインでき、テーマが切り替わる空アプリがVercelで動く」をほぼ達成**。残: 本番URLでの実ログイン確認（Supabase側Redirect URLsに本番URLが必要）、DBスキーマ全体＋Zod＋型生成（次セッション・プランモード）
- 本番URLでの実ログイン確認OK（ユーザー実施）。**認証まわりのSprint 0タスク完了**

### 本日のまとめ（Day 1）

**到達点**: リポジトリ初期化からわずか1日で、フェーズ0（環境整備）を完遂し、Sprint 0の中核（認証＋テーマ＋Vercel本番稼働）まで到達。第一期最大の反省点だった認証を、SPECインタビュー→実装→security-reviewerゲート→E2E検証の全工程を通して初日に完了させた。

- ✅ フェーズ0: CLAUDE.md v2（36行）／hooks 3種／skills 3種／security-reviewer subagent／gh CLI
- ✅ Sprint 0: Next.js + shadcn/ui + next-themes（テーマ切り替え動作確認済み）／認証一式（Google OAuth・許可リスト2層ゲート・本番ログイン確認済み）／AppError共通ハンドラー／Vercel本番稼働（https://nekonote-v2.vercel.app）
- ⏳ Sprint 0 残: DBスキーマ全体のマイグレーション＋Zodスキーマ＋型生成（次セッション・プランモードで承認から）

**技術書典向けの学び（今日のハイライト）**:

1. **運用計画がそのまま機能した**: 「インタビュー→SPEC→新セッションで実装」「レビュー必須ゲート」「1機能=1セッション」のサイクルを4セッション回し、大きな手戻りゼロ。第一期のような仕様変更の連鎖は起きていない
2. **hooksは「設定前にstdin合成テスト」「ask > deny」**: 決定論的な強制は強力な分、誤設定・過剰ブロックのコストも大きい。運用と矛盾しない粒度（確認）に留める判断が効いた
3. **外部サービスは外形検証で潰す**: Supabase/Googleの設定不備2件を、ダッシュボード目視でなくAPIレスポンス（/auth/v1/settings、authorizeの302先）で特定。ホスト版Supabaseの権限制約（ALTER DATABASE不可）のような「ローカルでは通るが本番で通らない」問題も初日に踏めた
4. **セッション境界ごとにdev-log/SPECへ書き戻す**運用が、コンテキスト切り替え後の再開コストをほぼゼロにした

**次セッション**: DBスキーマ全体（ER図Draft → プランモード承認 → マイグレーション → Zod＋型生成）。draft-to-clean-model スキル参照を忘れずに。

### セッション⑤: DBスキーマ全体（プランモード承認→マイグレーション→Zod＋型生成）

- プランモードで16テーブルの設計を提示・承認。ユーザー決定2件: user_settingsは最小構成（selected_project_idのみ。PAT列はSprint 4のGitHub連携SPECで追加、テーマはlocalStorageのまま）／標準ペルソナ・プロファイルのシードはSprint 2に回す（今回は定義のみ）
- 設計方針: draft-to-clean-model / review-profiles スキル準拠。列挙値はtext＋CHECK制約（`lib/schemas/enums.ts` の定数と対応）、全テーブルRLS有効＋anonロールの権限剥奪（未認証で読める公開データなし・フェイルクローズ）、FK列全インデックス、updated_at共通トリガー
- personas / review_profiles は「標準同梱行（user_id null）＋ユーザー作成行」のハイブリッド所有モデル。CHECK制約とRLSポリシーで標準行の偽造・改変を遮断
- **security-reviewer 必須ゲート通過**（Critical/Highなし）。Medium 1件を修正: SPEC-auth §5整合のため所有者テーブルのuser_idに `default auth.uid()` 付与。Low 1件を採用: `alter default privileges` でanon剥奪を将来テーブルにも恒久化
- `supabase db push` 適用 → migration list でlocal/remote一致確認
- 型生成: `supabase gen types typescript --linked` → `lib/database.types.ts`、`db:types` スクリプト追加、Supabaseクライアント（client/server）に `Database` 型を配線
- Zod入力スキーマ: zod 4.4.3導入、`lib/schemas/` にenums＋ドメイン別5ファイル（notes/projects/review/manuscript/settings）。行型＝生成型、入力バリデーション＝Zodの役割分担
- **RLS外形検証（E2E検証8の一部）**: anonキーのREST SELECTが全テーブル401（42501 permission denied）で拒否されることを確認。認証済み経路の検証はSprint 1のUI実装後
- typecheck / lint 通過
- 学び: `supabase db push` は非対話実行だと確認プロンプトで停止する → `echo Y |` でパイプ。Docker未起動の警告はローカルカタログキャッシュのみで適用には無害
- **Sprint 0 の全タスク完了**。次はSprint 1（構想フェーズ: ノートCRUD・タグ・テンプレート挿入）

### セッション⑤続き: SPEC-notes インタビュー・策定

- Sprint 1 の入り口として、構想支援機能（手帳→プロットモデル）のSPECインタビューを2巡実施
  - 1巡目（方針）: エディタ→**WYSIWYG（Tiptap）**／保存→自動保存＋ドラフト退避／タグ→インライン作成／テンプレ→**DBテーブル（templates）**
  - 2巡目（派生する落とし穴）: Tiptapの保存形式→**Markdown保存**（notes.contentのMarkdown前提を維持、対応記法を往復安全な範囲に限定）／templates所有→personas同型ハイブリッド／挿入→カーソル位置＋categoryタグ自動付与／AI掘り下げ→**別SPECに分離**（SDK導入・ai_model_settingsとセット）
- docs/SPEC-notes.md をドラフト作成（対象ファイル・スコープ外・E2E検証手順10項目を含む必須構成）。templates テーブルは次セッションでプランモード承認の上マイグレーション化
- 次: SPEC-notes のユーザーレビュー → 確定 → 新規セッションでノート機能実装
- SPEC-notes ユーザーレビューで2点追加（ごみ箱=notes.deleted_atソフトデリート＋復元/完全削除、エディタUndo/Redo=Tiptap History）→ **確定**。次セッション⑥でノート機能実装（templatesマイグレーションのプランモード承認から）

### セッション⑥: ノート機能実装（SPEC-notes・Sprint 1中核）

- プランモード承認で実装開始。SPECからの変更1件を承認: Markdown変換はサードパーティ tiptap-markdown ではなく**公式 @tiptap/markdown**（Tiptap v3 に公式パッケージが登場していた。SPEC-notes §2 を追記修正済み）
- マイグレーション `20260712000003_notes_trash_and_templates.sql`: notes.deleted_at＋部分インデックス、templates（personas同型ハイブリッド所有＋RLS 4ポリシー）、標準テンプレ4件シード（コンセプト/キャラクター/テーマ/世界観、story-engineering準拠）
- **security-reviewer 必須ゲート通過（指摘ゼロ）** → db push（自動モードの権限判定で一度ブロック→ユーザー承認後に適用）→ migration list 一致確認 → 型再生成（push前の手動先行パッチと**完全一致**）
- 実装: /notes 一覧（1クリック作成・ILIKE検索・タグAND絞り込み・ごみ箱ビュー）、/notes/[id] Tiptapエディタ（対応記法をSPECの往復安全範囲に限定、Undo/Redo、自動保存2秒デバウンス＋離脱時、localStorageドラフト退避・復元提案）、タグインライン作成（category/working_title）、テンプレ挿入＋categoryタグ自動付与、ごみ箱（トースト「元に戻す」・復元・完全削除ダイアログ）。Server Actions＋Zod＋AppError正規化（{ok,error}戻り値）
- **ブラウザE2E検証（SPEC §8）を1〜9通過**（ユーザーはペインでのログインのみ）: Markdown往復はDB値の完全一致で確認、Undo/Redoは保存またぎ＋テンプレ1発Undo、ごみ箱はトースト復元→ビュー復元→完全削除→タグ残存まで、ドラフト退避はサーバー停止で実地再現。モバイル幅（375px）で全操作、ダークモード反転も確認
- E2E検証で発見・修正した3件（教訓）:
  1. Base UI の Button に `render={<Link>}` を渡すときは `nativeButton={false}` が必要
  2. **Tiptap v3 useEditorState の罠**: マウント時の editor(null) でスナップショットが固定され、最初のトランザクションまで再計算されない → ツールバーは `{editor && <Toolbar editor={editor} />}` で editor 生成後にマウントする
  3. 絶対配置ドロップダウンと sticky ツールバーの z-index 衝突（後勝ちで隠れる）
- 検証手法メモ: トースト（4秒自動消滅）はツール呼び出しレイテンシで見逃す → MutationObserver を先に仕込んで捕捉・自動クリック。認証済みREST（ページ内fetch＋Cookieのaccess_token）でDB状態を直接検証
- 残: 本番デプロイ後の実地確認（Notionからのネタメモ引っ越し＝実運用移行はユーザー実施）
- 本番デプロイ完了（`npx vercel deploy --prod --yes`、Ready確認済み）。外形確認OK: 未認証の /notes が 307 → /login?returnTo=%2Fnotes。気づき: Next.js 16 が middleware ファイル規約の非推奨警告を出している（proxy への移行が今後必要）
