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

### セッション⑦: SPEC-ai-deep-dive インタビュー・策定（AI掘り下げ支援・Sprint 1後半）

- SPEC-notes で分離していた「AI掘り下げ支援」（Vercel AI SDK導入・ai_model_settings とセット）のSPECインタビューを2巡実施
  - 1巡目（方針）: UI→**エディタ内サイドパネル**（スマホはボトムシート）／履歴→**ノートごとに1スレッドDB保存**／ペルソナ→**標準ペルソナ前倒しシード**／ノート反映→**応答ごとに「ノートに挿入」**
  - 2巡目（派生する落とし穴）: chat_threads/chat_messages→**汎用設計**（note_id nullable＋persona_id。R2の独立チャット画面も同テーブルで実現、マイグレーション作り直し不要）／ノート削除連動→**運命共同体**（ごみ箱中は非表示のみ・完全削除でcascade）／シード範囲→**conversational 2人**（アシスタント・マスター）で担当はアシスタント固定（reviewer 4人はSprint 2の領分）／ai_model_settings→**コード内デフォルト定数にフォールバック**（設定UIはSprint 5）
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: ストリーミング＋Route Handler `/api/chat`（Server Actionはストリーミング不可）／ノート本文は送信時点のエディタ現在値を渡す／履歴は直近20メッセージ制限・関連ノートは含めない／会話リセットボタン／必須APIキーは `OPENAI_API_KEY` のみ（medium帯=GPT-5.4-mini）
- docs/SPEC-ai-deep-dive.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-13）
- 次: 新規セッションで実装。chat_threads/chat_messages マイグレーションのプランモード承認から（security-reviewer 必須ゲート: マイグレーションRLS＋/api/chat）。冒頭で `OPENAI_API_KEY` の .env.local 登録＋ `vercel env add` が必要（キーはユーザーが用意）

### セッション⑧: AI掘り下げ支援 実装（SPEC-ai-deep-dive・Sprint 1後半）

- プランモード承認で実装開始。**AI SDK は v7系（ai@7.0.22）が最新**で、SPECの想定API（v5相当）から読み替え: `createUIMessageStreamResponse`＋`toUIMessageStream({ onEnd })` で永続化、クライアントは `useChat`＋`sendMessage` の per-request `body` にノート現在値を同梱（DefaultChatTransport＋prepareSendMessagesRequest 案は react-hooks 新ルール（refs in render）に弾かれ、より単純なこちらに）。SPEC §5 に実装時確認を追記済み
- マイグレーション `20260713000001_chat_and_conversational_personas.sql`: chat_threads（汎用設計・部分unique）／chat_messages（不変・親経由RLS、update/deleteポリシーなし）／conversationalペルソナ2行を固定UUIDシード（コードの `lib/ai/personas.ts` 定数と対応）
- **security-reviewer ゲート×2回通過**: ①マイグレーション: Medium 1件修正（chat_threads ポリシーに note_id/persona_id の所有 exists 検証を追加）、Low 1件（role偽装INSERT）は設計上許容。②/api/chat・AI基盤: Critical/High/Medium なし、Low 2件（messages件数上限→ `.max(100)` 反映済み／Server Actions の明示認証なし→既存パターン踏襲で許容）
- 実装: `lib/ai/models.ts`（DEFAULT_MODEL_MAP＋resolveModel。ai_model_settings ユーザー行→定数の解決順、キー未設定は AppError で日本語エラー）、`lib/ai/prompts.ts`、`app/api/chat/route.ts`（認証→RLS越し所有確認→streamText→onEnd で差分2件保存）、`lib/actions/chat.ts`（get-or-create・リセット=スレッド削除）、`components/notes/deep-dive-panel.tsx`（サイドパネル/ボトムシート・挿入ボタン・リセット・stop・エラー表示）。`ActionResult`/`toActionError` は lib/errors.ts へ移動して共用化
- **E2E検証（SPEC §8）11項目すべて通過**: ストリーミング対話（ノート内容を踏まえた掘り下げ質問）／リロード履歴復元／エディタ現在値の反映（追記した固有名を応答が復唱）／挿入＋1Undo／リセット／ごみ箱復元で会話残存→完全削除で cascade 消滅（REST SELECT で0件確認）／ai_model_settings 行の一時挿入で medium→anthropic に切替わることを確認（エラー文言の変化で実証）→行削除でデフォルト復帰／キー未設定エラー表示／anon 全テーブル401／モバイル375px 全操作
- E2E検証で発見・修正した2件:
  1. lg以上でパネルの入力欄がビューポート外（`lg:h-dvh` がヘッダー分はみ出す）→ エディタページを内部スクロール構造に変更（main に overflow-y-auto。sticky ツールバーは main がスクロールコンテナになり従来どおり機能）
  2. **Base UI 版 shadcn の `AlertDialogAction` が Close プリミティブ非使用で、実行後にダイアログが閉じない潜在バグ**（trash-card では行アンマウントで露見せず）→ `AlertDialogPrimitive.Close` ベースに修正（既存の完全削除ダイアログも同時に修復）
- その他: eslint に `.claude/**` の ignore を追加（worktree 内 .next を lint が巻き込むため）。PostToolUse の eslint フックが react-hooks 新ルール（set-state-in-effect / refs）で2回ブロック→ effect 内 setState を async 継続に、transport+ref 構成を廃止して解消
- **APIキーの教訓（インシデント）**: ①ユーザー登録キーが `NEXT_PUBLIC_` プレフィックス付きになっており秘密鍵として不適切＋コードが読めない ②その確認時に私の抽出コマンドが**キー値を出力してしまい、ローテーションを実施してもらった**。以後、キー行の確認は `grep -c '^KEY='`（値を出さない）に統一 ③OpenAI 429 insufficient_quota はコード正常・クレジット追加で解決
- 本番反映完了: `OPENAI_API_KEY` を本番envへ登録（ユーザー実施）→ `npx vercel deploy --prod --yes`（Ready・37s）。外形確認OK: 未認証の /notes は 307 → /login、未認証POST /api/chat も middleware で 307（フェイルクローズ維持）。本番でのAI応答の実地確認は実運用（Notionネタメモ移行後の日常利用）を兼ねる
- **Sprint 1 の全タスク完了**（ノートCRUD・タグ・テンプレ挿入・AI掘り下げ・SDK導入・ai_model_settings解決）。次はSprint 2（企画フェーズ: プロジェクトCRUD・企画書エディタ・レビューゲート。入り口はSPECインタビューから）

## 2026-07-13

### スケジュール前倒し改訂（実装計画 v2）

- 契機: **Claude Fable 5 の無償利用が 7/20 午後（JST）まで**＋**7/17〜20 が4連休**。Sprint 0・1 が元計画比で約1週間先行して完了していたため、この2条件を活かす前倒し改訂を実施
- 方針: **「モデル性能が効く重量級タスクを 7/20 までに、定型的な仕上げを 7/20 以降に」**。重量級=レビューゲートフロー・ビートボードD&D（計画上の最大リスク）・GitHub連携＋AI校正の縦通し・各SPECインタビュー。定型的=ダッシュボード・設定UI・対話ペルソナ仕上げ・UX改善
- 新日程: Sprint 2（企画）=7/13〜16（平日は無理をしない）／Sprint 3（ビートボード）=7/17〜19で **R1相当を7/19に前倒し達成**（元計画8/1比 約2週間前倒し）／7/20=Fable最終日にSprint 4前半（GitHub連携＋AI校正の核）／7/21以降は通常ペースでSprint 4後半→Sprint 5（8/11 R2は維持、前倒し分がバッファ化）
- 運用調整: SPECインタビューは**前日夜**に実施（7/16夜=ビートボード、7/19夜=GitHub連携）し連休の昼間を実装に全振り／ビートボードD&Dの縮退判断を Fable 期間中は「3日→**1日**」に短縮（期間内の1日の価値が高い）／スコープカット判断ポイントは 7/18昼（＋8/1へのセーフティネットとして従来の7/25も維持）／「デプロイしたら寝る」は継続
- 書き戻し: 実装計画 v2（§1前提・§5スプリント計画・§7リスク表）＋運用計画§6直近アクションを改訂しコミット（`de274da`）
- 次: Sprint 2 入り口のSPECインタビュー（企画書エディタ＋レビュー基盤）から

### セッション⑨: SPEC-proposal-review インタビュー・策定（Sprint 2 入り口）

- Sprint 2（企画フェーズ＋レビュー基盤）のSPECインタビューを2巡実施
  - 1巡目（方針）: 企画書エディタ→**構造化2項目＋Tiptap本文**（ジャンル/ターゲット層のみカラム、本文はノートと同じエディタ＋定型テンプレ初期挿入）／レビューUI→**文書ベースの反復**（チャットではない。壁打ちはAI掘り下げと役割分担）／承認→**AI判定＋ユーザー確定**（判定はAI、「企画を通す」はユーザー）／ノート紐づけ→**仮タイトルタグから一括候補**（手帳→プロットモデルの「昇格」動線を正面から実装）
  - 2巡目（派生する落とし穴）: レビュー入力→**紐づけノート全文を含める**（表紙＋本文で審査。整合性チェックという担当編集の強みを活かす）／反復の文脈→**同一セッションの全履歴**（前回指摘の改善確認を可能に）／承認後編集→**approvedのまま維持**（ゲートは演出であり機械的管理ではない）／担当ペルソナ変更UI→**今回はデフォルト固定**（Sprint 5の設定画面へ）
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: `review_feedbacks.verdict` 列を1本追加（「企画を通す」ボタンの出現条件＝構造参照が必要。draft-to-clean-model 判断基準2）／企画書定型テンプレはコード内定数（templates テーブルには入れない）／判定は末尾固定判定行のパース・不能時は差し戻し扱い（フェイルクローズ）／プロジェクト作成時に企画書も自動作成（1対1）／校正さんの能力帯は low（コスト最適化・設定行で差し替え可）／review_sessions の意味を「1企画書の反復スレッド」と確定（running中に feedback 追記→確定で completed）
- シード範囲は実装計画どおり: reviewer 4人（担当編集・校正さん・読者代表・書店員）＋レビュープロファイル5種を固定UUIDで全件（UIから使うのは今回「企画書レビュー」のみ。他は Sprint 3・4 の領分）
- docs/SPEC-proposal-review.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-13）
- 次: 新規セッションで実装。マイグレーション（verdict 列＋シード）のプランモード承認から（security-reviewer 必須ゲート: シードRLS＋/api/review）。**冒頭で `ANTHROPIC_API_KEY` の登録が必要**（担当編集=high帯=claude-sonnet-5。.env.local＋Vercel本番。キーはユーザーが用意・登録、確認は grep -c のみ）

### セッション⑩: 企画フェーズ＋レビューゲート実装（SPEC-proposal-review・Sprint 2中核）

- プランモード承認で実装開始。冒頭で `ANTHROPIC_API_KEY` をユーザーが登録（.env.local＋Vercel本番。確認は `grep -c` のみ、値は一切出力しない運用を維持）
- マイグレーション `20260713000002_review_gate_and_reviewer_personas.sql`: review_feedbacks.verdict 列（approved/needs_work・null可）＋reviewer ペルソナ4人（担当編集/校正さん/読者代表/近所の書店員・固定UUID e5a1c0de-0003〜0006）＋レビュープロファイル5種（同 1001〜1005）を標準シード。プロンプトは review-profiles / story-engineering スキル準拠でシード時に全件確定
- **security-reviewer ゲート×2回通過**: ①マイグレーション=指摘ゼロ。②API/Actions=Medium 1件を修正（`proposalUpdateSchema` が status を含んだままで、`updateProposal` 経由で承認ゲートのサーバー側検証をバイパスできた → omit に追加）、Low 2件を修正（判定行パースを行単位アンカーに強化＝ノート経由のプロンプトインジェクションで「判定: 承認」を文中に混ぜる誘導を遮断／attachProposalNote は先にRLS越し所有確認して not_found に正規化＋ごみ箱中ノートの紐づけをサーバー側でも遮断）、Low 2件（approveProposal の TOCTOU・並行 running セッション）はSPECの「ゲートは演出」判断どおり許容
- 実装: `/api/review`（認証→RLS越し所有確認→保存済みDB値でコンテキスト組み立て→streamText→**プレーンテキストストリーム**（文書1本なので useChat/UIMessage 不使用）→onFinish で verdict パース＋feedback 保存＋draft→in_review）、`lib/actions/projects.ts`（CRUD・一括/個別紐づけ・タグ別候補・検索）、`lib/actions/review.ts`（get-or-create セッション・読み取り専用 state・返答メモ・「企画を通す」のサーバー側 verdict 再検証）、/projects 一覧＋作成/編集ダイアログ、/projects/[id] 企画書エディタ＋レビューゲートパネル（ボトムシート同型）
- **エディタ共通化**: note-editor.tsx から Tiptap 構成＋ツールバー（`components/editor/markdown-editor.tsx`）と自動保存＋localStorage退避（`components/editor/use-autosave.ts`）を切り出し、ノート/企画書で共用。ノート側は挙動不変を維持（リファクタ後のE2Eで回帰なし確認）
- **E2E検証（SPEC §8）11項目すべて通過**。ハイライト:
  - 反復レビューが本物のゲートとして機能: 4巡（差し戻し×3→承認）。第2回は「前回指摘の改善状況」から始まり返答メモを個別確認、さらに**企画書と紐づけノートの矛盾（人物メモ「消息を絶った」vs 企画書「目撃した」）を検出**＝紐づけノート全文参照と整合性チェックの実証
  - ストリーミング表示はDOM長の増加（134→1347字）で実測。sonnet-5 は思考が長く初回トークンまで20秒前後かかる（見かけ上止まって見えるだけ）
  - cascade は authenticated REST のカウントで確認（削除前 sessions=2/feedbacks=4 → 削除後すべて0、ノート2件は残存）。verdict のDB保存値も needs_work×3→approved で一致
  - キー未設定エラー（E2E9）は .env.local のキー行を sed で一時リネームして再現（値は非出力）。日本語エラーがパネル内表示され落ちない
  - anon REST は新シード行含め全テーブル401、モバイル375pxでボトムシート・ダイアログとも成立
- 検証手法の学び: **ブラウザペインが非フォーカスだと `el.focus()` でReactのonFocusが発火しない → `focusin` イベントを手動ディスパッチ**する。javascript_tool は30秒制限があるので長いポーリングは複数回に分割。React制御inputへの値設定は native setter＋input イベント方式が安定
- 修正: `db:types` スクリプトが `supabase` 直呼びで毎回失敗していたのを `npx supabase` に修正
- 本番デプロイ完了（Ready・46s）。外形確認OK: 未認証 /projects → 307 /login、未認証 POST /api/review → 307（フェイルクローズ維持）
- **Sprint 2 の中核（プロジェクトCRUD・企画書エディタ・レビューゲート・レビュー基盤シード）完了**。前倒しスケジュールv2どおり。次: 7/16夜にビートボードSPECインタビュー → Sprint 3（7/17〜19）

### セッション⑪: SPEC-beat-board インタビュー・策定（Sprint 3 入り口）

- 計画（7/16夜）より前倒しでビートボードのSPECインタビューを2巡実施
  - 1巡目（方針）: アンカー表現→**ハイブリッド方式**（シーンに転換点マーク＋マーク付きシーンは定位置に自動整列）／カード編集→**ダイアログ＋プレーンtextarea**（4観点はplaceholder提示。Tiptapは過剰）／構成・シーンレビュー→**都度フィードバック型**（verdict・「通す」ボタンなし。要求仕様の「都度受けられる」に忠実、設計は試行錯誤の場でゲートの緊張感は不要）／感情の起伏→**バッジ＋折れ線を両方今回**（縮退第一候補=折れ線と明記）
  - 2巡目（派生する落とし穴）: 整列規則→**境界3点のみ固定**（PP1=設定末尾・ミッドポイント=反応末尾・PP2=攻撃末尾はドラッグ不可の固定スロット。位置が曖昧なピンチ1・2はバッジのみでレーン内自由）／レビュー入力→**企画書まで含める**（紐づけノート全文は入れない。肥大化とノイズの回避）／ページ配置→**タブで別ルート**（/projects/[id] にタブナビ、ボードは /projects/[id]/board のフル幅ページ。Sprint 4 の原稿タブも同列に足せる）／カード削除→**確認ダイアログで物理削除**（短文メモにごみ箱は過剰）
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: **マイグレーション不要**（scenes・プロファイルシード・review基盤すべて既存。今回スキーマ変更ゼロ）／order_index はプロジェクト内通し番号でD&D確定時に一括再採番（1 Server Action = 1トランザクション）／未設定の境界アンカーは空スロットのプレースホルダー常時表示（固定スロット方式の良さを一部取り込み）／1転換点1シーン・パート変更時のアンカー自動解除・パート別のアンカー選択肢出し分けはアプリロジック担保／シーン削除でそのシーンのレビューセッションを明示削除（target_ref は text 参照で cascade が効かない）
- docs/SPEC-beat-board.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-13）
- 次: 新規セッションで実装（Sprint 3・7/17〜）。dnd-kit（@dnd-kit/core / sortable）導入から。マイグレーションはないが `/api/review` の対象拡張（scene / project 所有確認）は security-reviewer 必須ゲート。Fable期間中はD&Dが1日詰まったらリスト形式（上下移動ボタン）に縮退判断

### セッション⑫: ビートボード実装（SPEC-beat-board・Sprint 3）

- 前倒しスケジュールの Sprint 3（7/17〜19枠）をさらに前倒しして 7/13 に実施。プランモード承認で実装開始。**マイグレーションなし**（スキーマ変更ゼロ）、dnd-kit（core 6.3.1 / sortable 10.0.0 / utilities 3.2.2）導入から
- **タブナビ共通レイアウト**: `app/projects/[id]/layout.tsx` 新設（プロジェクトヘッダー＋タブ「企画書|ビートボード」）。proposal-editor は自前ヘッダーを縮退（保存ステータスは本文上部へ）。※サーバーコンポーネントから `trigger` のJSXを渡すと Base UI DialogTrigger が hydration ミスマッチ → クライアントラッパー `EditProjectButton` で解消
- **正準順序の一元化**（`lib/board.ts` 純関数）: 「パート順连結の通し番号・境界アンカーはレーン末尾固定」を `toCanonicalOrder` に集約し、Server Actions とクライアント楽観的更新の**両方が同じ関数を通る**設計に（保存成功時の再セット不要・ロールバックだけ持てばよい）。part↔anchor 不整合は `normalizeAnchor` でアンカー解除に正規化
- **シーンServer Actions**（`lib/actions/scenes.ts`）: create（レーン末尾・境界スロット手前に挿入）/ update（1転換点1シーンの付け替え・パート変更でアンカー自動解除・境界付与でレーン末尾へ）/ reorder（全件検証→0..N-1一括再採番）/ delete（そのシーンの review_sessions を明示削除→シーン削除の順）。supabase-js にトランザクションがないため**変更行のみの単一 upsert**（1ステートメント＝原子的）で整合担保
- **ボードUI**（`components/board/*` 6ファイル）: DndContext（Pointer/Touch/Keyboard センサー・multiple containers・DragOverlay）＋楽観的更新→失敗ロールバック＋トースト。境界アンカースロット（未設定はプレースホルダー常時表示・スロット内カードはドラッグ不可）。感情バッジ（＋/−アイコン）＋ボード下部SVG折れ線（構成順・2値・シーン番号つき）。編集ダイアログ（4観点placeholder・パート別アンカー選択肢・付け替え/自動解除の注意書き・確認つき物理削除・シーンレビュー導線）
- **レビュー基盤の共通化**: 既存パネルを `components/review/review-panel.tsx` に汎用化（kind: proposal|structure|scene、verdictバッジ条件表示、フッター拡張スロット）。企画書側は「企画を通す」フッターを載せた薄いラッパーに。`lib/actions/review.ts` は (kind, targetId) 一般化＋`resolveTarget` で RLS 越し所有確認。`/api/review` は `review_profiles.target_phase` 分岐（structure=企画書＋全シーン構成順、scene=企画書＋対象シーン全文＋全シーン一覧）で、structure/scene は **verdict パースをスキップ（null保存）**・proposals.status 遷移もしない
- **security-reviewer ゲート通過**: Critical/High ゼロ。Medium 1件修正（reorderScenes が重複IDを拒否せず再採番が壊れうる → id集合の一意性チェック追加）、Low 1件修正（セッション検索に review_profile_id 絞り込みを追加=kindとプロファイルの対応ずれ防止の多層防御）。3分岐のIDOR・upsert行混入・過剰削除・プロンプトインジェクション→承認ゲートは全て問題なしの評価
- **E2E検証（SPEC §8）11項目すべて通過**。ハイライト:
  - D&D: レーン内・レーン間（part更新）とも成立、DBの order_index 0..N-1 再採番と境界アンカーのレーン末尾維持を `npx supabase db query --linked` で直接確認（今回確立した検証手段。ページ内fetch方式より簡便）
  - アンカー: PP1付け替え（注意書き→元シーンから自動で外れる）・パート変更で自動解除→空スロットのプレースホルダー復活まで一巡
  - 構成レビュー: シーン番号を挙げた転換点評価＋企画書内容（主人公名）を踏まえた指摘。返答メモ→再レビューで「前回指摘の改善確認」から開始し**メモ内容（追加予定シーン）を直接引用**。判定バッジ・「通す」なし、DB verdict=NULL を確認
  - シーンレビュー: 4観点それぞれに言及・構成内位置（8番目）も認識。**シーン削除でセッション・フィードバックが道連れ消滅**（孤児ゼロをDB確認）
  - モバイル375px: 縦積み・D&D成立・ボトムシート65dvh・ライトモード反転もテーマ変数どおり
  - 企画書レビュー回帰: 共通化後のラッパー経由で判定行パース→差し戻しバッジ表示・「通す」非表示まで正常
- E2E検証で発見・修正した3件（教訓）:
  1. サーバーコンポーネントから JSX要素を client の Base UI Trigger 系 prop に渡すと hydration ミスマッチ（data-slot の解決順が変わる）→ トリガーはクライアント側で組み立てる
  2. **DndContext は `id` 未指定だと SSR で hydration ミスマッチ**（useId 由来の aria-describedby）→ 固定 id を渡す
  3. **兄弟要素間の key 重複バグ**: 編集ダイアログ `key={editing.id}` とシーンレビューパネル `key={review.scene.id}` が同一シーンで衝突し、React の差分計算が壊れて**ゴーストDOM（削除もクローズも効かないパネル）が蓄積**。console の「two children with the same key」を実行時フックで捕捉して特定 → key にプレフィックス付与で解消。症状（state は null なのに DOM が残る）から key 重複を疑う教訓
- 検証手法の学び: 合成ドラッグは **pointerdown→複数 pointermove→pointerup を段階発火**し、**目標座標はドラッグ開始前に固定測定**する（dnd-kit は開始時 rect で衝突判定するため、ドラッグ中の getBoundingClientRect 追従はプレビューシフトに引っ張られて self ドロップになる）。React の state 検証は fiber の memoizedState 直読みが有効
- 残: 本番デプロイ＋実機（タッチ）でのD&D確認は実運用を兼ねる。検証用プロジェクト「竜の巣（ビートボード検証）」は本番DBに残置（デモを兼ねる。不要なら一覧から削除可）

### セッション⑬: SPEC-proofreading インタビュー・策定（Sprint 4前半 入り口）

- 計画（7/19夜）より前倒しでGitHub連携＋AI校正のSPECインタビューを2巡実施。SPECは校正フェーズ全体（PAT〜コミット・進捗）を定義し、実装は前半（縦通し）/後半（受入拒否・コミット・進捗）に分割
  - 1巡目（方針）: 原稿の入り口→**自動一覧＋開いたら管理対象**（base_path配下ツリー常時表示・manuscript_links自動作成。「リポジトリが正」の思想）／校正単位→**ファイル全文**（1ファイル=1実行）／結果形式→**構造化提案カード**（原文抜粋/修正案/理由をrevision_suggestionsへ。後半は受入/拒否ボタンを足すだけ）／PAT設定→**最小の/settings新設**（Sprint 5設定画面の受け皿）
  - 2巡目（派生する落とし穴）: 原稿更新→**ファイル単位SHA記録＋更新バナー・提案は残す**（last_reviewed_commitはリポジトリHEADでなくファイル単位＝モノレポで他作品コミットに反応させない）／再校正→**pendingのみ置き換え**（on_hold/処理済みは残す。「保留はコミット後も残る」の要求仕様と整合）／実行中UI→**streamObjectで提案カード逐次表示**（保存は完了時にまとめて＝途中切断で半端保存を残さない）／担い手→**校正さん固定**（担当編集の校閲・講評系はSprint 5）
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: 暗号化=アプリ層AES-256-GCM（ENCRYPTION_KEY・server-only・平文をクライアントへ返すAPIは作らない。Vault不採用）／PAT登録時にGET /userで疎通検証→github_username保存（値のマスク表示すらしない）／校正はreview_sessions不使用（ライフサイクルはrevision_suggestions.statusが担う）／シード済み校正プロファイルの出力形式節を構造化前提にマイグレーションで改訂／granularity='sentence'固定（'scene'は担当編集校閲用に温存）／GitHubクライアントはfetch直叩き薄ラッパー（octokit不採用）／縮退計画=GitHub読み込みが詰まったら手動貼り付けを暫定入り口に
- **発見: `GOOGLE_GENERATIVE_AI_API_KEY` 未登録**（校正さん=low帯のデフォルトは gemini-3.1-flash-lite）。実装セッション冒頭でGoogleキー登録 or ai_model_settings で low→anthropic（haiku 4.5）差し替えの判断が必要
- docs/SPEC-proofreading.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-13）
- 次: 新規セッションで実装（Sprint 4前半）。マイグレーション（user_settings PAT列＋プロファイル改訂）のプランモード承認から。**security-reviewer 必須ゲート**（暗号化・PAT取り扱い・/api/proofread）。ユーザー準備物: ①Google APIキー or low帯差し替え判断 ②検証用原稿リポジトリ（誤字入りダミー.md数ファイル）＋Fine-grained PAT（対象リポ限定・Contents: Read/Write） ③ENCRYPTION_KEYはセッション内で生成・登録（CLI完結・値は非出力）
