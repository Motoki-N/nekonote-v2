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

### セッション⑭: GitHub連携＋AI校正 実装（SPEC-proofreading・Sprint 4前半）

- 前倒しスケジュール（7/20枠）をさらに前倒しして 7/13 に実施。プランモード承認で実装開始。冒頭判断: **low帯は ai_model_settings で anthropic（claude-haiku-4-5）に差し替え**（Googleキー登録は不要に。行削除でいつでもデフォルトに戻る）。ENCRYPTION_KEY はセッション内でCLI生成し .env.local＋Vercel本番へ登録（値は非出力の運用どおり）
- マイグレーション `20260713000003_github_pat_and_proofreading.sql`: user_settings に github_pat_ciphertext / github_username（null可・既存RLS踏襲）＋校正プロファイル（…1005）の出力形式節を構造化出力前提に改訂
- **security-reviewer ゲート×2回通過**: ①マイグレーション=指摘なし（Low 2件は実装側引き継ぎ: 復号失敗の情報非漏洩・github_username を信頼しない表示値として扱う→両方実装済み）。②実装=Critical/High/Medium なし、Low 2件を修正（repo 正規表現を GitHub 実仕様に強化＝`..`等のURL正規化による別エンドポイント到達を遮断／/api/proofread で DB由来 file_path を manuscriptFilePathSchema で再検証＝PostgREST直叩きで作られた不正行への多層防御）
- 実装: `lib/crypto.ts`（AES-256-GCM・server-only・iv+authTag+暗号文のbase64）、`lib/git/credentials.ts`（GitCredentialProvider 抽象化＋PAT実装）、`lib/git/github.ts`（fetch直叩き薄ラッパー: ツリー・本文・ファイル単位SHA・疎通検証。AppError正規化）、`lib/actions/settings.ts`（登録=GET /user 疎通→暗号化upsert・削除。**暗号文・平文は一切クライアントへ返さない**）、`/settings` ページ、プロジェクト編集に repo/base_path 欄、原稿タブ（ファイル一覧・読み込み専用ビュー・更新バナー・誘導表示のフェイルソフト）、`/api/proofread`（streamObject 配列・onFinish で pending 置き換え＋last_reviewed_commit 更新）、校正パネル（useObject 逐次カード・stop・statusバッジ）
- **E2E検証（SPEC §8）11項目すべて通過**（検証はユーザーの実原稿リポ Motoki-N/writings を流用。前半は読み取り専用なので安全）: PAT登録（DB暗号文のみ・無効トークン日本語エラー）／誘導表示（repo未設定・PAT未登録）／原稿読み込み（日本語パスのツリー・本文2218字・manuscript_links自動作成）／AI校正（実原稿の表記揺れ「バシャッバシャッと」を検出・pending/sentence保存・SHA記録）／再校正（on_hold残存・pending置き換え）／更新バナー（SHA不一致→表示、校正完了→自動消灯）／PAT削除→誘導復帰／キー未設定の日本語エラー／モバイル375px（ボトムシート）／anon REST 401／既存タブ回帰
- E2E検証で発見・修正した3件（教訓）:
  1. **【重要インシデント】Next.js dev の Server Action ログが引数を平文出力し、登録PATがターミナルログに露出** → `next.config.ts` に `logging: { serverFunctions: false }` で恒久停止＋ユーザーがPATをローテーション（Revoke→再発行→差し替え）。**秘密情報を Server Action の引数で受ける機能を作るときは、このログ抑止が前提条件**
  2. **`.env.local` への追記で ANTHROPIC_API_KEY を破損**（末尾改行なしのファイルに `>>` 追記して行連結→キーが401に）。修復して復旧。**追記前に末尾改行の有無を確認する**（`tail -c 1` チェックか `printf '\n...'` 前置）
  3. **ストリーム中のプロバイダエラーが「指摘事項はありません」と誤表示**（streamObject はストリーム開始後のエラーがHTTPステータスに出ない）→ useObject の onError/onFinish 両方でエラー捕捉＋空メッセージはエラー時に出さない。あわせて**サーバー onFinish の保存とクライアント取り直しのレース**（完了直後の再取得が保存前に走り更新バナーが残る）を発見→取り直しを即時＋1.2秒後の二段に
- その他: GitHub API の一時的502に遭遇（アプリは落ちずエラー表示=フェイルソフト動作の実地確認になった）。server-only パッケージ追加。npm audit の指摘は Next 内部の postcss（fix は Next 9 への破壊的ダウングレード）のため見送り
- 本番反映完了（Ready・45s）: 未認証の /settings・/projects・POST /api/proofread すべて 307 → /login（フェイルクローズ維持）。PAT はユーザーが実運用用に再登録済み（DB共通なので本番でもそのまま有効）
- **Sprint 4前半（PAT登録・GitCredentialProvider・原稿タブ・AI校正の縦通し）完了**。次: Sprint 4後半（提案の受入/拒否/保留・まとめてコミット・writing_progress 集計。SPEC §3.4 の方針に従う）

### セッション⑮: 提案の受入/拒否/保留・まとめてコミット・進捗集計（SPEC-proofreading §3.4・Sprint 4後半）

- 7/21以降の通常ペース枠を 7/14 に前倒し実施。**マイグレーションなし**（`revision_suggestions.status` / `committed_sha` / `writing_progress` はコアスキーマ定義済み）。SPECインタビューも不要（§3.4 の方針確定済み）
- **適用判定の一元化**（`lib/proofread-apply.ts` 新設・純関数): 「原文抜粋が現在の原稿に一意に見つかるか」（出現回数ちょうど1）を安全弁とし、クライアントの「適用不能」バッジとサーバーのコミット時再検証が**同じ関数を通る**。適用は逐次置換で、1件でも失敗したら全体を失敗に（部分適用のコミットを作らない）。`String.replace` の `$` 特殊解釈はインデックス連結で回避
- **受入/拒否/保留**（`updateSuggestionStatus`）: pending⇄on_hold/accepted/rejected を自由に遷移（誤操作は「未処理に戻す」で復帰）。コミット済み（committed_sha 記録済み）は変更不可。UI は適用不能の提案の受入ボタンを無効化し、状態変更は GitHub 再取得を伴わないためローカル state の差し替えのみ（軽快）
- **まとめてコミット**（`commitAcceptedSuggestions`＋`putFileContent`）: accepted（未コミット）を作成順に適用し Contents API PUT で**1コミット**書き戻し（ネコノテからGitへの唯一の書き込み）。blob SHA の楽観ロックでリモート先行更新は conflict に。成功後 `committed_sha` 記録＋`last_reviewed_commit` を新コミットSHAへ進める（**自分のコミットで更新バナーを出さない**）。コミットメッセージは `校正: {ファイル名} に修正n件を適用（ネコノテAI）`。確認ダイアログ（AlertDialog）経由でのみ実行
- **writing_progress 集計**: `openManuscriptFile` 時に base_path 配下の全原稿ファイルの総文字数（空白除外・表示と同じ数え方）を当日分（**JST基準**・`sv-SE`+Asia/Tokyo）として upsert。同時取得は10並列に制限（secondary rate limit 対策）。失敗しても原稿読み込みは成功させる（補助機能のフェイルソフト）
- **security-reviewer ゲート通過**: Critical/High ゼロ。Medium 1件＋Low 4件を全て修正——①コミット成立後の committed_sha 記録失敗→再試行で二重適用の恐れ（リトライ3回＋失敗時は警告つき成功応答に。エラー扱いにすると「未コミット扱い→再コミット→二重適用」の事故経路になる）②updateSuggestionStatus の check-then-update TOCTOU（UPDATE に `.is('committed_sha', null)` を含めて原子化）③書き込み経路に base_path 前置チェック追加（読み取り側と対称の多層防御）④進捗集計の並列制限（上記）⑤PUT の 422 一括 conflict 扱いを「does not match」文言判定に（実装バグ由来の422を誤案内しない）
- **E2E検証（実リポ Motoki-N/writings・全53ファイル・ユーザー承認の上で書き込み検証）**:
  - 状態遷移: 保留→受入・未処理→拒否→未処理に戻す、DB反映・バッジ・ボタン出し分けすべて期待どおり
  - 適用不能: 原稿に存在しない原文のダミー提案（一時挿入→検証後削除）で、バッジ表示・受入無効化・**accepted に混ざるとコミットボタン無効＋警告文**を確認
  - コミット: 受入1件（表記揺れ「バシャッバシャッと」→「バシャバシャと」）→確認ダイアログ→**実コミット成立**（`校正: シーン1.txt に修正1件を適用（ネコノテAI）`）。committed_sha・last_reviewed_commit 同値更新・バナー非表示・「コミット済み」バッジ＋ボタン消滅・本文更新・pending 3件残存を三面（DB/GitHub/UI）で確認
  - **安全弁の実地動作**: コミットで原文が変わった結果、陳腐化した既存 pending 提案が自動で「適用不能」表示に切り替わった（SPEC §3.4 の想定シナリオそのもの）
  - 進捗: writing_progress に当日行（JST 7/14）37,490字 → コミット後の開き直しで **37,488字に upsert 更新**（「ッ」2文字減を正確に追従）
  - モバイル375px: ボトムシート内のカード・バッジ・ボタン成立
- **Sprint 4後半（受入/拒否/保留・まとめてコミット・writing_progress 集計）完了＝Sprint 4完了**。校正フェーズのワークフロー（読み込み→校正→受入→書き戻し→進捗）が一巡。次: Sprint 5（ダッシュボード・プロファイル選択UI・講評系・設定画面拡張）

### セッション⑯: SPEC-dashboard-critique-settings インタビュー・策定（Sprint 5 入り口）

- Sprint 5（〜8/11 R2）のSPECインタビューを2巡実施。**対話型ペルソナ（アシスタント・マスターのチャット）は別SPECに分離**し、今回は4項目（ダッシュボード・プロファイル選択UI・講評系・設定画面拡張）に絞った
  - 1巡目（方針）: ダッシュボード→**進捗＋プロジェクト概況の「作業基地」型**／講評→**原稿タブから全原稿を結合して「作品全体」へ**（読者代表=原稿＋ジャンル・ターゲット層、書店員=原稿のみ）／設定画面→**フル編集**（プロファイルCRUD＋ペルソナ編集＋AIモデルマッピング）
  - 2巡目（派生する落とし穴）: レビュー履歴→**プロファイルごとにセッション並存**（対象×プロファイルの組で running 高々1本。現行の profile_id 絞り込み検索の一般化）／ペルソナ変更→**セッション開始時のみ**（既定はプロファイルの default_persona）／講評→**読み切り型**（反復・返答メモなし。履歴一覧として蓄積）／進捗鮮度→**手動更新ボタン**（ダッシュボードはDB読みのみで高速、「今すぐ集計」で既存のGitHub集計を明示実行）
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: マイグレーション1本のみ（target_phase に 'manuscript' 追加＋講評プロファイル2種シード `…1006`/`…1007`。新テーブルなし）／講評も review_sessions/review_feedbacks に保存（verdict null・1実行1セッション・target_ref=プロジェクトid）／講評入力はペルソナの reference_scope で出し分け（scope をコードが解釈する初のケース）／読者講評はターゲット層未設定なら実行不可＋企画書へ誘導（フェイルクローズ）／標準ペルソナ・プロファイルは読み取り専用＋複製して編集（CHECK制約とRLSが既に強制）／PROFILE_BY_KIND 固定ID廃止→target_phase のDB検索に一般化／グラフはSVG折れ線自作（ライブラリ追加なし）／目標線（ページ→文字数換算）は見送り
- ユーザーレビューの指摘1件を反映: 講評の文字数ガードを**二段構え**に——長編小説は8万〜15万字なので**15万字超は実行前の確認メッセージ**（概算文字数提示・了承で実行）、**30万字超はエラーで実行不可**。15万字段の確認はクライアントで事前提示し確認済みフラグをリクエストに載せる、30万字段はサーバー最終ガード
- docs/SPEC-dashboard-critique-settings.md 策定 → ユーザーレビュー（上記1件反映）→ **確定**（2026-07-14）
- 別件対応: 要求仕様書 §6 スコープ外に「AIによる要約・あらすじ作成機能」「AIによるキャッチコピー作成機能」の2件を追記（いつかやりたい枠・2026-07-14）
- 次: 新規セッションで実装。マイグレーション（CHECK制約張り替え＋講評プロファイルシード）のプランモード承認から。**security-reviewer 必須ゲート**（/api/review の profileId/personaId 受け入れ=IDOR注意・設定CRUDのRLS/所有確認・PAT復号経路の拡張・プロバイダキー有無判定の情報非漏洩）。実装順の推奨: 設定画面（プロファイル/ペルソナCRUD）→プロファイル選択UI→講評→ダッシュボード（依存が薄い順）

### セッション⑰: Sprint 5前半 実装（SPEC-dashboard-critique-settings 全4項目）

- マイグレーション→実装4本を1セッションで縦通し。各ブロックごとに typecheck/lint→コミット、最後に security-reviewer ゲート→E2E→書き戻しの流れ。実装順は依存の素直さで **①レビュー一般化→②講評→③設定→④ダッシュボード**（SPECの推奨順から変更。②が①のセッション一般化に載るため）
- **マイグレーション `20260714000001_manuscript_critique_profiles.sql`**（コミット 9b7dddb・別途 security-reviewer 指摘ゼロ通過済み）: `review_profiles.target_phase` の CHECK制約を drop→add で張り替えて `'manuscript'` 追加＋講評プロファイル2種シード（読者講評 `…1006`=読者代表／書店員講評 `…1007`=近所の書店員。user_id null / is_default true / 固定UUID）。`lib/ai/personas.ts` に定数2件追加。本番DB適用は AskUserQuestion 承認後に `supabase db push`
- **① レビュー一般化（§3.2）**: `PROFILE_BY_KIND` 固定ID廃止→`getOrCreateReviewSession(kind, targetId, profileId, personaId?)` に一般化。クライアント指定の profileId/personaId を**サーバー側で再検証**（フェーズ一致・reviewer型）する共有ヘルパー `lib/review-validation.ts` を新設（講評でも使う）。`getReviewPanelBootstrap` でプロファイル/ペルソナ一覧＋running由来の既定選択を一括取得。レビューパネルにプロファイルセレクタ（**対象×プロファイルでセッション並存**・状態はプロファイル別キャッシュ）＋新規セッション時のみペルソナ選択。**approveProposal を sessionId 引数に変更**（並存で「対象の最新running」が一意でなくなるため。SPEC外の設計判断）
- **② 講評（§3.3）**: `/api/review` に `manuscript` 分岐——全原稿をパス辞書順に `## 相対パス` 見出しで結合、**ペルソナの reference_scope で企画書情報を出し分け**（`manuscript_only`=原稿のみ／`manuscript_plus_target`=原稿＋ジャンル・ターゲット層／`all`=原稿＋企画書全文。scope をコードが解釈する初のケース）。読者系はジャンル・ターゲット層未設定でサーバー側もフェイルクローズ。文字数ガード二段（15万字超=confirmLongフラグ必須／30万字超=実行不可）。読み切り型セッションは onFinish/onError が completed/failed に確定。`lib/actions/critique.ts`（bootstrap/作成/履歴）、全原稿取得を `lib/manuscript-content.ts` に切り出して進捗集計と共用。`critique-panel.tsx`（読み切り・折りたたみ履歴・15万字確認AlertDialog）＋原稿タブに講評ボタン（ファイル未選択でも押せる・校正パネルと排他）
- **③ 設定画面フル編集（§3.4）**: `lib/actions/settings.ts` に AIモデル設定（capability3行の upsert/削除）・ペルソナCRUD・プロファイルCRUD を追加。標準行（user_id null）の update/delete は RLS で0件→ not_found/validation に**出し分け**（「標準は複製してから編集」を可視化）。プロバイダAPIキー有無は `Boolean(process.env[...])` の**boolean のみ返す**（キー値は非漏洩）。`default_persona_id` は reviewer 型をサーバー再検証。`components/settings/`（model-settings / persona-list / profile-list ＋編集ダイアログ）、`/settings` を4セクション化。列挙ラベルは `components/settings/labels.ts` に集約
- **④ ダッシュボード（§3.1）**: `app/page.tsx` を「作業基地」に置き換え——プロジェクト概況カード（企画ステータス・締切カウントダウン〈JST・超過はdestructive〉・最新総文字数・直近30日のSVG折れ線・各タブ導線）。「今すぐ集計」は repo＋PAT設定済みのみ表示、`refreshWritingProgress`（既存集計を切り出して共用）。折れ線は emotion-line の流儀でSVG自作（ライブラリ追加なし）。プロジェクトゼロの空状態＋ノート導線維持
- **security-reviewer ゲート通過**（実装4本一括・コミット cc29b19〜5d0849a）: **Critical/High/Medium/指摘ゼロ**。IDOR（共有検証ヘルパーが全経路を通る）・approveProposal のセッション偽装（phase＋target_ref×project_id 検証）・標準行保護（RLS＋zodが is_default/user_id 注入を剥がす二重防御）・PAT非漏洩（トークンはGitHub API引数のみ、AppError正規化でログ/レスポンスに出ない）・キー有無の boolean 限定・anon フェイルクローズをすべて確認
- **E2E検証（SPEC §8・アプリ内ブラウザペイン＋DB直接確認）**: 手動集計（37,488字を当日行に upsert・DB確認）／プロファイル複製→編集（DB prompt 692字）→企画書レビューでカスタムプロファイル×読者代表を実行し**プロンプト編集内容が反映**（フィードバック1行目に「【カスタムレビュー】」）／**セッション並存**（企画書レビュー×担当編集 と カスタム×読者代表 が target_ref 同一で running 2本並存・DB確認）／ペルソナ選択が persona_id に記録／新規セッション時のみペルソナselect表示・既存は固定表示／書店員講評の完走（completed・verdict null・1096字）／読者講評のゲート（ターゲット層未設定で実行不可＋企画書誘導→設定後に実行可）／文字数ガード（定数を一時的に 3万/3.5万字へ下げて 15万字段の確認ダイアログと 30万字段の実行不可エラー両方を再現→定数を git で復元）／AIモデル設定の保存・デフォルトに戻す（行の upsert/削除をDB確認）・Google選択で警告バッジがリアクティブ表示／プロファイル削除→履歴の review_profile_id が null 化で残存／未認証で全経路が opaqueredirect（307→/login）／モバイル375px（ダッシュボード縦積み・講評ボトムシート・編集ダイアログが画面内）／既存の構成レビュー回帰
- E2E後の後片付け: 検証で作った講評セッション・カスタムプロファイル由来の宙ぶらりんセッションをDB削除（ai_model_settings の low 帯行は元からあるユーザー行なので残置）
- **Sprint 5前半（ダッシュボード・プロファイル選択・講評・設定フル編集）完了**。レビュー型ペルソナ6人全員に起用経路が通り、設定変更のみでモデル追従・プロファイル編集ができる状態に。次: Sprint 5後半の別SPEC＝**対話型ペルソナ（アシスタントのスケジュール提案・喫茶店のマスターの壁打ち・メモ化）**のインタビュー→策定。スコープ外に残ったキャラクターレビューの実行UI（プロファイル …1002 はシード済み・設定画面には表示される）も要検討
- **本番デプロイ完了**（dev-log書き戻し後にユーザー依頼で実施）: `npm run build` 成功→`npx vercel deploy --prod --yes`（dpl_5mrwC5EW41cytR89oCJZBb7ZwYmF・READY・https://nekonote-v2.vercel.app ）。本番の未認証アクセスで /・/settings・/projects・POST /api/review すべて 307→/login（returnTo付き・フェイルクローズ維持）を確認。マイグレーションは本セッション前半で本番DB適用済みのため環境整合

### セッション⑱: SPEC-conversational-personas インタビュー・策定（Sprint 5後半 入り口）

- 対話型ペルソナ（アシスタント・喫茶店のマスター）のSPECインタビューを2巡実施
  - 1巡目（方針）: 画面形態→**独立ページなし・ダッシュボード組み込み**（作業基地に相談相手が同居）／メモ化→**チャット内応答＋「ノートに保存」ボタン**（手帳→浄書の思想に合流）／スケジュール提案→**プロジェクト実データを渡す**（締切・目標・writing_progress）／掘り下げパネル→**アシスタント固定のまま据え置き**（壁打ちはダッシュボード側に集約）
  - 2巡目（派生する落とし穴）: 配置→**開閉式パネル**（デスクトップ=右サイド・モバイル=ボトムシートの既存流儀）／スレッド→**ペルソナごとに1本継続＋リセット**（スレッド一覧UIは作らない）／ノート保存→**全AI応答にボタン・無確認で即保存**（タイトル=本文1行目自動・タグなし・整理は後からノート側）／プロジェクトデータ→**セレクタで1件に絞る**（既定=締切が最も近いもの・リクエスト単位で切替可）
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: マイグレーションは部分ユニークインデックス1本のみ（`(user_id, persona_id) where note_id is null`＝「ペルソナごと1本」のDB保証＋get-or-createレース捕捉。新テーブル・シード変更なし）／アシスタントの reference_scope: 'chat_only' は変更しない（要求仕様がスケジュール役割と chat_only を併記→締切・進捗は「資料」でなく進捗メタデータとしてコードが同梱する解釈）／スケジュールコンテキストはサーバー組み立て（クライアントは projectId のみ・RLS越し取得でIDOR遮断・残日数はJST計算・マスターには何も同梱しない）／ノート保存は messageId 方式（本文をDBから読み直しクライアント改変を防ぐ）／既存 /api/chat を判別union（note / dashboard）に拡張して共用（履歴20件制限・onEnd差分保存はそのまま）
- 既存基盤の再利用が効いた: chat_threads/chat_messages は SPEC-ai-deep-dive の汎用設計（note_id null 予約済み）どおりで新テーブル不要。conversational ペルソナ2人もシード済み（マスターの description が既にメモ化を指示）
- docs/SPEC-conversational-personas.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-14）
- 次: 新規セッションで実装。マイグレーション（部分ユニークインデックス）のプランモード承認から。**security-reviewer 必須ゲート**（マイグレーション・/api/chat 拡張=projectId の所有確認とコンテキスト組み立て・saveChatMessageAsNote の所有確認）。スコープ外に残置: スレッド一覧・構造化スケジュール保存・メモの自動ノート化・キャラクターレビュー実行UI（…1002・引き続き別途検討）

### セッション⑲: Sprint 5後半 実装（SPEC-conversational-personas 対話型ペルソナ）

- マイグレーション（プランモード承認）→実装→security-reviewer→E2E→デプロイの縦通し。**Sprint 5後半（対話型ペルソナ）完了＝実装計画の全機能が本番に揃った**
- **マイグレーション `20260714000002_dashboard_chat_thread_uniq.sql`**（コミット 6209fa0・単体で security-reviewer **指摘ゼロ**）: 部分ユニークインデックス1本 `chat_threads (user_id, persona_id) where note_id is null`。SPEC §4.1 のSQLそのまま。本番DB適用は AskUserQuestion 承認後に `supabase db push` → pg_indexes で partial 付き存在と既存インデックス無傷を確認。レビューで確認済み: persona_id null 行が NULLS DISTINCT でユニーク対象外になるのはRLS上ゴミ行が自分に増えるだけで越境不可／`on delete set null` でユニークから外れても get-or-create は persona_id 検索なので衝突しない
- **実装**（コミット 93ab2a6）:
  - `lib/schemas/chat.ts`: `/api/chat` の context を**判別union化**（`{kind:'note', note}` / `{kind:'dashboard', projectId?}`）。既存クライアント（掘り下げパネル）も新形式に追従
  - `lib/actions/chat.ts`: `getOrCreateDashboardThread`（**conversational 型をサーバー側で再検証**・23505は取り直し・履歴読みは `loadThreadMessages` に共通化）／`saveChatMessageAsNote`（messageId 方式・**本文をDBから読み直し**・role='assistant' 検証・タイトル=1行目のMarkdown記号除去50字）／`resetDeepDiveThread` → `resetThread` に一般化
  - `app/api/chat/route.ts`: dashboard 分岐——スレッド実態とコンテキスト種類の照合（`note_id null` ⇔ kind の食い違いは validation）／`buildScheduleContext` で projects・writing_progress を**RLS越し取得**しサーバー組み立て（残日数JST・直近7日/30日境界の増分）／スケジュール同梱は `thread.persona_id === ASSISTANT_PERSONA_ID` のみ（マスターは chat_only 厳密適用）
  - `lib/ai/prompts.ts`: `buildDashboardChatPrompt`（ペルソナ description＋共通役割指示＋schedule ブロック。「データが欠けている項目は正直に伝え推測で数字を作らない」を明示）
  - `components/dashboard/consult-panel.tsx`: 相談パネル（右サイド/ボトムシートは既存流儀の fixed オーバーレイ）。**タブ2人は両方マウントしたまま表示切替**＝切替で状態が消えない。プロジェクトセレクタ（既定=締切最近傍・リクエスト単位）。「ノートに保存」は**DB保存済みメッセージidのみ有効**——ストリーミング直後はクライアント採番idでDBと不一致のため、onFinish 後に300ms/1500msの二段取り直しで履歴を差し替えて有効化（proofread-panel のレース吸収と同じ流儀）
- **security-reviewer ゲート**（実装一括）: **Critical〜Medium ゼロ・Low 2件→両方修正済み**——①/api/chat の dashboard 分岐にも persona_type 再検証を追加（PostgREST直叩きで作った reviewer 型スレッドの多層防御。正規経路は Server Action 検証済み）②進捗記録が疎な場合のペース計算を固定7/30日割りから**実記録間隔割り**に変更（`ProgressDelta {chars, days}`。過大な字/日をAIに渡さない）。確認済み観点: projectId の IDOR（RLS 0件→not_found）・自由文コンテキスト注入なし（dashboard 側は uuid のみ）・saveChatMessageAsNote の親スレッドRLS・resetThread の認可境界不変
- **E2E検証（SPEC §8 全12項目・アプリ内ブラウザペイン＋DB直接確認）**: パネル開閉（1280px=右サイド／852px・375px=ボトムシート）／タブ切替で別スレッド・別口調・**双方の状態保持**／リロード復元＋DBに note_id null のペルソナ別2スレッド／スケジュール相談で**実データが応答に**（総文字数37,488字を引用し、締切未設定は「記録がない」と正直に回答→締切日を質問）／セレクタ「指定なし」切替で「進捗データは見えていません」に変化／マスターの壁打ち（受け止め→深掘り質問1つ→常体まじり口調）→「メモにまとめて」で箇条書きメモ／ノートに保存→/notes に title=1行目50字で出現・「保存済み」＋リンク・DB確認／会話リセット（確認ダイアログ→全消去→もう一方のタブ無傷）／否定系: 未認証 fetch→/login リダイレクト・他人（架空）projectId→404 not_found・dashboard スレッドに note コンテキスト→400 validation／掘り下げパネル回帰（新 context 形式で従来どおり）／コンソール・サーバーログにエラーなし
- E2Eの副産物ノート2件（アシスタント応答・マスターのメモ）は実データとして残置（ユーザーの手帳に合流済み）
- 検証時の注意点（再現した既知事象）: Next.js dev バッジがボトムシート左下のリセットボタンに重なる（本番には存在しないオーバーレイ。E2EはJSクリックで回避）

### セッション⑳: SPEC-chat-thread-list インタビュー・策定（Sprint 6 入り口）

- Sprint 6 残置分その1「スレッド一覧UI」のSPECインタビューを2巡実施
  - 1巡目（方針）: 対象範囲→**ダッシュボード相談のみ複数スレッド化**（掘り下げは1ノート1本を維持・一覧にも載せない）／画面形態→**会話はパネルのまま・一覧だけ /chats を新設**（パネル内に一覧ビューは作らない）／タイトル→**先頭発言1行目の自動＋リネーム可**（AI生成なし）／「会話をリセット」→**「新しい会話」に置き換え**（旧スレッドは履歴として残る）
  - 2巡目（派生する落とし穴）: パネル初期表示→**最後に更新したスレッドを継続**（現行の使い勝手を維持）／一覧の導線→**行クリックでダッシュボード遷移→パネル自動オープン**（`?consult=<threadId>` クエリ方式）／掘り下げスレッドの一覧掲載→**載せない**／削除→**確認ダイアログ→完全削除**（ごみ箱なし。救済は「ノートに保存」で済んでいる整理）
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: マイグレーション1本のみ（部分ユニークインデックス `chat_threads_user_persona_dashboard_uniq` の撤去=SPEC-conversational-personas §4.1 の予告どおり＋ `title` 列追加＋既存スレッドのタイトルバックフィル。新テーブルなし）／「新しい会話」はDB行を作らない（スレッドは初回送信時に作成=空スレッドを構造的に溜めない。インデックス撤去後は23505ハンドリング不要）／updated_at 問題の同時解決（メッセージ保存がスレッド行を触らず「最終更新」が動かない → /api/chat の onEnd に `title = coalesce(title, 先頭発言から整形)` のUPDATE 1本でタイトル自動設定と updated_at バンプを兼ねる。リネーム済みは coalesce で保護）／タイトルはサーバー側で本文から生成（noteTitleFrom を共通化・クライアント注入不可）／getOrCreateDashboardThread → getLatestDashboardThread + createDashboardThread に分割／`?consult=` は note_id null 検証（掘り下げスレッドを相談パネルで開かせない）／グローバルナビに /chats は足さない（導線はパネルヘッダーの「履歴」リンク）／一覧用の専用インデックス・ページネーション・検索は追加しない（一人利用の件数規模）
- docs/SPEC-chat-thread-list.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-14）
- 次: 新規セッションで実装。マイグレーション（インデックス撤去＋title列＋バックフィル）のプランモード承認から。**security-reviewer 必須ゲート**（マイグレーション・`?consult=` 経由スレッド読み込みのIDOR・renameThread / deleteThread の所有境界・タイトル自動設定のサーバー側生成）。Sprint 6 の残り: 構造化スケジュール保存・メモの自動ノート化 → キャラクターレビュー実行UI → middleware→proxy移行

### セッション㉑: Sprint 6 実装（SPEC-chat-thread-list スレッド一覧UI）

- プランモード承認→マイグレーション→実装→E2E→security-reviewer→デプロイの縦通し。**Sprint 6 残置分その1（スレッド一覧・複数スレッド化）完了・本番反映済み**
- **マイグレーション `20260714000003_chat_thread_list.sql`**（AskUserQuestion 承認後に db push）: `chat_threads_user_persona_dashboard_uniq` 撤去＋`title text` 追加＋既存ダッシュボードスレッドのタイトルバックフィル（最初の user 発言の最初の非空行→先頭Markdown記号除去→50字。`regexp_match` の式は事前に `db query --linked` の SELECT で単体検証してから適用）。メッセージ0件の既存スレッドは title null のまま=「無題の会話」表示で正しい挙動
- **実装**（コミット 4aa7d74）:
  - `lib/chat-title.ts` 新設: noteTitleFrom を `chatTitleFrom` として共通化（'use server' ファイルは非アクション関数を export できないため別モジュール必須）。ノート保存タイトルとスレッド自動タイトルで共用
  - `lib/actions/chat.ts`: getOrCreateDashboardThread を **getLatestDashboardThread**（なければ作らず threadId null）＋ **createDashboardThread**（初回送信時）に分割。conversational 再検証は `assertConversationalPersona` に抽出。**getDashboardThreadById**（`?consult=` 導線＋応答後同期用・note_id null 検証）／**listConsultThreads**／**renameThread**（zod trim 1〜100字・`.is('note_id', null)`）／**deleteThread**（resetThread 改名・`.select('id')` 0件→not_found 強化。掘り下げパネルと共用）
  - `app/api/chat/route.ts` onEnd: dashboard のみ `update({title}).is('title', null)`（サーバー側生成・リネーム保護）＋ updated_at バンプ UPDATE。coalesce 1クエリ案は supabase-js で表現できないため is-null ガード＋バンプの2クエリに（レース安全で同等）
  - `components/dashboard/consult-panel.tsx`: 初期ロードを最新スレッド取得に変更（未作成なら空の新規会話状態）。「会話をリセット」→**「新しい会話」**（ダイアログなし・ローカル状態クリアのみ・スレッドは初回送信時に作成）。ヘッダーに「履歴」リンク。`?consult=` はパネル自動オープン→担当タブアクティブ→該当スレッドをシード（`key={initialThreadId}` でスレッド間遷移を remount で処理）。ConsultChat は threadId nullable＋ref 二重持ち（送信時作成と同期タイマーの整合）
  - `app/chats/page.tsx`＋`components/chats/thread-list.tsx`: 一覧（更新日時降順・ペルソナ名バッジ・無題は「無題の会話」）・行クリック→`/?consult=`・DropdownMenu からリネーム（Dialog）／削除（AlertDialog destructive→完全削除）。空状態＋ダッシュボード導線
  - lint の `react-hooks/set-state-in-effect` に1回引っかかった→ `?consult=` 変化でのパネル再オープンは「render中のprop派生setState」パターンに書き換えて解消
- **E2E検証（SPEC §8 全11項目・ブラウザペイン＋DB直接確認）**: 新しい会話でDB行が増えない→送信で作成／同一ペルソナ2本並存（DB確認）／タイトル自動設定（`## ` 除去）・2通目で非上書き・updated_at バンプ／閉じて開き直すと最新スレッド継続／/chats 降順＋バックフィル済みタイトル＋掘り下げ非掲載／行クリック→自動オープン＋マスタータブアクティブ／リネーム→反映＋以降も自動設定に上書きされない／削除→cascade でメッセージ消滅・他スレッド無傷／掘り下げ回帰（履歴表示・リセット健在）／未認証 /chats→307 /login・架空 threadId と掘り下げ threadId の `?consult=` 直打ち→パネル内 not_found／モバイル375px（一覧・メニュー・ダイアログ・パネル自動オープン）
- **security-reviewer ゲート**: **Critical〜Medium ゼロ・Low 2件**——①デプロイ順序依存（インデックス撤去済みDB×旧コードの maybeSingle が複数行エラー）→**本番が実際にこの状態になったため即デプロイで解消**（マイグレーション先行適用＋E2Eでスレッドが増えた時点で本番パネルが壊れる構図。次回から「本番適用は原則デプロイ直前」を意識）②renameThread の note_id 絞りなし（所有境界内で実害なしの厳密化）→`.is('note_id', null)` 追加済み
- **本番デプロイ完了**: push→`npx vercel deploy --prod --yes`（dpl_8Zx2bP1VqWpfwEWSFK44rztRYiVS）。本番 /chats が 307→/login（returnTo付き）で新ルート稼働を確認
- 次: Sprint 6 残り＝構造化スケジュール保存・メモの自動ノート化 → キャラクターレビュー実行UI（…1002）→ middleware→proxy 移行。R2期日 8/11 まで磨き込み

### セッション㉒: SPEC-schedule-and-memo-tools インタビュー・策定（Sprint 6 その2 入り口）

- Sprint 6 残置分その2「構造化スケジュール保存・メモの自動ノート化」のSPECインタビューを2巡実施
  - 1巡目（方針）: データの形→**マイルストーン列＋日次ペース目標の両方**／保存経路→**AIツール呼び出し**（「これで確定して」でアシスタントが構造化保存。フォーム手動入力は作らない）／表示→**既存の概況カードに統合**（独立カード・ページなし）／メモ自動化→**AIツール呼び出し**（「メモにまとめて保存して」でノート作成）
  - 2巡目（派生する落とし穴）: 上書き方針→**1プロジェクト1本・上書き**（世代管理なし。過去提案はチャット履歴に残る）／達成判定→**併用**（任意の目標総文字数があれば writing_progress と自動比較・なければ手動チェック）／確認フロー→**無確認で即保存**（発話が同意。チャット内に結果カード・誤保存はカード側/ノート側の削除で救済）／ツール範囲→**ノート化は両ペルソナ**＋手動「ノートに保存」ボタン存続
- インタビューで聞かずに設計原則で決めた点（レビューで確認済み）: **新テーブルなし・`projects.schedule` jsonb 1列のみ**（手帳→浄書の「システム管理の構造は最小」に従い、丸ごと上書きのデータをテーブル分解しない。RLS/cascade は projects のまま）／ツール登録は dashboard 分岐のみ（掘り下げ回帰ゼロ）・saveSchedule は**アシスタント×プロジェクト選択時のみモデルに見える**／マイルストーン id サーバー採番・上書きで done リセット／**ツール結果カードはセッション内表示のみ**（chat_messages はテキストのみ保持のまま。プロンプトで「保存後は締めの文で要約」を義務化し履歴に痕跡を残す）／保存済みスケジュールをスケジュールコンテキストに同梱（改訂提案の土台）／達成表示 = done || 文字数達成／削除は概況カードから（チャット削除ツールなし）。AI SDK v7 の `tools`＋`stopWhen` を本アプリ初導入
- docs/SPEC-schedule-and-memo-tools.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-14）
- 次: 新規セッションで実装。マイグレーション（`projects.schedule` jsonb 追加）のプランモード承認から。**security-reviewer 必須ゲート**（マイグレーション・ツール execute の RLS 書き込み/zod/インジェクション耐性・toggleMilestone / deleteSchedule の所有境界）。Sprint 6 の残り: キャラクターレビュー実行UI（…1002）→ middleware→proxy 移行

### セッション㉓: Sprint 6 実装（SPEC-schedule-and-memo-tools 構造化スケジュール保存・メモの自動ノート化）

- プランモード承認→マイグレーション→実装→E2E→security-reviewer→Low修正の縦通し。**Sprint 6 残置分その2完了**。AI SDK v7 の `tools`＋`stopWhen: stepCountIs(3)` を本アプリ初導入
- **マイグレーション `20260714000004_project_schedule.sql`**（AskUserQuestion 承認後に db push）: `projects.schedule` jsonb 追加のみ。nullable 列追加=旧コード非破壊なのでデプロイ前適用で安全（セッション㉑の教訓と整合）
- **実装**:
  - `lib/schemas/schedule.ts` 新設: `scheduleSchema`（dailyTargetChars・milestones 最大20件・savedAt）／ツール入力 `saveScheduleInputSchema`（id/done/savedAt は受け取らない・`z.iso.date()`・refine で日次目標かマイルストーン必須）／`saveMemoNoteInputSchema`（1〜10,000字）／達成判定 `isMilestoneAchieved`（done || targetChars≦最新総文字数）をプロンプト整形とUIで共用
  - `app/api/chat/route.ts`: dashboard 分岐に `buildDashboardTools`——**saveMemoNote**（両ペルソナ。notes insert・user_id はDBデフォルト auth.uid()）＋**saveSchedule**（アシスタント×projectId 選択時のみ登録=それ以外はモデルからツール自体が見えない構造的ガード）。execute は RLS 越し supabase をクロージャで掴み、失敗は throw せず `{ok:false}` で返してモデルに正直に言わせる。id サーバー採番・done リセット・期日昇順整列。note 分岐は tools undefined=掘り下げ回帰ゼロ
  - `lib/ai/prompts.ts`: ツール使用指示（**「提案して」は提案止まり・確定の言葉を待つ**／saveSchedule が使えない状況でメモ代替せずプロジェクト選択を促す——どちらもE2Eで実際に踏んだ穴への対処）＋「# 保存済みの執筆スケジュール」ブロック（達成状況込み・未保存は（未保存））
  - `lib/actions/schedule.ts` 新設: `toggleMilestone`（zod safeParse→done のみ書き換え）／`deleteSchedule`（schedule=null）。RLS 越し 0件→not_found の流儀
  - `components/dashboard/consult-panel.tsx`: tool part を `isStaticToolUIPart` で判定しテキストと別カード表示（実行中スピナー→保存カード。saveMemoNote は `/notes/<id>` リンク付き）。**DB履歴同期がテキストのみで差し替えるとカードが即消える問題**→ role＋テキスト一致の順方向マッチで tool part を引き継ぐ `mergeToolParts` を同期に挟む（SPEC どおりリロード後は消える）。saveSchedule 成功時は `router.refresh()` で背後の概況カードを即時更新
  - `components/dashboard/project-overview-card.tsx`＋`app/page.tsx`: schedule があるときだけスケジュールブロック（日次目標＋series からの直近7日実ペース並記／マイルストーン一覧=チェックボックス・期日カウントダウン・残り字数 or 達成／ゴミ箱→AlertDialog→削除）。jsonb は読み出し全経路で safeParse・不正データは未保存扱い
- **E2E検証（SPEC §8 全14項目・ブラウザペイン＋DB直接確認）**: 提案→「確定して」で保存カード＋締めの文／DB に採番済み schedule／別内容で上書き（世代増えず・**手動チェック済み done もリセット**）／チェック→リロード保持／targetChars≦総文字数で自動達成表示／概況カードから削除→DB null／マスター・アシスタント両方の「メモにまとめて保存して」→整形メモがノート化（title=1行目50字）＋リンク／素の相談ではツール不発／「指定なし」で確定を頼んでも保存されない（ツール未登録）／手動「ノートに保存」ボタン回帰／掘り下げでツール一切なし／未認証→307 /login・架空 projectId→404 not_found／モバイル375px（カード・ブロック・チェック・削除成立）
- E2E中に2回プロンプトを調整: ①初回実装では「提案してください」だけで即保存された→「提案は提案止まり」を明示 ②「指定なし」で確定を頼むと saveMemoNote で代替保存した→「メモ代替せずプロジェクト選択を促す」を明示。**ツールの見える/見えないは構造で守り、振る舞いの機微はプロンプトで矯正**という分担がはっきりした
- **security-reviewer ゲート**: **Critical〜Medium ゼロ・Low 3件→全て修正済み**——①toggleMilestone の select→update 間 TOCTOU（チャット確定と競合すると巻き戻る）→ `savedAt` の楽観比較を UPDATE 条件に追加・0件は conflict ②uuid 検証失敗が internal に化ける→ safeParse＋validation に ③execute 内 scheduleSchema.parse の throw が errorText に乗りうる→ safeParse＋`{ok:false}` に統一。確認済み観点: RLS 所有境界（buildScheduleContext 先行遮断＋UPDATE 0件の二重）・projectId はサーバー側クロージャ固定=モデルは書き込み先を選べない・内部エラー文言の固定化・service_role 不使用
- E2Eの副産物: 竜の巣に検証スケジュール（8/2各章の要点・8/11提出版完成・1日1,000字）が保存済み＝実運用の初期値としてそのまま使える。メモノート3件も手帳に残置
- 次: 本番デプロイ→Sprint 6 の残り＝キャラクターレビュー実行UI（…1002）の要否検討 → middleware→proxy 移行。R2期日 8/11 まで磨き込み

### セッション㉔: SPEC-character-review 策定＋実装（Sprint 6 その3・キャラクターレビュー実行UI）

- SPECインタビュー2巡→策定・確定→実装→E2E→security-reviewer を1セッションで縦通し。**標準プロファイル5種すべてに起用経路が通った**
  - 1巡目（方針）: 対象単位→**企画書に紐づく資料一式**（target_ref = 企画書id。プロファイルの「渡された資料から主要キャラクター（特に主人公）」と整合）／置き場所→**企画書画面に統合**／セッション型→**反復フィードバック型**（構成・シーンと同じ）／資料範囲→**企画書＋紐づけノート全部**（担当編集の reference_scope: all と整合・キャラ観点はプロファイルが絞る）
  - 2巡目（落とし穴）: 入り口→**ツールバーにボタン2つ（「レビュー」「キャラクター」）・パネル排他表示**（共通 ReviewPanel 無改造）／企画書ステータス→**完全に無関係**（draft→in_review 遷移は企画書レビュー専用のまま・approved 後も実行可・判定なし）／紐づけノート0件→**実行可・ガードなし**（資料不足はプロファイル自身が指摘する設計）
- docs/SPEC-character-review.md 策定 → ユーザーレビューで指摘なし → **確定**（2026-07-14）
- **実装（マイグレーションなし・3ファイルのみ）**:
  - `lib/actions/review.ts`: ReviewTargetKind / スキーマに `'character'` 追加。resolveTarget は proposal 分岐に相乗り（`kind === 'proposal' || kind === 'character'`）
  - `app/api/review/route.ts`: 企画書＋紐づけノート取得を `fetchProposalWithNotes` に抽出し proposal / character の共通分岐に。verdict は `phase === 'proposal'` のみ parseVerdict（character は常に null）・`proposalIdForStatus` も proposal のみ
  - `components/projects/proposal-editor.tsx`: `showReview` boolean を `openPanel: 'proposal' | 'character' | null` に置き換えて排他表示。キャラクター側は共通 ReviewPanel 直使用（showVerdict なし・フッターなし・flushSave 共用）
- **E2E検証（SPEC §8 全10項目・ブラウザペイン＋DB直接確認）**: 2ボタン排他表示（aria-pressed 切替・パネル1枚のみ）／実行→担当編集の口調で5つの問いに沿った講評ストリーミング（1,954字・DB verdict NULL・target_phase character）／返答メモ→再実行で「前回指摘の改善確認」から開始（企画書が一字一句同じことまで見抜いた）／同一企画書で proposal・character の running セッション並存（DB確認・structure とも3本並存）／proposals.status 不変（in_review のまま）／紐づけノート0件で実行→「あらすじレベルに留まっている」と資料不足を指摘／プロファイルselectは character フェーズのみ表示／企画書レビュー回帰（判定バッジ・既存セッション健在）／未認証 POST→307 /login（returnTo付き）・架空 sessionId→404 not_found／モバイル375px（ボタン収まり・ボトムシート・フィードバック表示）。コンソール・サーバーログにエラーなし
- **security-reviewer ゲート**: **指摘ゼロ（Critical〜Low なし）**。確認済み観点: resolveTarget character 分岐の RLS 所有確認（proposals_owner_via_project・WITH CHECK 二重）／fetchProposalWithNotes 抽出後も project_id 一致検証が両フェーズで保持／character セッションで企画を通す抜け道なし（approveProposal の target_phase 検証＋verdict null の二重で不成立）／resolveProfileForPhase のフェーズ一致強制／既存4フェーズの認可境界に弱化なし
- E2Eの副産物: 竜の巣のキャラクターレビューセッション（第1回・第2回＋返答メモ）は実データとして残置。※返答メモの文面（欠点・代償を追記予定）は検証用にClaude が書いたもの——実際の改稿方針は作者が上書きしてよい
- 次: 本番デプロイ→Sprint 6 の残り＝middleware→proxy 移行。R2期日 8/11 まで磨き込み

### セッション㉕: Sprint 6 その4（middleware→proxy 移行の本番反映）＋環境変化の確認

- **middleware→proxy 移行完了・本番反映済み**。移行自体はセッション㉔後の別ブランチ作業（コミット f9baf6e・7/13）で実施済みだったが、ブランチ `claude/friendly-tesla-45ca32` に取り残されて main 未反映だったことが判明 → main へ cherry-pick（コミット 6d973f3）
  - 変更はリネーム＋関数名変更のみ（`middleware.ts` → `proxy.ts`・`middleware` → `proxy`・SPEC-auth の参照5箇所更新）。config.matcher と updateSession のロジックは無変更
  - typecheck / lint パス。**security-reviewer ゲート通過（指摘ゼロ）**: Next 16.2.10 実装で proxy 規約準拠を裏取り（`PROXY_FILENAME`・`isProxy ? mod.proxy : mod.middleware`・src なし構成でルート直下が正）・実ビルドで `ƒ Proxy (Middleware)` 組み込み確認・旧 middleware.ts 残存なし・参照切れなし（`lib/supabase/middleware.ts` は内部ライブラリなのでファイル名そのままで正しい）
  - 片付け: ブランチ `claude/friendly-tesla-45ca32` と worktree `.claude/worktrees/friendly-tesla-45ca32/` を削除
- **環境変化: Vercel の Git 連携が接続された**（main への push で本番へ自動デプロイ。6d973f3 の push で自動ビルド・Ready・非推奨警告 middleware-to-proxy の消滅をビルドログで確認）。手動 `npx vercel deploy --prod --yes` は不要になった＝フェーズ4フローの⑧CI/CD の土台が完成
- **Sprint 6 の残置機能4項目がすべて消化完了**。Sprint 6 の残りは「GitHub Issue 駆動の修正自動化フロー構築」のみ（アプリのソースコードにはほぼ手が入らない作業＝CLAUDE.md への③判断基準明記・Issueテンプレート等のGitHub側整備・フローの試運転1件）
- 次セッションの方針（本セッションで合意）: **全体コードレビューを先に実施**（コードベースが静止状態の今が好機。認証・RLSは毎回ゲート済みなので品質・保守性寄りの観点に重心）→ 指摘を Issue 起票 → 自動化フロー構築 → **起票済み Issue を題材にフローを一度通す**（Sprint 6 完了条件の消化と一石二鳥）。その後 7/17〜20 ドッグフーディング。R2期日 8/11

### セッション㉖: コードレビュー指摘の全件修正（code-review-20260714.md 消化）

- レビューセッションが `docs/code-review-20260714.md` に記録した**全9件（Critical/High ゼロ・Medium 3・Low 6）を1件ずつ要否検討→全件「修正する」と判断→1指摘=1コミットで消化**（計8コミット・L-6は3点まとめて1件扱い）。各コミットにレビュー記録の状態更新を同梱し、末尾に「対応結果」テーブル（指摘→コミット→要点）を追記
- 判断が入った3箇所:
  - **M-2（楽観ロックの保護範囲）**: レビュー提案は「revカウンタ新設 or コメント明示」だったが、`savedAt` がUI・プロンプトのどこにも表示されない内部値であることを先に確認し、**新フィールドを足さず `savedAt` を「最終書き込み日時＝リビジョン」と再定義してトグルでもバンプ**する第3案を採用。スキーマ変更ゼロでトグル同士の競合も conflict 検出になった
  - **M-3（ツール出力契約の共有化）**: `SaveMemoNoteOutput` / `SaveScheduleOutput` を lib/schemas/schedule.ts に定義し、route.ts の execute 戻り値注釈とクライアントの結果カードで共用。zodスキーマ化（safeParseでアサーション除去）は**ツール出力が実際に複雑化するまで見送り**＝設計原則「頼まれていない抽象化を足さない」側に倒した
  - **L-2（deleteSchedule の競合ガードなし）**: 挙動は変えず「削除＝今あるものを消す意図なので楽観比較しない」を設計判断として doc コメントに明文化するだけに留めた
- 新設は `lib/writing-progress.ts`（L-3）: 「境界日以前の直近記録を基準に実スパンで割る」増分計算を純関数 `deltaSince` に一元化。AIが語る数字（route.ts の delta7/delta30）とカードの数字（recentPace）が別実装で食い違うリスクを解消
- M-1 は `mergeToolParts` を「マッチしなかったカード保持メッセージを捨てずに元の並び位置へ残す」方式に変更（締めテキストなし応答はDB未保存＝差し替えで保存成功カードごと消え、二重保存を誘発していた）。残りは小粒: L-1 日付フォーマッタに `timeZone: "UTC"` 明示／L-4 refresh判定に `output.ok` 追加／L-5 空タイトルは「メモ YYYY-MM-DD」フォールバック／L-6 onEnd のUPDATE統合（タイトル設定経路は set_updated_at トリガーにバンプを任せる）ほか
- **検証**: 修正ごとに typecheck / lint 通過（Editフックの自動typecheckが中間状態のエラーも都度検知）。ブラウザペインでダッシュボード描画（L-1修正後の期日ラベル「8/2（あと19日）」）とマイルストーントグルON→OFF実操作（M-2の savedAt バンプ後も楽観比較が正常・状態復元）・コンソール/サーバーログのエラーなしを確認。M-1 の再現条件（モデルが締めテキストを返さない）はAI応答依存で決定的再現不可のためロジック・型検証まで
- セッション㉕の計画では「指摘を Issue 起票→自動化フローの題材に」だったが、レビュー記録が docs 内のチェックリストとして完結していたため**本セッションで直接消化**した。Issue 駆動フローの試運転題材は別途用意する
- 次: GitHub Issue 駆動の修正自動化フロー構築（Sprint 6 残り）→ 7/17〜20 ドッグフーディング。R2期日 8/11

### セッション㉗: セキュリティ監査指摘の消化（security-audit-20260714.md・Medium 1＋Low 5）

- セッション㉖と同じ流儀で、監査記録の**全6件を1件ずつ要否検討→修正4件・対応不可1件・対応しないを維持1件**。1指摘=1コミット（計4コミット）・各コミットに監査記録の状態更新を同梱し、末尾に「対応結果」テーブルを追記
- **M-1（レートリミット）→ `2ee2c72`**: `lib/rate-limit.ts` 新設——ユーザー×エンドポイント単位のインメモリ固定ウィンドウ（毎分・毎日の二段）。chat 10回/分・300回/日、review / proofread 各3回/分・60回/日を認証チェック直後（LLM呼び出し前）に適用。`AppError` に `rate_limited`（429）を追加。監査の注記どおりVercelのインスタンス分離で厳密性は落ちるが、目的（セッション奪取・暴走スクリプトによるコスト暴走の抑止）には足りる。単一ユーザー前提の固定値運用＝複数ユーザー化時は永続ストア方式を再検討とコメントに明記
- **L-1（DB由来 repo の使用時再検証）→ `138283d`**: `repoSchema` を lib/schemas/projects.ts の共有スキーマに切り出し（入力時検証と共用）、`lib/git/github.ts` で repo をURLに連結する全4箇所（/repos・trees・contentsApiPath・commits）を `validRepo()` 経由に。**GitHub API呼び出しは全経路（review・proofread・Server Action）がこのラッパーを通るため、呼び出し側7箇所に散らさず一箇所で担保**——manuscriptFilePathSchema の使用時再検証と対称の多層防御
- **L-2（server-only）→ `517aad6`**: APIキーを直接読む lib/ai/models.ts に `import 'server-only'` を1行追加（crypto.ts・git/* と同じ扱いに統一）
- **L-3（サイズ上限）→ `f8ba40d`**: ノート本文に10万字（チャットの noteContextSchema と同値）・タイトル500字、ペルソナ description 1万字・prompt_template 2万字・各 name 100字の max を追加。監査が「検討」としていた**レビュー入力組み立て時の合計文字数ガードも実装**——企画書・キャラクターレビュー（紐づけノート全文を結合する経路）に `CRITIQUE_MAX_CHARS` 流用の30万字上限
- **L-4（next同梱 postcss）**: `npm view` で再確認——next@16.2.10 が依然最新（canary含め全バージョンが脆弱な postcss に依存）＝パッチ待ち継続。`npm audit fix --force` は next@9 ダウングレードになるため実行禁止（監査記録に明記済み）
- **L-5（プロンプトインジェクション残余）**: 監査時の「対応しない（単一ユーザー制では受容可能）」判断を維持。複数ユーザー化・共有機能導入時に再評価必須
- **検証**: 修正ごとに typecheck / lint 通過、最後に本番ビルド（`npm run build`）成功を確認
- **コード外の残作業はユーザー対応の手作業として実装計画 §5 に転記**（`セキュリティ監査（7/14）からの手作業` 節・チェックリスト6項目）: プロバイダのスペンド上限＋アラート（M-1対策1・最優先）／Supabase Security Advisor＋マイグレーション適用状態／auth.users トリガーの本番存在確認／Auth設定／Vercel環境変数の露出範囲／Google OAuth リダイレクトURI。ユーザーが適当なタイミングで実施する
- 次: GitHub Issue 駆動の修正自動化フロー構築（Sprint 6 残り）→ 7/17〜20 ドッグフーディング。R2期日 8/11

### セッション㉘: GitHub Issue駆動の修正自動化フロー構築＋試運転一巡（Sprint 6 完了・7/15）

- フェーズ4フローの基盤3点を整備: ①CLAUDE.md に③設計確認の判断基準を明記（`9eae809`）②Issueテンプレート2種（不具合報告・要望、YAMLフォーム形式。`2fab68d`）③**プロジェクトスキル `/fix-issue`**（`73ae97c`）——Issue番号を引数に ②影響範囲分析→③設計確認分岐→④修正＋typecheck/lint＋実画面確認→⑤subagent自己レビュー→⑥PR作成（`Closes #N` 付き）を一気通貫。main直push・自己マージは禁止事項として明記。起動方式は「ローカルセッションでスキルを叩く」を採用（GitHub Actions化は従量課金が別途発生するため、単一ユーザー運用では見送り＝最もシンプルな方法の原則）
- **試運転一巡完了 = Sprint 6 完了条件達成**: Issue #1（ログイン画面キャッチコピーに「ニャ」）→ `/fix-issue 1` → 分析（同文が layout.tsx の metadata にもあるがIssueの「対象はログイン画面」明記によりスコープ外と判断）→ ③基準に該当なしでルーティンルート → 1行修正・検証 → 自己レビュー「問題なし」→ PR #2 作成
- **⑦で人間の差し戻しが1回発生**（良い試運転になった）: 「する。ニャ」ではなく「するニャ。」が意図——PRレビューコメントで受領 → ④に戻って再修正・再検証・push でPR自動更新、という差し戻しループが自然に回ることを確認。**Issueの例示文言をそのまま実装したが、句読点の位置のような機微は例示に引きずられうる**——起票時に最終文言を正確に書くのが確実
- マージ（`b985e95`）→ Vercel自動デプロイ → 本番 /login 本文が「伴走するニャ。」・metadata は原文のままを curl で確認 → Issue #1 自動クローズ確認。⑧まで完走
- 運用メモ: リモートブランチ削除（`git push origin --delete`）は自動モードの権限判定でブロックされる → GitHubリポジトリ設定「Automatically delete head branches」を有効にすれば片付け自体が不要になる（ユーザー対応推奨）
- 次: 7/17〜20 ドッグフーディング（Sprint 7）——発見した問題を Issue 起票 → `/fix-issue` で回す。R2期日 8/11

### セッション㉘ 追記: ユーザーマニュアル作成＋ドッグフーディング用テストデータ整備

- **`docs/manual.md` 新設**（コミット `5148a18`・READMEにリンク追加）: 全11章。§1〜9 は全SPECを読み込んで執筆フェーズ順に機能を説明、§10 が保守対応（Issue起票のコツ・/fix-issue の使い方・③設計確認の5条件・差し戻し手順・緊急時対応）、§11 が制限事項とエラー対処表
- **テストデータ整備**（本番DB・ユーザー依頼による書き込み）: 既存データの棚卸し（過去E2Eの残置分が想定以上に充実——竜の巣プロジェクト・シーン7枚アンカー/感情込み・レビューセッション3種・校正提案4件・相談/掘り下げスレッド4本・スケジュール保存済み）→ 不足分のみ補充:
  - 企画書の紐づけノート0件 → 「カイ（主人公）」（5つの問い構造・キャラクター＋竜の巣タグ）「竜の巣 世界観メモ」（竜の巣タグ）の2枚を作成して紐づけ（企画書・キャラクターレビューの材料が揃った）
  - writing_progress 1点のみ（折れ線は2点以上で表示）→ 7/9〜7/13 の5日分をバックフィル（28,400→36,500字の漸増。7/14 実測 37,488 に接続）
  - projects.deadline / target_pages が NULL → 2026-08-11・120p を設定（締切カウントダウン・スケジュール助言の実データ検証用）
- 副産物の学び: `npx supabase db query --linked` は INSERT/UPDATE も通る（CTEでまとめれば1クエリで完結）。テストデータは実測値（7/14 の37,488字）と矛盾しない値を選ぶこと

### セッション㉙: Gemini API 有効化＋セキュリティ監査残作業の消化（7/15）

- **Gemini API 有効化**: コード側は対応済み（`@ai-sdk/google` 導入済み・`lib/ai/models.ts` のプロバイダ解決あり）で、不足はキーのみだった。`GOOGLE_GENERATIVE_AI_API_KEY` を .env.local＋Vercel Production に登録（キー登録はユーザー・確認と整理はAI）→ キー有効性を `gemini-3.1-flash-lite` への直接呼び出しで確認 → 再デプロイ（ユーザー）→ 設定画面で low を `anthropic/claude-haiku-4-5` から `google/gemini-3.1-flash-lite` へ切替。**high=Claude / medium=GPT / low=Gemini の3プロバイダ体制が要求仕様 §4.4 どおりに揃った**。.env.local.example にAIキー3社＋ENCRYPTION_KEY の記載を追加（`1f1d695`）
- 権限判定の学び: `npx vercel redeploy`（本番再デプロイ）と本番DBへの直接UPDATE（ai_model_settings の切替）はどちらも自動モードでブロックされる → 再デプロイ・切替ともユーザー操作で対応（設定UIの実地確認を兼ねられたので結果オーライ）
- **セキュリティ監査（7/14）の手作業残を5/7消化**（チェック状況は実装計画の該当節に反映済み）:
  - マイグレーション適用確認: `npx supabase migration list --linked` で突合。確認途中に Issue #5 の仕掛かり分（20260715000001）が未コミット・未適用と検出されたが、別セッションの PR #9 マージ＋db push で解消され、最終確認では**全11本が本番適用済み**
  - 手動作成オブジェクトの棚卸し: information_schema 照会で public 19＋private 1 テーブルすべてマイグレーション由来・ビューなし・Storageバケット0件
  - `auth.users` トリガー存在確認: `check_email_allowlist_before_insert` が本番に存在（pg_trigger 照会）
  - Auth設定確認: リダイレクトURL許可リストは `http://localhost:3000/**` の1件のみ＝合格。**本番URLが動く理由は GoTrue の「Site URL とのホスト名一致による暗黙許可」**（許可リストは Site URL 以外のホスト専用。検証失敗時はエラーではなく Site URL へ静かにフォールバックし、コードが `/` に落ちて middleware に弾かれログイン不能になる——独自ドメイン移行時の要注意ポイント）
  - Vercel環境変数: AIキー3本とも `NEXT_PUBLIC_` なし・Production のみ登録
  - Google OAuth: Google側の管理誤りが発覚しクライアントを作り直し。承認済みリダイレクトURIは Supabase コールバック（`.../auth/v1/callback`）1件のみの最小構成に整理し、本番ログイン確認済み
- 残: **AIプロバイダのスペンド上限＋アラート**（M-1・最優先）と**漏洩パスワード保護の有効化**、Issue #7/#8 の消化。次は 7/17〜20 ドッグフーディング（Sprint 7）

### セッション㉚: 縦書きエディタ構想→SPEC-vertical-editor 策定・確定（7/15〜16）

- 開発が一段落したタイミングで、要求仕様 §7 スコープ外（「将来的には実装したい」）の**縦書きエディタ**の構想を策定。既存ツール調査（縦式・TATEditor・Nola・Vivliostyle）→ 提案 → SPEC草案 → 挿絵要件追記 → 未決論点インタビュー → **確定**（`e00a9cd`）まで縦通し
- **コンセプト「エディタで組版しない」**: 執筆は横書きプレーンテキスト（VFM）、縦書き表示・ノンブル・目次・奥付・入稿PDFは Vivliostyle（CSS組版）に全面委譲。組版エンジンの自作には踏み込まない。プレビューと入稿PDFが同一エンジンなので「見た目のズレ」が原理的に起きない
- **ネコノテとのシナジーが設計の軸**: 原稿は要求仕様 §3.4 の原稿モノレポをそのまま共有（章ごと1ファイルのmd＝Git差分・AIレビュー単位・目次章立てが1対1）。入稿PDF生成は GitHub Actions（タグpush→Releases添付。Vercel上ではheadless Chromiumが重いため）。コメント `<!-- -->` はGit管理されるためネコノテのAIが「作者のメモ」として読める（連携自体はPhase 4・別SPEC）
- **要件5＋1**: ①GitHub管理 ②ノンブル・目次・奥付（CSS Paged Media で全自動・手動レイアウトなし）③入稿PDF（`@vivliostyle/cli`＋`press-ready` で PDF/X-1a）④入力とプレビューの分離（CodeMirror 6 横書き入力×Vivliostyle Viewer 縦書きプレビューの2ペイン。IME相性問題を根本回避）⑤コメント機能（HTMLコメント＝出力に構造的に現れない）＋質疑から追加した**挿絵**（§4.6: 塗り足し込み全面挿絵/本文中カットのテンプレート＋ビルド時の解像度・カラー検査）
- **インタビューで8論点確定**（AskUserQuestion 2巡）: 配置=**ネコノテ内モジュール**（`app/(app)/editor/`）／書き込み権限=**共通トークンをwrite昇格**（要求仕様の校正コミット書き戻し計画と整合・security-reviewer 必須）／プレビュー既定=**編集章のみ**／コメント=**HTMLコメントのみ**／判型=**文庫（A6）＋B6**（推奨の新書に代えてB6採用。B6は theme-bunko 派生テーマを自作）／ビルド起動=**UIからも**（タグ作成の代行）／設定UI=**Phase 3でフォーム化**／画像=**通常Git**（太ったらLFS）
- **開発4フェーズ**: Phase 1=Actionsパイプラインのみ（エディタなし。最大リスク「Vivliostyleの組版品質が入稿に耐えるか」を最小コストで検証——成果物は原稿リポジトリ側でアプリのコードにほぼ触れない）→ Phase 2=2ペインエディタ → Phase 3=快適性（コメントUI・ルビ補助・画像D&D・設定フォーム）→ Phase 4=ネコノテ連携
- 位置づけ: R2スコープ（8/11）とは独立した将来フェーズの仕様。着手時期は未定・着手時は Phase 1 の技術検証（theme-bunko＋B6派生テーマで手持ち原稿をPDF化）から
- 次: 7/17〜20 ドッグフーディング（Sprint 7）は予定どおり。縦書きエディタは Phase 1 検証をどこかで挟む

### セッション㉛: 縦書きエディタ Phase 1 技術検証（Vivliostyle組版・ローカル完走・7/16）

- SPEC-vertical-editor §5.1 Phase 1 の最大リスク「Vivliostyleの組版品質が入稿に耐えるか」をローカルで検証。**§10 Phase 1 完了条件のうちローカルで検証可能な全項目が合格**。成果物は原稿リポジトリテンプレート一式として `docs/templates/manuscript-repo/` に保存（サンプル原稿・判型テーマ2種・検査スクリプト・Actionsワークフロー雛形・README）
- **検証環境**: @vivliostyle/cli 11.1.0（Vivliostyle.js 2.44.1・headless Chromium同梱）＋ @vivliostyle/theme-bunko 2.0.1 ＋ press-ready 4.0.3。サンプル原稿は自作の3章構成（ルビ・縦中横・HTMLコメント・挿絵2種・扉・目次・あとがき・奥付入り）
- **合格項目**: ①VFMルビ `{漢字|かんじ}` の縦書き組版 ②縦中横（`.tcy`）③ノンブル・柱（@pageマージンボックス・偶奇出し分け・扉/挿絵/奥付では自動非表示）④目次のページ番号自動解決（target-counter）⑤奥付（フロントマター `class: colophon` で専用ページ・theme-base標準機能）⑥全面挿絵（塗り足し3mm込み・トンボの裁ち落とし線を越えて配置・キャプション/ノンブル非出力）⑦本文中カット（版面内・キャプション付き）⑧HTMLコメントが出力に一切現れない（構造的保証を実地確認）⑨画像検査スクリプト（実効解像度69dpi不足＋カラーを正しく警告・正常画像は通過）⑩4の倍数ページ検査（10ページ→白ページ2枚追加を提案）⑪press-readyでPDF/X-1a:2001変換（OutputIntent/GTS_PDFXConformance確認・CMYK・フォント全アウトライン化）⑫B6派生テーマ（theme-bunkoのCSS変数上書きのみで実現。判型・版面が計算どおり）
- **判型設計**: 文庫A6=16行×40字（8.75pt相当・行送り1.8）、B6=17行×44字（10pt・行送り1.9）。theme-bunkoは「版面寸法をCSS変数（行数×字数×フォントサイズ）から算出し、物理ページサイズとの差を autoマージンで中央配置」する構造なので、派生テーマは変数上書きだけで済む——B6テーマの自作コストは想定よりずっと低かった
- **ハマりどころ3件（テンプレートに反映済み）**:
  1. VFMの `![](){.illust-full}` はクラスを**imgに付けてfigureで包む** → 全面挿絵のページ隔離は `figure:has(> img.illust-full)` で拾う（`:has()` はVivliostyle 2.44で動作確認）。当初 `figure.illust-full` を対象にしていて章冒頭ページに画像が覆い被さった
  2. 全面挿絵のimgを絶対配置する際、**figureに `position: relative` を付けてはいけない**——縦書きフロー上のfigure位置（右端）が基準になり画像が帯状に切れる。無指定ならページ領域基準で解決され全面に描ける
  3. **Ghostscript 10.x のSAFERモードで press-ready が `/invalidfileaccess` で失敗**（一時ICCプロファイルを読めない）→ `GS_OPTIONS=-dNOSAFER` で回避。Actionsワークフロー雛形にも組み込み済み
- **残注意点**: 目次に扉・奥付も載る（entryタイトル全部が対象。Phase 2でtoc生成のカスタマイズ要検討）／本文中カット直後の行送りに改善余地／macOSは游明朝・Linux(Actions)はNoto Serif CJK JPで書体が変わる（版面設計は同一。テーマにフォールバック明示済み）／pdf-libをページ数検査用にdevDependencies追加
- **Phase 1 の残り（要ユーザー判断）**: ①実際の原稿リポジトリ（Motoki-N/writings）へのテンプレート適用方針（既存構成との整合・別リポジトリにするか）②タグpush→Actions実走→Releases添付のE2E確認 ③手持ち原稿での組版品質の目視確認。ローカル生成PDF（A6/B6・press変換済み4本）はスクラッチパッド `phase1-poc/output/` にあり
- 検証コマンドの通し（画像検査→A6/B6ビルド→ページ数検査→press-ready×2）はローカルで一気通貫グリーン。アプリ本体のコード変更なし（typecheck/lint対象外）

### セッション㉛ 追記: Phase 1 E2E完走（検証リポジトリでのActions実走＋実原稿での品質検証・7/16）

- **SPEC-vertical-editor Phase 1 の完了条件をすべて満たした**。検証場所と原稿は AskUserQuestion で確定（①新規検証リポジトリ ②異世界デバッガーのVFM化、いずれも推奨案を採用）
- **検証リポジトリ**: `Motoki-N/manuscript-poc`（private・gh CLIで作成）。テンプレート一式＋実原稿で構成
- **実原稿のVFM化**: writings の「異世界デバッガー」パート1（シーン1〜11・約9.4万バイト≒3.1万字。パート2〜4はメモ段階のため対象外）を変換スクリプト（scratchpadの convert-to-vfm.mjs）で一括変換——青空文庫式ルビ `｜親文字《るび》`/`漢字《るび》` → VFM `{親文字|るび}`、1行1段落 → 空行区切り（VFMは単一改行を<br>にするため）。変換漏れゼロ
- **E2E結果**: タグ `v0.2-nyuko` push → Actions（ubuntu）で 画像検査→A6/B6組版→ページ数検査→press-ready→**Releases添付まで全ステップ成功**。実原稿3.1万字が文庫A6で74ページ（4の倍数警告も正しく発火・白ページ2枚追加の提案）。Releasesの成果物は PDF/X-1a:2001・トンボ/塗り足し込み・A6版16.5MB/B6版15.5MB
- **実原稿での組版品質**: 字下げ・行頭行末禁則・ダーシ（──）の縦組み・拗促音・長文段落の折り返しすべて自然。Linux（Noto Serif CJK JP）とmacOS（游明朝）で書体は変わるが版面設計（16行×40字）は同一で、折り返し位置も一致
- **1回目の実走（v0.1-nyuko）で発見した罠2件（テンプレートへ反映済み）**:
  1. **press-ready は pdffonts（poppler-utils）を要求する**——ubuntuランナーに無く変換が失敗。apt install に poppler-utils を追加
  2. **press-ready は内部エラーでも exit 0 で終わる**（ステップが緑のまま成果物なし）→ 変換後に `test -f` で成果物の存在を検査して失敗を可視化する
- 運用メモ: 検証リポジトリはこのまま残し、Phase 2（Webエディタ）のGitHub読み書き先としても使える。writings への本適用（既存 .txt 構成との同居設計・タグ命名のプロジェクト分離）は Phase 2 着手時に改めて設計する
- 次: Phase 2（2ペインWebエディタ）のSPEC詳細化 or 7/17〜20 ドッグフーディング（Sprint 7）を優先

### セッション㉜: 縦書きエディタ Phase 2（2ペインWebエディタ）SPEC詳細化・確定（7/16）

- 親SPEC §5.1 Phase 2 の詳細仕様として **SPEC-vertical-editor-phase2.md を策定・確定**（草案 → AskUserQuestion 4問 → 確定の縦通し）
- **設計の要**:
  - **プレビューはクライアント完結**: VFM変換（@vivliostyle/vfm をブラウザ実行）→ テーマCSSインライン注入 → 画像パスを認証プロキシURLへ書換 → Blob URL → 自前ホストの Vivliostyle Viewer（public/vivliostyle/）が組版。再組版はデバウンス＋保存時でサーバー往復なし。**実装ステップ1を技術スパイクに設定**（VFMブラウザバンドル・Blob URL読込の成立検証。不成立なら @vivliostyle/core 直接埋め込みへ切替）
  - **PATのwrite昇格は不要と判明**: Sprint 4 の校正コミットで Contents: Read/Write 登録・書き込み実績済み（親SPEC §4.1 の昇格前提は消化済み）
  - **画像プロキシ** `/api/editor/asset`（セッション必須＋所有確認＋パス検証＋拡張子allowlist）と新規書き込み経路が security-reviewer 必須ゲート。保存とプロキシに rate-limit 適用
  - 保存＝コミット（メッセージ自動生成＋編集可・putFileContent 拡張で新blob SHAを返し楽観ロック基準を自己前進）、IndexedDB待避（`{repo}:{branch}:{path}` キー・baseSha 付き）、競合は **@codemirror/merge の2ペインdiff** で手動マージ支援（自動マージなし）
  - 章一覧は book.config.js の entry を**実行せず正規表現抽出**（失敗時はファイル名昇順フォールバック）
- **インタビューで5論点確定**: 対象リポジトリ=**既存 projects.repo/base_path を共有**（竜の巣の設定を manuscript-poc へ切替・スキーマ変更なし・base_path はプロジェクトルート規約）／ルーティング=**/projects/[id]/editor**（board・manuscript と同列タブ）／ブランチ=**デフォルトのみ**／**全体プレビューと新規章作成は Phase 2 に含める**（スマホのタブ切替は Phase 3 へ）
- 実装ステップ6段（スパイク→章一覧＋CodeMirror→プレビュー接続→保存＋待避→競合→全体プレビュー＋新規章）・E2E 10項目を定義。アプリ本体のコード変更なし（typecheck/lint対象外）
- 次: Phase 2 実装（ステップ1の技術スパイクから）。着手前に竜の巣プロジェクトの repo 設定切替（ユーザー操作）が必要

### セッション㉝: 縦書きエディタ Phase 2（2ペインWebエディタ）実装完了・E2E全10項目合格（7/16）

- **SPEC-vertical-editor-phase2 の6ステップを縦通しで実装し、§13 E2E 10項目すべて合格**。typecheck / lint / build グリーン。実装はアプリ本体のコード（`app/projects/[id]/editor/` ＋ `components/editor/` ＋ `lib/editor/` ＋ `lib/actions/editor.ts` ＋ 画像プロキシ `app/api/editor/asset/route.ts`）
- **技術スパイク（ステップ1）成立**: `@vivliostyle/vfm` をブラウザ実行→テーマCSS注入→Blob URL→自前ホスト Vivliostyle Viewer（`public/vivliostyle/` へ postinstall コピー・CDN不使用）で縦書き・文庫A6・ノンブルが出た。**`@vivliostyle/core` 直接埋め込みへの切替は不要**（SPEC §5.1 の代替案は発動せず）
  - **ハマり: Viewer の `#src=` はエンコードしない**。`encodeURIComponent(blobUrl)` を渡すと Viewer がハッシュを復号せず相対パス扱い→404。Blob URLは `&`/`#` を含まないので生連結で安全（`lib/editor/preview.ts` の `viewerUrl`）
- **主要な設計**:
  - プレビューはクライアント完結（VFM変換→`rewriteImageSrc` で画像を認証プロキシURLへ書換→Blob URL→iframe内Viewer）。再組版は打鍵デバウンス3秒＋保存時。`buildPreviewHtml` は単章＝フロントマター `class:` を body へ反映（扉・奥付様式）、複数章＝`break-before:page` シムで通し組版（body クラス様式は当たらない旨UI注記）
  - テーマCSS解決（`lib/editor/theme.ts`）: `book.config.js` の `theme` が指すCSSを取得し `@import` を1段解決。`@vivliostyle/theme-bunko`/`theme-base` への参照はアプリホストの `<link>` へ読み替え、リポジトリ内相対CSSはインライン展開。取得失敗は既定テーマ（文庫A6相当）でフェイルソフト
  - 保存＝コミット: `putFileContent` を拡張し**新 blob SHA を返す**→再取得なしで楽観ロック基準を自己前進（校正の `last_reviewed_commit` 前進と同じ発想）。IndexedDB 待避（`lib/editor/draft-store.ts`・キー `{repo}:{branch}:{path}`・baseSha付き・1秒デバウンス）、競合は `@codemirror/merge` の2ペインdiff（左リモート読取専用・右ローカル・`revertControls: 'a-to-b'`）で手動マージ
  - 章一覧は `book.config.js` を**実行せず正規表現で entry 抽出**（`lib/editor/book-config.ts`）。entry順→未登録章（ファイル名昇順・末尾）。未登録は「entry未登録」印つき表示
- **security-reviewer（必須ゲート）**: Critical/High なし。**Medium 2件を修正**——①`getEditorWorkspace` に明示 `getUser()` チェックを追加（middleware/RLS 依存だった多層防御の欠け・`userId: ''` の罠も解消）②プレビューHTMLの `theme.inlineCss` を `</style>` ブレイクアウト対策でエスケープ（リポジトリCSS由来のタグ注入防止。Blob URL＝同一オリジンのため実行されればセッション権限に及ぶ self-XSS 相当）。Low の新規章ファイル名スキーマに `(?!.*\.\.)` を追加。画像プロキシのパストラバーサル三段防御（schema `..` 拒否＋拡張子allowlist＋`joinRepoPath` 正規化）・PAT非漏洩・認可は問題なし
- **E2E結果（manuscript-poc・実コミット発生）**: 章一覧entry順✓／CodeMirror表示＋ルビハイライト＋A6縦書きプレビュー✓／編集→プレビュー反映・コメントは出力に出ない✓／未保存リロード→復元バナー→復元✓／保存→コミット（GitHub反映確認）✓／**競合（gh CLIでリモート更新）→日本語バナー＋トースト→マージビュー→取り込み→再保存成功**✓／画像プロキシ（認証200・未ログイン=/login誘導・拡張子外400・トラバーサル拒否）✓／全体プレビュー（全章結合1/32通しノンブル・目次なし注記）✓／新規章作成（雛形コミット・entry未登録印・同名衝突で日本語エラー）✓／回帰（原稿タブ全17ファイル・校正ボタン・進捗集計33,133字）✓
  - **ハマり: 画像プロキシの ZodError が 500 になる**（`.parse()` の ZodError → `toAppError` で internal 扱い）。トラバーサルは安全に拒否されるが status が 400 でなく 500。コードベース共通の慣習（Zod→internal・固定文言でリーク無し）なので現状維持
  - **ハマり: CodeMirror は表示外の行をDOMに描画しない**（仮想化）→ `.cm-content.textContent` での本文全体検証は不成立。末尾の編集は GitHub上のコミット内容で検証した
  - ペインのボタンクリックは座標ズレで外れやすく、`nav[...] button` を `textContent` で探して `.click()` する JS フォールバックが安定（既存メモリの定石どおり）
- **前提の消化**: 竜の巣プロジェクトの repo を `Motoki-N/manuscript-poc`（base_path空）へ切替（ユーザー操作）。**既存PATの対象リポジトリに manuscript-poc を追加**が必要だった（Fine-grained PAT のトークン値は不変なので再登録不要・ユーザー実施）。E2E後は検証で汚した 11-scene1.md を Phase 1 時点（da3101e5）の内容へ復元し、テスト新規章も削除
- 依存追加: `@vivliostyle/vfm`・`@vivliostyle/viewer`・`@vivliostyle/theme-bunko`・`codemirror` v6系（`@codemirror/state`/`view`/`language`/`commands`/`lang-markdown`/`merge`）・`@lezer/highlight`。postinstall で `scripts/copy-vivliostyle.mjs`（Viewer＋テーマを `public/vivliostyle/` へ）。eslint ignore に `public/vivliostyle/**` と `docs/templates/**` を追加
- **スコープ外（Phase 3以降）**: コメント一覧UI・ルビ入力補助・字数/ページ見積り・画像D&D・`book.config.js`/判型のフォームUI・入稿ビルドUI起動・ブランチ切替/PR連携・スマホのタブ切替
- **本番反映済み**: PR #12 をユーザーがマージ（`feda746`）→ Vercel 自動デプロイ完了（`nekonote-v2.vercel.app`）。ビルドログで postinstall の Viewer コピー実行を確認、本番で `/vivliostyle/viewer/` の静的配信も確認（200/image/png）。ビルド中の「Dynamic server usage」ログは cookie 使用ルートの静的化プローブによる既存の無害な出力
- 次: ドッグフーディング（Sprint 7）で実運用の使い勝手を見る。エディタで気づいた問題は Issue 起票→/fix-issue で回す

### セッション㉝ 追記: 開発スケジュール改訂（実装計画 v4・7/16）

- **4連休（7/17〜20）の使い方を変更**: ドッグフーディング予定を改め、**縦書きエディタの実装（Phase 3 以降）を優先**し、終わり次第ドッグフーディングへ移行する。理由は①Claude Fable 5 が使えるのが 7/20 までであること ②4連休は仕事が休みでまとまった作業時間を確保できること
- **実装計画を v4 へ改訂**: 「7/16 改訂の前提（v4）」を追加、番外（縦書きエディタ Phase 1・2 完了）を記録、Sprint 7 を「縦書きエディタの実装（7/17〜7/20・Phase 3以降）」に差し替え、ドッグフーディングは Sprint 8（エディタ完了次第〜）へ後ろ倒し。リスク表に「エディタが 7/20 までに終わらない」行を追加し、実質的な判断ポイントを 7/20夜（Phase 3 の消化状況とスコープカット判断）に設定。8/1 運用開始・8/11 開発仕上げのセーフティネットは維持
- **要求仕様ドキュメントも更新**: §6 スコープ外の「縦書きエディタ機能」をスコープ内昇格として打ち消し、機能要件 **§3.6 縦書きエディタ機能** を新設（利用フロー全体像は §3.7 へ繰り下げ）。§3.4 の「執筆は外部エディタ」に Webエディタ併用可の追記、利用フロー図の執筆行も更新
- ドキュメントのみの変更（アプリ本体のコード変更なし・typecheck/lint対象外）

### セッション㉞: 縦書きエディタ Phase 3（快適性）SPEC策定→実装→E2E全項目合格（7/16）

- **SPEC-vertical-editor-phase3 を策定・確定**（草案 → AskUserQuestion 4論点 → 確定 `b589f13`）→ 実装 → security-reviewer → E2E を1セッション縦通し。ブランチ `feat/vertical-editor-phase3`
- **インタビューで4論点確定**: 設定フォーム=**組み設定・テーマ変数まで**（最大スコープ採用。書誌＋entry管理＋テーマCSS4変数＋奥付の4区画）／入稿ビルドの完了検知=**Releaseポーリング**（PATスコープ変更なし。actions:read を増やさない）／画像=**即コミット**（1画像1コミット＋記法挿入）／付加項目=**傍点・縦中横の入力補助＋コメント挿入ショートカット採用、スマホのタブ切替は不採用**（積み残しリストへ）
- **実装6ステップ**: ①字数カウント（`lib/editor/word-count.ts` 純関数。コメント・フロントマター・記法・ルビ読み除外）＋ページ数（版面概算→プレビュー実測を優先表示）②コメント一覧（サイドバー章/コメントタブ・行番号＋要約・ジャンプ）＋`Cmd+/` トグル ③ルビ（選択→ダイアログ→`{親|読み}`）・傍点/縦中横（**Phase 1 実証済みの `<span class="tenten|tcy">` HTML直書き記法を採用**）④画像D&D/ボタン→検証（allowlist・10MB）→`images/` 即コミット→種別選択（本文中カット/全面挿絵）＋キャプション→記法挿入。日本語ファイル名はサニタイズ・同名は連番 ⑤設定フォーム（**正規表現置換＋置換後に抽出関数で再検証してからコミット**の型。entry の非文字列要素は既存要素の並べ替えのみ許可＝JS断片注入を構造的に排除。奥付はテンプレ構造検出時のみフォーム化・発行日行がなければフィールド非表示のフェイルソフト）＋新規章作成時の entry 自動追記 ⑥入稿ビルド（タグ提案 v{n}-nyuko 自動採番→Git Refs APIでタグ作成→30秒間隔15分のReleaseポーリング→PDFリンク。**PDF実体は `/api/editor/build-asset` が認可後にGitHubの署名付きURLへ302**——Vercelのレスポンスサイズ制限を回避しプロキシしない）
- **大物バグ発見・修正（mainにも潜在）**: **プレビューの判型が実は適用されておらず、全文が1ページに流し込まれていた**。`book.config.js` の `size` は CLI ビルドでのみ `@page size` になり、ブラウザプレビューでは theme-base の `--vs-page--size: auto` のまま。`size` を抽出して `:root { --vs-page--size }` をテーマCSSへ注入して解決（`f1485fd`）。Phase 2 E2E をすり抜けた理由は不明（当時の目視は縦書き・ノンブル表示に引っ張られた可能性）。デバッグは「blob HTML に手で変数を注入して Viewer に読ませる」二分法が決め手
  - 副産物の教訓: **プレビューが非表示（モバイル幅の hidden）だと iframe 内の組版が壊れた寸法で走る**。E2E中にペイン幅が変わって現象が混線した——組版検証は必ずデスクトップ幅で
  - 実ページ数の取得も「コンテナ数の2回一致」では組版途中の値で確定した→ **Viewer の `data-vivliostyle-viewer-status=complete` を待って `#vivliostyle-total-pages` を読む**方式に修正（`9c2c12e`）。Viewer は表示外ページのコンテナをDOMから間引くため要素数は信用できない
- **security-reviewer（必須ゲート）**: Critical/High ゼロ。**M-1: Server Actions の bodySizeLimit 既定1MBで10MB画像がスキーマ検証前に落ちる**→ `next.config.ts` に 15mb を明示。**L-1: `String.replace` の `$` 特殊パターン未エスケープ**（置換後検証で fail-closed は確認済み）→ 置換を関数形式に（`3318f95`）。注入系（entry経由JS断片・CSS・奥付HTML・パストラバーサル・タグref）はすべて fail-closed を確認済みの評
- **E2E（SPEC §13 全7項目合格・manuscript-poc 実コミット）**: 字数2,206字＋概算/実測ページ切替✓／コメント一覧・ジャンプ・空コメントで字数不変・プレビュー非出現✓／ルビ`<ruby>`・傍点sesame・縦中横all が組版で確認✓／画像D&D→コミット→プロキシ経由プレビュー・11MB/svg拒否✓／設定4区画すべて差分プレビュー→コミット→GitHub反映（著者・entry並べ替え・行数16→14→16でページ数5→6→5・奥付）＋新規章のentry自動追記✓／入稿ビルド v0.3-nyuko→Actions実走→ダイアログ再開でポーリング復帰→PDFリンク2本→302到達・未ログイン307✓／回帰（復元バナー→破棄・原稿タブ17ファイル・校正ボタン）✓
  - E2Eの検証産物は削除済み（98-e2e-phase3.md・e2e-image.png・v0.3-nyuko タグ/Release）。奥付・configの著者「灰谷 汀」は実データの改善として残置。テーマ行数・entry順は復元済み
  - ペインE2Eの新定石: **CodeMirror の選択・編集はDOM選択では同期されない**→ ツールバーボタンの React fiber から `viewRef` を辿って EditorView を取得し `view.dispatch` で操作する（`__cmView` に保持）。設定フォームの label 検索は「著者」が書誌と奥付の両方に居るので前方一致だけだと誤爆する（一度奥付を先にコミットしてしまった——アプリ側は正常動作）
- typecheck / lint / build グリーン。依存追加なし（Phase 2 の資産のみで完結）
- 次: PR作成→人間レビュー→マージ→本番確認。その後ドッグフーディング（Sprint 8）へ

### セッション㉞ 追記: Phase 3 本番反映（PR #15 マージ・デプロイ確認・7/16）

- **PR #15 をユーザーがマージ**（`a30d5ed`）→ Vercel 自動デプロイ完了（Production Ready・約1分）
- 本番スモークチェック: 新ルート `/api/editor/build-asset` が未ログインで 307→/login（認可保護が本番でも有効）、/login 200
- 判型注入バグ修正（`--vs-page--size`）も本番に反映——プレビューのページ分割が本番で初めて正しく動く状態になった
- ローカルの作業ブランチ削除済み。**縦書きエディタは Phase 1〜3 完了**（親SPEC §2 の5要件＋挿絵をUI上で充足）。Phase 4（ネコノテ連携）は別途SPEC策定から
- 次: ドッグフーディング（Sprint 8）。エディタで実際に執筆し、気づきは Issue → /fix-issue で回す。7/20夜の判断ポイントは「Phase 3 消化済み」で通過

### セッション㉟: 縦書きエディタ Phase 4（ネコノテ連携）SPEC策定→実装→E2E全項目合格（7/17）

- **SPEC-vertical-editor-phase4 を策定・確定**（AskUserQuestion 2巡7論点 → 確定）→ 実装 → E2E → security-reviewer を1セッション縦通し。ブランチ `feat/vertical-editor-phase4`。**スキーマ変更なし**（既存列 `revision_suggestions.committed_sha` を流用）
- **インタビューで確定した論点**: スコープ=**相互リンク＋レビュー結果のコメント書き戻し**（AIの作者コメント読取・エディタからのレビュー起動は見送り）／書き戻し対象=**校正の保留提案＋講評**／反映方式=**即コミット**／書き戻した保留は**保留のまま＋書き戻し済み印**（committed_sha 流用。消化はエディタに一本化）／起動単位=**ファイル単位の一括**／講評の書き戻し先=**専用メモファイル `manuscripts/00-review-notes.md`**（entry 非掲載＝本に出ない）／要点生成=**全文をそのまま**（追加AI呼び出しなし）
- **実装3本柱**: ①相互リンク——両画面に `?file=` の初期選択（**一覧との一致でのみ採用**の多層防御）＋エディタ「レビュー」⇄原稿画面「エディタで開く」リンク ②校正の保留書き戻し——純関数 `writeBackAsComments`（一意一致アンカー共用・位置を元本文で全件確定→後方挿入・1件でも不一致なら全体失敗）＋ Server Action `writeBackOnHoldSuggestions`（commitAcceptedSuggestions と対称構造）③講評書き戻し——`writeBackCritique`（target_ref/target_phase/status の三重検証・既存は末尾追記/無ければヘッダつき新規作成）
- **コメント無害化**: `--` を全角 `−−` へ置換（HTMLコメントの閉じ子 `-->`/`--!>` は連続ASCII `--` 必須のため脱出不能）。校正コメントは原文20字切り詰め＋修正案/理由全文の1行形式
- **lint の新ルール対応**: `react-hooks/set-state-in-effect`（effect 本体の同期 setState 禁止）に2回当たった→ 原稿画面は「useState 初期化子で選択済みにして effect は fetch のみ」、エディタは「openChapterFlow が同期 setState を含むため setTimeout(0) 経由」で解決
- **security-reviewer（必須ゲート）**: Critical/High ゼロ。**M-1: `writeBackCritique` のみ書き込み先パスの再検証が欠落**（DB由来 base_path の `..` が PostgREST 直叩き経由で設定外リポジトリへの PUT に化けうる）→ `manuscriptFilePathSchema.parse()` を1行追加で修正・実測で再検証済み。`-->` 注入・`?file=` 経路・PAT露出・セッション検証は指摘なしの評
- **E2E（SPEC §6 全5項目合格・manuscript-poc 実コミット）**: 相互リンク往復＋不正 `?file=`（トラバーサル文字列）は未選択フォールバック✓／校正2件を保留→一括書き戻し→該当行直前にコメント2行・コミットメッセージ・エディタのコメント一覧L9/L18表示・プレビュー非出現・バッジ「コメント書き戻し済み」・ボタン消滅（対象0件）✓／安全弁=UIガード（適用不能の保留で警告＋ボタン無効）＋サーバー側（パネルを開いたまま gh CLI でリモート書き換え→書き戻し実行→日本語エラーでコミットされず）✓／講評実行→書き戻しで 00-review-notes.md 新規作成（ヘッダ＋講評ブロック・entry非掲載）→リロード後の再書き戻しで追記（2ブロック目）→エディタ章一覧に entry未登録印つき表示・コメント一覧に2件✓／回帰=校正実行・提案の受入/拒否/保留・適用不能検知・エディタ表示すべて従来どおり✓
  - **興味深い副作用の実証**: 書き戻しコメントに原文抜粋が含まれるため、再校正で同じ箇所が指摘されると「適用不能」（一意一致が2箇所）になる——安全弁が正しく機能した形（コミット前にUIで止まる）。原文切り詰め（20字）が衝突を減らすが、短い原文では起きうる。実害は fail-closed で吸収される設計
  - 検証産物は削除済み（11-scene1.md 復元・00-review-notes.md 削除×2回・検証コミットはGit履歴に残置）。竜の巣の revision_suggestions に検証行4件（書き戻し済み保留2・拒否2）が残るが実運用に影響なし
- typecheck / lint グリーン。依存追加なし・マイグレーションなし
- 次: PR作成→人間レビュー→マージ→本番確認。**縦書きエディタ Phase 1〜4 完了**でドッグフーディング（Sprint 8）へ

### セッション㉟ 追記: Phase 4 本番反映（PR #16 マージ・デプロイ確認・7/17）

- **PR #16 をユーザーがマージ**（`81b7386`）→ Vercel 自動デプロイ完了（Production Ready・約1分）
- 本番スモークチェック: `?file=` つきの editor / manuscript 新経路が未ログインで 307→/login（returnTo にクエリごと保持）、/login 200
- ローカル・リモートの作業ブランチ削除済み（リモートはGitHub設定で自動削除）
- **縦書きエディタは Phase 1〜4 すべて完了**。執筆（エディタ）⇄レビュー（校正・講評）⇄書き戻し（コメント）のループが本番で一周する状態になった
- 次: ドッグフーディング（Sprint 8）。実データでの執筆＋レビューループを回し、気づきは Issue → /fix-issue で処理する

### セッション㊱: /fix-issue #14 書店員の役割変更＋あらすじ・キャッチコピー作成（PR #65 マージ・本番反映済み・7/17）

- **Issue #14 を `/fix-issue` フローで処理**（影響範囲分析→設計確認→実装→subagent自己レビュー→PR #65→マージ→本番反映まで1セッション）: 「読者代表」と「近所の書店員」の評価者としての役割重複を解消。書店員を**評価者→作家のサポーター（売り込み分析役）**へ変更し、**あらすじ作成・キャッチコピー作成**の2機能を追加。読者代表は**賛否両論スタイル**（辛辣可）へ調整
- **設計確認（AskUserQuestion 3論点で承認）**: ①あらすじ・キャッチコピーは**独立プロファイル2種**としてシード（担当=書店員。講評パネルは `target_phase='manuscript'` を動的列挙するためUI構造変更ゼロで選択肢に並ぶ）②書店員の reference_scope を `manuscript_only`→**`manuscript_plus_target`**（サーバー・クライアントともペルソナのスコープを汎用解釈しているため、データ変更だけでジャンル・ターゲット層未設定ガードが自動で効く）③「書店員講評」→**「売り込み分析」に改名**
- **マイグレーション `20260717000001`（データのみ・スキーマ変更なし・RLS変更なし）**: 標準シード済み行の変更は UPDATE で行う型の初ケース（ペルソナ2人の description 差し替え＋プロファイル改名・プロンプト差し替え＋新プロファイル2種 INSERT `…1008`/`…1009`）。旧コード×新データでも安全（プロファイルは動的列挙・ガードはスコープ駆動）なので適用順の制約なし
- **subagent 自己レビューが実質的に機能**: ブロッカーなしの評のうえで、①manual.md 内の「標準7種」の数字不整合（同一コミット内の矛盾）②`.claude/skills/review-profiles/SKILL.md` のペルソナ表が旧役割のまま（将来セッションが旧仕様を正として作業するリスク）の2件を検出→どちらも修正してからPR。スキル・マニュアルなどの**周辺ドキュメントの追従漏れは diff 外から拾えない**ので、自己レビュー指示に「関連ドキュメントとの食い違い」を含めたのが効いた
- 検証: typecheck / lint / build 通過。**新プロファイルの実動確認はマイグレーション適用後にしか行えない**ため、PRには「マージ後の本番反映時に確認」と明記する運びにした
- **本番反映**: ユーザーが PR #65 をマージ→Vercel 自動デプロイ（Production Ready）→ AskUserQuestion 承認後に `db push --linked` 適用→SELECT で manuscript プロファイル4種（読者講評 / 売り込み分析 / あらすじ作成 / キャッチコピー作成）とペルソナ2人の更新を確認
- 積み残し: `SPEC-dashboard-critique-settings.md` には旧役割（書店員=客観評価・manuscript_only）の記述が残る（策定時点のSPECとして保存。更新するなら別Issue）。売り込み分析・あらすじ・キャッチコピーのプロンプトは初版——ドッグフーディングでの出力の質を見て Issue で調整する

### セッション㊲: Issue #13 AIイラストレーター（SPEC策定→3PR分割実装→本番反映・7/17）

- **Issue #13「AIエージェント『イラストレーター』の追加」を SPEC策定→PR①②③の分割実装で完遂**（PR #66 基盤 / #67 生成API / #68 アトリエUI。すべてマージ・本番反映済み）。本アプリ初の画像を扱う機能（表紙・挿絵・キャラクター・コンセプトアートの4種生成）
- **事前調査（プラン段階）**: Web検索で品質事例を確認——「LLMが小説を読んで画像プロンプトを作る」2段階方式は既に実践事例があり、キャラ一貫性は Gemini画像生成（Nano Banana）系が定評・生成も10〜15秒と高速。これが2段階方式採用とGoogleデフォルトの根拠になった
- **SPEC-illustrator.md をインタビュー3巡で策定・確定**: 独立ページ「アトリエ」／2段階方式（複数案2〜3提示→選択・微調整→生成）／参照資料は種別ごと自動選択（表紙・コンセプト=企画書一式＋原稿全文、キャラ=企画書一式、挿絵=選択ファイルのみ）／**参照画像を初版から**（キャラ一貫性の要）／**表紙文字入れは「絵のみ→確定後に参照画像＋文字入れ指示」**（＝編集依頼を汎用の仕組みとして設計）／全生成自動保存＋ギャラリー・物理削除／プロンプトを画像とセット保存し説明文・追加依頼の下敷きに／タイトルはユーザー編集可（初期値=プロジェクト名＋種別・サーバー付与）
- **PR① 基盤（#66）**: マイグレーション（persona_type `illustrator`・capability `image` のCHECK張り替え／ペルソナシード `…0007`／illustrations テーブル＋RLS／Storage非公開バケット）＋`resolveImageModel`（デフォルト google/gemini-3.1-flash-image-preview）＋設定画面の「画像生成」枠（`ModelCapability` を `aiCapabilities` と2層分離＝ペルソナ編集に image が混入しない）
  - **security-reviewer H-1: RLSポリシーの同一テーブル自己参照は PostgreSQL の再帰検出で全クエリがエラーになる**（chat_threads の先例が動くのは参照先が別テーブルだから）→ 修正マイグレーションで自己参照を除去し、参照画像の所有検証はAPI側のRLS越し取得に移した（残余は存在オラクルのみ・Low受容）
- **PR② 生成API（#67）**: propose（種別ごと資料組み立て→generateObject 2〜3案・5/min 50/day）／generate（参照画像添付→generateImage→Storage→行insert→署名URL・**2/min 20/day**）／Server Actions（一覧＋被参照数・タイトル編集・削除はStorage実体→行の順）
  - **E2Eで初の画像生成を実証**: 竜の巣の表紙依頼→原稿を正確に読んだ3案→生成画像は表紙として実用水準→**参照画像つき文字入れで「絵柄を完全に保ったまま縦書き明朝のタイトルが入った」**（SPEC の編集依頼ワークフローが品質面でも成立）
  - **教訓: 画像モデルの出力形式はモデル依存**（png想定がGeminiはjpegを返した）→ mediaType の allowlist（png/jpg/webp）＋バケット `allowed_mime_types` 拡大で対応。AI SDK v7 の `generateImage` は `prompt: { images, text }` で参照画像入力を正式サポート（node_modules の型定義で事前確認してからSPECに書いた）
  - **security-reviewer H-1: `manuscriptPath` の `..` はGitHub APIのURL正規化で base_path チェック（startsWith）を迂回し、PATが読める任意リポジトリの読み出しに化ける**→ 既存 `manuscriptFilePathSchema` への差し替え1行で修正・400遮断を実測。既存コードは全経路この防御に乗っており、新規経路だけ外れていた——**「原稿パスを受けるならこのスキーマ」を規約として覚える**
  - subagent自己レビューも機能: 挿絵の案出しに企画書が混入（SPEC §5.2 の出し分け違反・文字数ガード誤爆の二次影響つき）を検出→修正
- **PR③ アトリエUI（#68）**: /atelier（プロジェクトセレクタ＋依頼フロー＋ギャラリー2ペイン）・案カード→プロンプト欄反映→生成・参照画像チップ（プロンプト引き継ぎ）・ギャラリー（種別バッジ・タイトルインライン編集・拡大表示にプロンプト＝説明文・DL・被参照警告つき削除）・ダッシュボードに「アトリエ」導線。UIのみ＝security-reviewer 対象外
  - ペインE2E一巡: 挿絵フロー（ファイル選択→案出し→登場人物名まで正確な3案→選択反映）・タイトル編集DB反映・削除警告・ライト/モバイル・コンソールエラーなし
  - 自己レビュー3件（selected_project_id 未参照・ツリー取得失敗が「repo未設定」と誤診＋再試行不能・削除済み画像が結果パネル残存）→すべて修正。`react-hooks/set-state-in-effect` は「effect は fetch のみ・setState はコールバック内」＋projectId 照合の読み込み中判定で回避
- **本番反映**: マイグレーション3本（`20260717000002`〜`000004`）は各PR前に AskUserQuestion 承認→`db push` 適用（純追加型）。PR③マージ後スモーク: /atelier 307→/login（returnTo保持）・/login 200
- 積み残し（いずれも軽微）: ①ペルソナ新規作成フォームで `illustrator` 型の自作ペルソナが作れる（既存経路に無害・アトリエは標準ペルソナ固定ID。自作対応するかは将来Issue）②イラストレーターの description・案出しプロンプトは初版——ドッグフーディングで出力の質を見て調整③検証産物（竜の巣の表紙2枚）はギャラリーに残置（実用サンプルとして流用可）

### セッション㊳: /fix-issue #69 オリジナルファビコン設定（PR #70 マージ・本番反映済み・7/17）

- **Issue #69 を `/fix-issue` フローで処理**（影響範囲分析→実装→subagent自己レビュー→PR #70→マージ→本番反映まで1セッション・設計確認の必須基準に非該当のため確認なしで直行）: Next.jsデフォルト（Vercel風）のファビコンを、ブランドマーク 🐱 に合わせた**オレンジ背景＋白い猫の顔シルエット**のオリジナルデザインに差し替え。タブが並んだときの識別性が目的
- **実装はアセット2ファイルのみ・コード変更ゼロ**: `app/icon.svg` 新規（App Router のファイル規約で `<link rel="icon">` が自動生成される）＋ `app/favicon.ico` を同デザインの 16/32/48px マルチサイズICOに差し替え（Safari等SVG非対応ブラウザのフォールバック。25.9KB→5.4KB）
- **ICO生成はmacOSローカルで完結（追加依存なし）**: SVG手書き→ `qlmanage -t -s 256` でPNGレンダリング→ `sips -z` で各サイズ縮小→ Python標準ライブラリでPNG入りICO（Vista+形式）を組み立て。ブラウザペインでSVGを直接開いてデザイン確認できるのも手軽だった
- 検証: typecheck / lint 通過・devサーバーで両アイコンの配信と `<link>` タグ出力を確認・subagent自己レビュー指摘ゼロ（SVG構文/ICOバイナリ構造の検証込み）。マージ後、本番で favicon.ico 5,371 bytes・icon.svg 200 を確認
- メモ: ファビコンSVG内の色ハードコードは「テーマ用CSS変数必須」規約の対象外（CSS変数を参照できない静的アセットのため）。デザイン調整の要望が出たら icon.svg を直して同手順でICO再生成

### セッション㊴: /fix-issue #71 校正の提案カードクリックで該当箇所へジャンプ＆ハイライト（PR #73 マージ・本番反映・7/18）

- **Issue #71 を `/fix-issue` フローで処理**（影響範囲分析→実装→ブラウザ実機検証→subagent自己レビュー→PR #73→マージまで1セッション・設計確認の必須基準に非該当のため確認なしで直行）: 原稿が長いと校正の指摘箇所が分かりにくい問題に対し、提案カードのクリックで原稿ビューが該当箇所へスムーズスクロールし、原文抜粋を `<mark>` でハイライトするようにした
- **実装は2ファイルのみ**（manuscript-workspace.tsx / proofread-panel.tsx）: `original_text` は「原稿からの完全一致引用」がアンカー（`isApplicable` と同じ前提）なので、そのまま検索キーに使えるのが設計の肝。ProofreadPanel に `onLocate` を追加（保存済み・ストリーミング中カードとも。Enter/Space キー対応）→親が最初の出現位置を検索して `<mark class="bg-primary/20">` 分割レンダリング＋`scrollIntoView`（`scroll-mt-24` でモバイルのボトムシート・sticky ヘッダーに隠れない位置）。見つからない提案（陳腐化した適用不能等）は toast、空文字は明示ガード（`"".includes("")` が true の罠）。同一カード再クリックの再スクロールは nonce インクリメントで発火。受入/保留/拒否ボタン行は stopPropagation でジャンプ対象外。ファイル切替でハイライトをクリア
- 検証: typecheck / lint 通過。ブラウザペインで竜の巣 scene5 に校正実行（提案3件作成）→モバイル幅（ボトムシート）とデスクトップ幅（サイドパネル）両方でジャンプ＆ハイライト・stopPropagation・コンソールエラーなしを確認。subagent 自己レビューはブロッキング指摘なし（留意2件=ストリーミング中の前方一致断片クリック・テキスト選択でのジャンプ発火はいずれも実害小で受容）
- **ペインの座標クリックの落とし穴（再確認）**: `resize_window` で明示サイズ指定後、座標クリックが約3倍スケールでビューポート外に落ちる事象（clientX=3009 を実測）。read_page の ref クリックも同様に外れることがあり、**JSクリック（element.click()）へのフォールバックが確実**——既存メモの定石どおり
- 作業開始時に残っていた docs/manual.md の未コミット変更（縦書きエディタ・アトリエ追記）は、ユーザー承認のうえ先に docs コミット（51c88d6）として main へ push してから着手
- 検証産物: 竜の巣 scene5 の未処理提案3件が残置（実運用データとして無害。不要なら拒否で消化）
- マージ後: main 取り込み・ローカルブランチ削除・本番 307→/login 正常応答を確認（Vercel 自動デプロイ）

### セッション㊵: /fix-issue #72 エディタの入力とプレビューの2ウィンドウ対応（PR #74 マージ・本番反映・7/18）

- **Issue #72 を `/fix-issue` フローで処理**（影響範囲分析→実装→ブラウザ実機検証→subagent自己レビュー→指摘2件修正→PR #74→マージまで1セッション・設計確認の必須基準に非該当のため確認なしで直行）: 入力とプレビューの並置が窮屈（特にノートPC）という課題に対し、縦書きプレビューを別ウィンドウへ分離できるようにした。MacBook＋iPad（縦置き）で横目にプレビューを見ながら全幅エディタでタイピングする使い方を想定
- **方式: 組版済みHTMLを BroadcastChannel で送る**のが設計の肝。プレビューは元々クライアント完結（VFM変換→Blob URL→自前ホスト Vivliostyle Viewer iframe）なので、HTML文字列をプロジェクトIDごとのチャンネルで新設ルート `/editor-preview/[projectId]` へ送り、**Blob URL は受信側で生成**する（ウィンドウ間の Blob URL 寿命管理を回避）。受信ページはプロジェクトレイアウト（ヘッダー＋タブ）を継承しない場所に置き、認証は middleware で自動保護。既存 `PreviewPane` をそのまま再利用し、新規は3ファイル（チャンネル型定義 `lib/editor/preview-channel.ts`・受信ページ・vertical-editor.tsx のトグル＋送信）
- **プロトコル**: `document`（HTML＋full＋title）／`ready`（窓→エディタ: 初回・リロード時の再送要求）／`pages`（実ページ数の還元。full フラグつきで全体プレビュー時は反映しない）／`closed`（pagehide）／`hello`（エディタ→窓: 起動通知）。分離中はインラインプレビュー・仕切り・表示切替を畳んで入力ペインを全幅化。分離トグルは lg 未満でも表示（ウィンドウを狭めて外部ディスプレイで見る使い方が主目的のため）
- **subagent 自己レビューが実質的に機能**（ブロッカーなしの評のうえで2件修正）: ①エディタのブラウザリロードでは React の cleanup が走らず分離窓が置き去りになる→エディタ起動時 `hello` ↔ 窓側 `ready` のハンドシェイクで自動再接続に。②送信 effect の依存に `selectedPath` があると章切替時に旧HTMLへ新章タイトルが付いて送られ、窓側は同一HTML再送で iframe が再ロードされず「組版中…」が出続ける→タイトルは組版時点で ref に確定し依存から除去＋窓側は同一HTML時に組版中表示を立てないガード
- 検証: typecheck / lint 通過。ブラウザペインで2タブ構成のE2E（分離表示・ルビつき縦書き組版・実ページ数の実測値がエディタの字数表示へ反映・編集→3秒デバウンスで窓側再組版・「戻す」トグルでインライン復帰・エディタリロード後の自動再接続）をすべて確認。テスト入力は undo で復元し待避も残置なし。マージ後、本番で `/editor-preview/` が 307→/login（returnTo保持）を確認（Vercel 自動デプロイ）
- **ペイン検証の学び**: ペイン内の `window.open` は同一タブ遷移になるため、ポップアップ検証は `tabs_create` で受信ページを別タブに開き BroadcastChannel 越しに確認する（実ブラウザでは独立ウィンドウになる）。また同一フォルダで別セッションの dev サーバー稼働中は Next 16 の二重起動ロックで自前サーバーを立てられない——既存サーバーが同じ作業ツリーを配信しているのでそのまま検証に使えた
- 既知の軽微事項（受容）: 分離窓リロード時に `closed`→`ready` の順で届きインラインプレビューが一瞬復活するちらつき（無害）／pagehide が飛ばない異常終了では分離状態が残る（トグルで復帰可能）

### セッション㊶: UI動線改善——グローバルナビ＋エディタ集中モード（PR #75 マージ・本番反映・7/18）

- **ドッグフーディングの気づきをチャット相談から直接処理**（Issue非経由の初の大きめUI改修）: 「機能間の移動がしにくい・現在地が分からず迷子になる」に対し、Webデザインの動線セオリー（Wayfindingの3問・ナビ3階層・薄い常設ナビ＋没入画面はクロームを外す定石・トップバーvsサイドバー選定基準）を解説したうえでプランモードで設計合意。**AskUserQuestion 2問で方針確定**——①ナビは薄いトップバー（縦書きエディタ・ビートボードは横幅が貴重＝サイドバー不利、行き先6個はトップバーで十分）だが**エディタにも表示し、代わりに集中モードを新設**②集中モードは今回同時実装
- **実装の骨子（16ファイル・+261/-107）**: 認証済みページを**ルートグループ `app/(app)/` へ git mv**（URL不変）し、`app/(app)/layout.tsx` で `AppHeader` を一括マウント。ヘッダーの表示/非表示は React Context（`components/layout/app-chrome.tsx` の `ChromeProvider`／`ChromeHeader`／`useChrome`）で制御し、エディタの集中モードから隠せる構造に。各ハブページの個別ヘッダーからロゴ・テーマ切替・散在リンクを撤去（ページタイトル＋固有アクションのみ残す）。プロジェクトレイアウトは `h-dvh`→`h-full`（スクロール管理を (app) レイアウトの内側コンテナへ移譲）
- **AppHeader**: 🐱ロゴ（→ダッシュボード）｜プロジェクト・ノート・アトリエ・相談（`usePathname` 前方一致で現在地を `bg-secondary` ハイライト。作法は project-tabs.tsx 踏襲）｜右に設定・テーマ・ログアウト。sm未満はナビをハンバーガー（dropdown-menu）へ。`/login`・`/editor-preview`（分離プレビュー窓）・`/api` は対象外
- **エディタ集中モード**: ツールバーの ⛶ で ON→グローバルバー・プロジェクトヘッダー・章一覧・ツールバーを隠し入力ペイン（＋開いていればプレビュー）のみ。Esc または右上の半透明フローティングで解除・dirty 時はフローティングに保存も表示。復元プロンプト等のデータ保全バナーは集中モード中も表示。アンマウント時に `setHidden(false)` をクリーンアップ（タブ遷移で確実に復帰）
- **技術メモ**: ①`git mv` でページを移動すると `.next` の生成型（validator.ts）が旧パスを参照して typecheck が落ちる→ `rm -rf .next` で解消（ビルド成果物なので安全）②middleware（proxy.ts）は全パスマッチのためルートグループ移動の影響なし③ペインの ref クリックが組版完了によるレイアウト変化で Vivliostyle ツールバーに外れた→ `element.click()` フォールバックが今回も確実（既存定石の再確認）
- 検証: typecheck / lint 通過。ペイン（ユーザーにログイン依頼）で全ハブページの表示・現在地ハイライト・ハンバーガー遷移・プロジェクト配下の2段ヘッダーとページ内スクロール・集中モードの往復（Esc／遷移後のクローム復帰）・モバイル幅・ライト/ダーク両テーマ・`/login` と `/editor-preview` へのナビ非表示をすべて確認
- 既知の軽微事項（受容）: 集中モードの終了ボタンがインラインプレビュー（Vivliostyle）のツールバー右上とわずかに重なる（機能影響なし。執筆で邪魔なら位置調整）
- 認証・RLS・秘密情報に非接触のため security-reviewer は不要判断。マージ後: main 取り込み済み（Vercel 自動デプロイ）
### セッション㊷: Issue #45 AI使用量計測（トークン数）——PR #77 マージ・本番反映（7/18）

- **/fix-issue 45 の一気通貫実行**: Issue #45（会話履歴の要約・トークン最適化・使用量/コスト計測）は3SPEC共通の残置項目で規模が大きく、③設計確認で AskUserQuestion 2問——①スコープは**使用量計測のみ先行**（Issue補足の「小さく入れる」案・履歴要約は分割）②**トークン数のみ**（金額換算なし＝単価表の保守を避け、プロバイダ側スペンド上限と役割分担）で合意
- **マイグレーション `20260718000001_ai_usage_logs.sql`**（security-reviewer Critical/High/Medium ゼロ→AskUserQuestion 承認後 db push・純追加型・migration list 一致確認）: 追記専用テーブル `ai_usage_logs`（user_id default auth.uid()・RLSは所有者の select/insert のみ・update/delete ポリシーなし）＋集計関数 `ai_usage_summary(days)`（security invoker・`set search_path = ''`・anon から execute revoke）。Low 1件=自己名義の架空行を直挿入可能→表示専用統計のため許容、**将来クォータ制御に使うなら insert を revoke してサーバー専用経路へ**（マイグレーションにコメント済み）
- **記録の組み込み**: `resolveModel` / `resolveImageModel` の戻り値を `{ model, provider, modelId }` に拡張し、AI 5ルート全部に `recordAiUsage`（lib/ai/usage.ts・throwしない）を追加。streamText / streamObject は `onFinish`、generateObject / generateImage は await 後。feature 名は rate-limit のキーと同語彙（chat / review / proofread / illustration-propose / illustration-generate）
- **表示**: 設定画面に「AI使用量（直近30日）」セクション（`getAiUsageSummary` サーバーアクション→rpc・機能×モデルの回数/入出力トークンのテーブル）。集計はDB側＝PostgREST の1000行上限を回避
- **技術メモ**: ①AI SDK v7 の streamText `onFinish` は `onEnd` の deprecated エイリアスで、イベントの `usage` は**全ステップ合算**（v5系の final-step-only と異なる。stopWhen のツール実行分も含む）②`generateImage` も v7 では `usage`（ImageModelUsage）を返す③型の手動先行パッチ→db push→`db:types` 再生成で**完全一致**を確認（セッション⑥の流儀を再現）
- 検証: typecheck / lint / security-reviewer / subagent 自己レビュー通過。ペインE2E（別セッションのdevサーバーを `preview_start {url}` で流用）: 相談チャット1発話→`ai_usage_logs` に chat/openai/gpt-5.4-mini・入力2,741/出力7 が記録→設定画面のテーブル表示までを縦通し確認。本番: マージ→Vercel Ready→/settings 307→/login（returnTo保持）
- 既知の計測漏れ（受容・PRに明記): ①ストリーミング中のクライアント切断（stop）時は onFinish が発火せず未記録（既存の「切断時は保存しない」設計と整合）②illustration propose のスキーマ検証失敗（NoObjectGeneratedError）時は未記録（低頻度）
- 残スコープの会話履歴要約・コンテキスト圧縮は **Issue #76** に分割起票（着手時は SPEC-ai-deep-dive §3.2「要約はしない」の改訂から。効果測定は今回のトークン計測で before/after 比較可能）

### セッション㊸: /fix-issue #60 進捗グラフの目標線（target_pages のページ→文字数換算）——PR #78 マージ・本番反映（7/18）

- **Issue #60 を `/fix-issue` フローで処理**（影響範囲分析→実装→ブラウザ実機検証→subagent自己レビュー→security-reviewer→PR #78→マージまで1セッション・スキーマ変更なしのため設計確認なしで直行）: SPEC-dashboard-critique-settings で換算係数未定義のため見送っていた目標線を、縦書きエディタPhase 3のページ数見積りロジック流用で実装
- **換算の設計**: 新規 `lib/writing-target.ts`（server-only）がダッシュボードのサーバーレンダー時に book.config.js → テーマCSSをGitHubから読み、`extractKumiSettings`（行数×字詰め）で1ページの収容字数を得て `target_pages` を字数換算。`word-count.ts` から `charsPerPage` を抽出して `estimatePages` と共用（挙動不変）。repo/PAT なし・取得失敗はエディタと同じ既定（文庫A6: 640字/ページ）へフェイルソフトし、PAT復号は「目標×repo×PAT登録が揃うプロジェクトがあるとき」だけに最小化
- **表示**: `progress-line.tsx` が targetChars を縦軸スケールに含めて破線＋「目標」ラベル（上端近くはラベルを線の下へ逃がす）。概況カードのメタ行に「目標 約N字（Mページ換算）」。目標が遠いうちは推移線が下寄りになる（目標までの距離の可視化を優先する仕様）
- 検証: typecheck / lint 通過。ペインで実プロジェクトの換算表示（50ページ→約32,000字=既定640字）を確認し、目標線は一時検証ページで4ケース（目標が遠い/範囲内/達成済み/目標なし）を描画確認してコミット前に削除。subagent 自己レビュー指摘なし・security-reviewer 指摘ゼロ（PAT露出経路・joinRepoPath 迂回・RLS前提を確認）
- **既知のトレードオフ（PRに明記）**: 目標設定済み×repo接続プロジェクトがあるとダッシュボード描画が GitHub Contents API 2回/プロジェクト（no-store）を待つ。換算係数のキャッシュ/DB保存は将来の改善余地
- マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ Ready・本番 307→/login（returnTo保持）を確認

### セッション㊹: /fix-issue #17 AIレビューが作者コメント（`<!-- -->`）を文脈として読む——PR #79 マージ・本番反映（7/18）

- **Issue #17 を `/fix-issue` フローで処理**（影響範囲分析→AskUserQuestion 2問→実装→subagent自己レビュー→PR #79→マージまで1セッション）: 縦書きエディタ Phase 4 のスコープ外項目（親SPEC §4.5 の将来連携）。校正・講評が作者のHTMLコメントを「作者のメモ」として読み、意図を踏まえたレビューをできるようにした
- **調査でIssueの前提と実装の不一致を発見**: 「現状はコメントを除去してレビューしており」は事実と異なり、コメントを除去しているのは字数カウント（word-count.ts）のみ。校正（/api/proofread は `prompt: content` 生渡し）・講評（buildManuscriptCritiqueInput 生結合）とも**説明なしでコメントがAIに渡っていた**——本文と区別されず、校正がコメント内の文章に修正提案を出しうる状態（適用するとコメント内が書き換わる）。実装の実態は「除去をやめる」ではなく「コメントを作者メモとして認識させるプロンプト整備」
- **設計確認（AskUserQuestion 2問で合意）**: ①Issueの補足は「投入方法はSPEC策定時に検討」だったが、**SPECは作らず軽量実装**（コメントはインライン位置のまま活かす＝位置の文脈が保てる・DBマイグレーションなし）②校正は**文脈として読むが校正対象外**（`[ネコノテ校正・保留]` は同趣旨の再提案も抑止）
- **実装は2ファイルのみ**: `lib/ai/prompts.ts` に共通説明 `MANUSCRIPT_COMMENT_CONTEXT`（本・PDFに出ない作者のメモ。構成メモ・保留書き戻し・講評記録の書式列挙つき）＋校正向け `PROOFREAD_COMMENT_GUIDANCE`（original_text にコメント内文字列を含めない=一意一致アンカー適用の防御・保留の蒸し返し禁止）を追加。講評は入力の原稿セクション直前に挿入、校正は system 末尾に結合。`buildReviewSystemPrompt` 本体は無変更のため企画書・構成・シーンレビュー等への影響なし
- 副次効果: Phase 4 で書き戻した講評メモ `manuscripts/00-review-notes.md` は原稿ツリーとして講評入力に含まれるため、過去の講評をAIが「講評の記録」と理解して読む循環（Issueの狙い）が成立
- 検証: typecheck / lint 通過・subagent 自己レビュー指摘なし（書き戻し書式との整合・対象外経路への波及なしを確認）。UI変更なしのためペイン検証は対象外。認証・RLS・秘密情報に非接触のため security-reviewer 不要判断。マージ後: main 取り込み・ローカルブランチ削除・Vercel 本番 Ready・307→/login（returnTo保持）確認
- 積み残し（軽微・受容）: プロンプト指示の実効性（コメント内への提案が実際に出なくなるか・保留の再提案抑止が効くか）はドッグフーディングの実レビューで観察する。効きが弱ければ文言調整 or コメント抽出の構造化投入を将来Issueで検討

### セッション㊺: /fix-issue #18 エディタ内から校正・講評を直接起動——PR #80 マージ・本番反映（7/18）

- **Issue #18 を `/fix-issue` フローで処理**（影響範囲分析→AskUserQuestion 2問→実装→ペイン確認→subagent自己レビュー2巡→PR #80→マージまで1セッション）: 縦書きエディタ Phase 4 で「相互リンクで十分」として見送った項目の再着手。執筆→レビューのループがエディタ内で完結するようになった
- **設計確認（AskUserQuestion 2問で合意）**: ①SPECは作らず既存の ProofreadPanel / CritiquePanel を**エディタの右パネル（縦書きプレビューと入れ替え・lg未満はボトムシート）で再利用** ②校正はコミット済み内容が対象のため、**dirty 時は保存ダイアログへ誘導**し保存成功後に自動でパネルを開く（pendingProofreadRef 予約方式。キャンセル・競合時は予約解除）
- **実装は vertical-editor.tsx 1ファイル（+216/-6）**: ツールバーに「校正」（章未選択・読込中・マージ中は無効）「講評」（章0件は無効）を追加し、原稿レビュー画面への相互リンクはアイコンボタンへ縮退。校正データは `openManuscriptFile` で取得し、提案の受入/拒否/保留・まとめてコミット・保留書き戻し・講評メモ書き戻しは既存パネル機能をそのまま利用。提案カードクリックは CodeMirror の該当箇所を選択スクロール（`EditorView.scrollIntoView`）
- **最重要の相互作用＝楽観ロックの追従**: 校正の「まとめてコミット」「保留書き戻し」はGitHubにコミットを作るため、完了後にエディタ未編集ならリモート最新を開き直して baseSha を前進（放置すると次の保存が必ず競合フローに入る）。dirty 時は警告トーストのみ出して既存のマージ支援フローへ流す
- **subagent 自己レビュー2巡が有効に機能**: 1巡目で状態管理バグ4件（①保存 conflict 時に pendingProofreadRef が残留し後日の無関係な保存でパネルが勝手に開く ②講評経由の章切替後に前章の提案が一瞬表示され誤操作可能 ③refreshReview が await 中の章切替で旧章へ引き戻すレース ④パネル中の明示的なプレビュー再開が閉時の復元で上書き）を検出→全修正→2巡目で指摘なし
- 検証: typecheck / lint 通過。ペイン（別セッションのdevサーバーを `preview_start {url}` で流用）で新ボタン表示・章0件時の disabled 制御を確認。**パネルを開いて以降の実フローは未検証**——現リポジトリは原稿0件で、章作成は実小説リポジトリへのコミットになるため自動フローでは実施せず（PRに明記済み）。認証・RLS・秘密情報に非接触のため security-reviewer 不要判断。マージ後: main 取り込み・ローカルブランチ削除・Vercel 本番 Ready・307→/login（returnTo保持）確認
- 積み残し（軽微・受容）: ①校正ストリーミング中に校正ボタンを再押下するとパネルが再マウントされストリーム表示が失われる（サーバー側の提案保存は継続・実害軽微）②エディタの講評ボタンの活性条件は章（.md）基準で、原稿タブのファイル（.md/.txt）基準とわずかに異なる。どちらもドッグフーディングで気になれば起票

### セッション㊻: /fix-issue #81 レビューパネルの中央拡大表示トグル——PR #82 マージ・本番反映（7/19）

- **Issue #81 を `/fix-issue` フローで処理**（影響範囲分析→実装→ペイン実機検証→subagent自己レビュー→PR #82→マージまで1セッション・設計確認基準に非該当のため確認なしで直行）: 企画書レビューのコメントが右サイドパネル（固定幅384px）では狭くて読みづらい問題。レビュー通過が執筆の前提条件でコメント文量も多いため、視認性はドッグフーディングの支障だった（P1）
- **実装は `components/review/review-panel.tsx` 1ファイル（+27/-2）**: ヘッダーに拡大/縮小トグルボタン（Maximize2/Minimize2・`aria-pressed`）を追加し、拡大時は `fixed inset-0 m-auto` でウィンドウ中央にオーバーレイ表示（幅 `min(100%, 48rem)`＝サイド時の約2倍・高さ90dvh・角丸＋シャドウ）。通常時は従来どおり lg以上=右サイド / lg未満=ボトムシート。共通パネルのため企画書だけでなくキャラクター・構成・シーンレビューでも同じトグルが使える
- 設計メモ: バックドロップ・Escapeクローズは付けず背景の編集操作は可能なまま（シンプル優先・トグル式オーバーレイの割り切り）。z-30 はダイアログ類（z-50）より下・ページ内 sticky（z-10）より上で衝突なし。パネルは閉じるとアンマウントされるため拡大状態は次回サイド表示にリセット
- 検証: typecheck / lint 通過。ペイン実機（1280px）でサイド→中央拡大→サイド復帰のトグル動作、モバイル幅375pxでボトムシート65dvh→全幅90dvh拡大を確認。subagent 自己レビュー指摘なし（z-index横断確認・スコープ外変更なし・テーマ変数のみ）。認証・RLS・秘密情報に非接触のため security-reviewer 不要判断。マージ後: main 取り込み済み（Vercel 自動デプロイ）

### セッション㊼: /fix-issue #83 ノートのタグ候補が出っぱなし——PR #84 マージ・本番反映（7/19）

- **Issue #83 を `/fix-issue` フローで処理**（影響範囲分析→実装→ペイン実機検証→subagent自己レビュー2巡→PR #84→マージまで1セッション・設計確認基準に非該当のため確認なしで直行）: ノートでタグをひとつ追加すると他のタグ候補が表示されたまま消えず、本文をクリックしても閉じないバグ
- **原因の特定が本質だった**: `components/notes/tag-input.tsx` は候補リストのクローズを Input の `onBlur`（150ms 遅延）だけに頼っていたが、①候補ボタンの `onMouseDown` の `preventDefault` が blur を抑止（候補クリックを blur より先に処理させるための既存措置）②さらに `attach()` 中は `pending` で Input が `disabled` になり、**フォーカスが blur イベントなしで失われる**（ブラウザの既知の挙動）。この二段構えで `onBlur` が二度と発火しなくなり、以後どこをクリックしてもリストが閉じない状態に陥っていた
- **修正は3行のみ**: `attach()` の `finally` で `setOpen(false)` を明示的に呼び、成功・失敗どちらでも候補リストを閉じる。`onBlur` 経路（候補を選ばず外をクリック）は従来どおり
- **subagent 自己レビューが失敗パスの取りこぼしを検出**: 初回実装は成功時のみ `setOpen(false)` で、`attachTag` 失敗（`result.ok` false／throw）の早期 return 時に元のバグがそのまま残る指摘→ `finally` へ移動して解消→再レビューで「問題なし」（失敗時に value が残る挙動はリトライ動線としてむしろ妥当・blurTimeout との干渉なしも確認）
- 検証: typecheck / lint 通過。ペイン実機で修正前の再現→修正後はタグ選択の瞬間に候補リストが閉じることを確認（検証用ノート2件はごみ箱へ移動して後片付け済み）。認証・RLS・秘密情報に非接触のため security-reviewer 不要判断。マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ

### セッション㊽: /fix-issue #85 ノート一覧のソート機能——PR #86 マージ・本番反映（7/19）

- **Issue #85 を `/fix-issue` フローで処理**（影響範囲分析→実装→ペイン実機検証→subagent自己レビュー→PR #86→マージまで1セッション・設計確認基準に非該当のため確認なしで直行）: ノート一覧が更新日時降順固定で、加筆を繰り返す運用（P1・enhancement）に合わせたソート切替がなかった
- **実装は5ファイル（+114/-10）**: URLパラメータ `sort`（updated_desc / updated_asc / created_desc / created_asc・デフォルトの updated_desc はURLに付けない）を追加。新規 `components/notes/sort-options.ts` に server/client 共有のソート定義（4種＋`toSortValue` バリデーション）、新規 `sort-menu.tsx` に DropdownMenu + Link のソート切替UI（選択状態はURLが正・タグフィルタと同じ思想）。page.tsx は sort を Supabase の `order()` にマッピング。検索フォーム（hidden input）・タグチップ（buildHref）とソートは相互に状態を維持。ごみ箱ビューは従来どおり削除日時降順（スコープ外）
- **途中の学び: "use client" ファイルの関数はサーバーから呼べない**——当初ソート定義を sort-menu.tsx（"use client"）に同居させたため、page.tsx（Server Component）からの `toSortValue()` 呼び出しが実行時500（Attempted to call from the server）。typecheck では検出されずペイン実機で発覚 → 定義を "use client" なしの `sort-options.ts` に分離して解決。server/client 共有の定数・純関数はディレクティブなしの専用モジュールに置くのが定石
- 検証: typecheck / lint 通過。ペイン実機で4種すべての並び替え（URL直指定＋メニュー選択の両経路）、選択後のメニュークローズとトリガーラベル更新、タグ絞り込み・検索フォームとのソート状態併用（`/notes?tags=…&sort=updated_asc`）を確認。subagent 自己レビュー指摘なし（デフォルト時にURLパラメータを付けない方針の3箇所一貫・テーマ変数のみ・スコープ外変更なし）。認証・RLS・秘密情報に非接触のため security-reviewer 不要判断。マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ

### セッション㊾: マルチユーザー対応の影響範囲調査・Issue起票（#87〜#92）——コード変更なし（7/20）

- **今期スコープ外・影響大の「マルチユーザー対応」を将来に向けて調査しIssue化**（実装なし・起票のみ）: プランモードで現状調査→AskUserQuestion 8問の仕様インタビュー→親Issue #87＋子Issue 5件（#88〜#92・enhancement/P3）を依存順に起票。粒度は「土台（管理者ロール・ユーザー管理）→機能3本（使用量上限・お知らせ・問い合わせ）→最終ゲート（セキュリティ再評価）」の5分割
- **調査の最重要所見: RLSは第一期設計から全テーブルでユーザー分離済み**（`user_id` + `auth.uid()` ポリシー・GitHub PAT / ai_usage_logs / illustrations Storage もユーザー単位）——「ログインユーザーに紐づく情報のみ閲覧」はDBレベルでほぼ達成済みで、マルチユーザー化の実体は ①管理者ロールの新設（現状 role 概念ゼロ・service_role も未使用）②許可リスト（private.auth_allowlist＋ALLOWED_EMAILS の手動2層）の管理画面化 ③ai_usage_logs の上限制御転用（クライアント直挿入 revoke がコメントで予告済み）④お知らせ・問い合わせの新規2機能 ⑤security-audit L-5 等「単一ユーザー前提で受容」した判断の再評価
- **インタビューで確定した主要仕様**: 上限はトークン数ベース・月次・到達でAI機能ブロック／APIキーは運営者共有継続／ユーザー追加は許可リスト登録方式（招待メールなし）／削除は二段階（無効化→完全削除。Storage 物理削除は cascade では消えない点をIssueに明記）／お知らせは全員一斉＋既読管理／問い合わせはスレッド式（管理者返信あり）
- 各Issueには確定仕様・現状所見（該当ファイル・マイグレーションのパス付き）・想定修正内容・見積もり・設計判断ポイント（例: proxy 二次ゲートの毎リクエストDB照会 vs JWT クレーム）を記載し、将来の着手時に調査をやり直さなくて済む形にした。全Issueが認証・RLSに触れるため security-reviewer 必須ゲートである旨も明記
- 検証: `gh issue view` で親子の相互リンク・プレースホルダ解消を確認（#92 に置換漏れ1件があり修正済み）。コード変更なしのため typecheck / lint 対象外
- 追記: 既存の **コラボ機能 #27（相互レビュー・合同誌支援）を #87 と双方向リンク**——#27 はマルチユーザー基盤の上に載る機能のため「#88（ユーザー管理基盤）・#92（セキュリティ再評価）の完了が着手の前提条件」を #27 本文に、#87 側には関連Issue節を追加（コラボは共有＝RLS拡張が本丸で、分離を固める本Issue群とは逆方向の変更になる旨を明記）

### セッション㊾続き: 汎用執筆支援（ジャンル対応・技術書）の影響範囲調査・Issue起票（#93〜#97）——コード変更なし（7/20）

- **第2弾: 小説特化→汎用執筆支援（第一目標: 技術書）の拡張を調査しIssue化**（実装なし・起票のみ）: プランモードで現状調査→AskUserQuestion 8問の仕様インタビュー→親 #93＋子4件（#94〜#97・enhancement/P3）。粒度は「基盤（執筆ジャンル・執筆目的）→ペルソナ自動適用→ボードのモード化→横書き対応」の4分割
- **調査の最重要所見: 縦書きはアプリコードでなく原稿リポジトリのテーマCSS（theme-bunko）由来**——アプリに `writing-mode` は1箇所もなく、`APP_HOSTED_THEMES`（lib/editor/theme.ts）でプレビュー用に読み替えているだけ。よって「横書き対応」の実体は横書きテーマ（theme-techbook 等）のホスト追加＋検証＋縦書き専用UI（傍点・縦中横）の出し分けで、**ジャンル基盤と独立に着手可能**（#97）。ほか: AIへの企画書情報は `proposalSection()` 1関数に集約（項目追加が全経路へ波及する良い構造）／プロファイル選択は target_phase＋is_default 先頭でジャンルの概念ゼロ／ビートボードの4部構成・5転換点はDBのCHECK制約レベルで小説理論に固定
- **インタビューで確定した主要仕様**: 執筆ジャンルは小説/技術書/その他の3種から開始（既存は小説扱い・既存ジャンル欄は「内容ジャンル」として併存）／プロジェクト作成時に選択＋企画書で変更可（テンプレはジャンル別・変更時は書き換えない）／自動適用は「既定選択」でクロスジャンル選択は可能なまま／技術書レビューは企画書・構成・講評・校正の4フェーズ全部／ビートボードはジャンル別モード化（レーン差し替え）／横書きはテーマ追従の自動判定（プレビューとPDFが常に一致）
- 検証: 全5Issueをgrepしプレースホルダ解消を確認（#94 に置換漏れ2件があり修正済み）。コード変更なしのため typecheck / lint 対象外
- 追記: **マルチユーザー対応に「GitHub原稿管理はユーザー単位」の仕様を追加**（#87 の確定仕様表＋#88）——各ユーザーが自分のGitHubアカウント（PAT）を登録して紐づける。全ユーザーにGitHubアカウント必須となるが許容。現行実装（user_settings.github_pat_ciphertext のユーザー単位暗号化保存・本人PATでの取得/コミット）がそのまま要件を満たすため追加開発は原則不要＝GitHub App への差し替え（GitCredentialProvider 抽象化の将来案）は不採用。残作業は新規ユーザーのPAT登録オンボーディング導線のみ（#88 に記載）
- 追記: **#96 は方式の再選定を着手時の検討課題として明記**——ビートボードは小説・脚本執筆のメソッドで汎用化が難しいため、既存ボードのジャンル別モード化に加え、非小説ジャンルでは**シンプルなカンバン方式の構成設計機能を新設して置き換える**方式も候補として比較する（利点: 小説理論の枠を読み替えずに済む・既存ボードは無変更。論点: scenes 共用 or 別テーブル・構成レビューとの接続・dnd-kit 再利用範囲）。タイトルも「構成設計のジャンル対応（ビートボードのモード化 or カンバン方式への置き換え）」へ変更
- 追記: GitHub マイルストーン **「第三期開発（2027年予定）」を新規作成**し、汎用執筆支援の全Issue（#93〜#97）に設定

### セッション㊿: /fix-issue #99 企画書レビュー結果のノート転記——PR #101 マージ・本番反映（7/20）

- **Issue #99 を `/fix-issue` フローで処理**（影響範囲分析→実装→ペイン実機検証→subagent自己レビュー→PR #101→マージまで1セッション・設計確認基準に非該当のため確認なしで直行）: 企画書レビューのフィードバックはボリュームが多く指摘箇所も複数に及ぶため、対応漏れが起きやすい（P1・enhancement）。フィードバックをノートに転記して、指摘対応のメモを取りながら進められるようにした
- **実装は3ファイル（+108）**: Server Action `saveFeedbackAsNote(feedbackId)`（lib/actions/review.ts）は RLS 越しにフィードバック＋セッション＋プロジェクトを取得（所有確認を兼ねる・本文はDBから読み直し＝`saveChatMessageAsNote` と同じ流儀）→ ノート作成 → タグ付与（既存 `attachTag` を再利用）。共通 ReviewPanel の FeedbackCard ヘッダーに「ノートに転記」ボタン（成功トースト＋「ノートをひらく」アクション・多重実行ガード）。構成・シーン等でも使われる共通パネルのため opt-in の `enableCopyToNote` prop とし企画書レビューパネルのみ有効化、サーバー側でも `target_phase = 'proposal'` を検証
- 設計メモ: 企画書（proposals）に独自タイトルがないため「企画書のタイトル」=プロジェクトタイトルと解釈。ノートタイトルは `「{プロジェクトタイトル}」{プロファイル名} 第{N}回（{日付}）`（「第N回」は同一セッション内 created_at 順の件数でパネル表示と一致）。タグは草稿→浄書モデルの「作品名で束ねる」流儀どおり `working_title` 種別でプロジェクトタイトル名を get-or-create。転記ノートは proposal_notes には紐づけない（レビュー結果が次回レビューの入力に混入するのを避ける）
- 検証: typecheck / lint 通過。ペイン実機で第5回フィードバックの転記→ノート「「人魚の唄［Siren Song from Deep Ocean］」企画書レビュー 第5回（2026/7/20）」＋仮タイトルタグの生成を確認（検証ノートは開発DBに残置）。subagent 自己レビュー: 要件充足・ブロッカーなし（低深刻度2件は既存パターン踏襲・仕様上許容と判断し対応せず）。認証・RLS・秘密情報に非接触のため security-reviewer 不要判断。マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ

### セッション51: /fix-issue #98 レビュー停止時のサーバー側中断——PR #100 マージ・本番反映（7/20）

- **Issue #98 を `/fix-issue` フローで処理**（影響範囲分析→実装→subagent自己レビュー→PR #100→ユーザーのペインログイン後に実機E2E→マージまで1セッション・設計確認基準に非該当のため確認なしで直行）: 企画書レビューを停止ボタンでキャンセルしても内部的にはキャンセルされず、生成が完走して保存され、再レビュー時の履歴にも混入するバグ（P1・bug）
- **原因: `/api/review` の `streamText` に `abortSignal` 未指定**——クライアント（review-panel）は AbortController で fetch を中断していたが、サーバー側はプロバイダ呼び出しが継続し `onFinish` で `review_feedbacks` に保存されていた。旧コメント「stop によるクライアント切断時は保存しない」は実態と不一致（セッション㊷で「切断時は onFinish が発火せず未記録」と記した既知の計測漏れ①も同根の誤認で、実際は発火・保存されていた）
- **修正は route.ts 1ファイル（+19/-17）**: `abortSignal: req.signal` を追加し切断で生成そのものを中断。AI SDK v7 は abort 時に `onAbort` のみ呼び `onFinish` はスキップする（dist 実装の abort 経路を追跡し、`finish` パート未記録→flush で onEnd 通知スキップを確認）＝フィードバック非保存・履歴非混入・draft→in_review 遷移も走らない。講評（読み切り型）が running のまま残らないよう `finalizeCritique` を onFinish 外へ抽出し `onAbort` / `onError` から failed 確定
- **割り切り（コメント・PRに明記）**: ①中断時の AI 使用量記録は SDK が abort 時に usage を提供しないため不可（レート制限 3回/分・60回/日 が下限ガード）②Vercel での切断後処理の継続保証は、本Issueの症状（切断後も生成完走・保存）自体が継続実態の証拠と判断し waitUntil 等の新規依存は追加せず。万一 onAbort の DB 更新が落ちても講評セッションが running で残るだけ（一覧は completed のみ表示で実害なし）
- **実機E2E（ユーザーにペインのGoogleログインを依頼して実施）**: 実データ（人魚の唄・既存フィードバック6件）でレビュー実行→約2秒で停止→ `POST /api/review` が**7.9秒で終了**（完走なら1分前後・abort伝播の証跡）→ `review_feedbacks` は停止直後も**60秒後も6件のまま**（遅延保存なし）→パネル再表示で第1回〜第6回のカードのみ。検証結果はPRコメントに記録
- 検証: typecheck / lint 通過。subagent 自己レビュー指摘2件（使用量記録の後退・Vercel継続リスク）はいずれも上記の割り切りとして整理。認証・RLS・秘密情報に非接触のため security-reviewer 不要判断。マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ

### セッション52: /fix-issue #57 構成/シーンレビューのゲート化——PR #102 マージ・本番反映（7/21）

- **Issue #57 を `/fix-issue` フローで処理**（影響範囲分析→設計確認2問→マイグレーション適用→実装→ペイン実機検証→security-reviewer→subagent自己レビュー→PR #102→マージまで1セッション）: 構成・シーンレビューは読み物として受け取る都度フィードバック型で、企画書のような判定（verdict）・「通す」ボタンのゲートがなかった（P2・enhancement・SPEC-beat-board スコープ外項目の昇格）
- **設計確認（AskUserQuestion 2問・DBスキーマ変更のため着手前に実施）**: ①「通す」の永続先→**ステータス列を追加**（セッション完了のみの軽量案は不採用）②列設計→**draft / approved の2状態**（企画書の in_review は持たない。3状態完全一致案は不採用）
- **実装は12ファイル（+288/-28）**: マイグレーション `20260721000001`（`scenes.status` / `projects.structure_status` 追加＋標準「構成レビュー」「シーンレビュー」プロファイル（固定UUID 1003/1004）の prompt_template に判定行指示を追記・書式は企画書と同一）→ `/api/review` の verdict パースを `VERDICT_PHASES`（proposal/structure/scene）に拡張 → Server Action `approveBoardReview(sessionId)` 新設（RLS越し取得＋running＋target_phase 限定＋最新 verdict=approved のサーバー側再検証→対象ステータス approved＋セッション completed。`approveProposal` と同水準）→ ビートボードの両パネルに判定バッジ・「構成を通す」「シーンを通す」フッター・承認済みメッセージ、ボードヘッダーに「構成承認済み」バッジ、シーンカードに「承認済み」バッジ
- **subagent 自己レビュー指摘2件を修正して再レビュークローズ**: ①VerdictBadge が verdict=null（ゲート化前の構成/シーン履歴）を「差し戻し」誤表示→null ガード追加 ②シーン系アクションの upsert が取得時点の status を書き戻し `approveBoardReview` との競合で承認が巻き戻る窓→upsert ペイロードから status を除外（新規行は DB default 'draft'）
- **security-reviewer 指摘ゼロ**（列追加は既存 FOR ALL ポリシーがテーブル単位で自動保護・所有確認と対象すり替え遮断は approveProposal と同一パターン・「通す」出現条件はクライアント値だがサーバー側で verdict 再検証・sceneEditSchema に status が無くクライアントから承認状態を直接操作する経路なし）
- 検証: typecheck / lint 通過。`db push` 適用（migration list 一致・`db:types` 再生成が手動先行パッチと完全一致）。ペイン実機で構成レビュー実行→更新済みプロンプトが最終行に「判定: 差し戻し」を出力→「第1回 差し戻し」バッジ表示→差し戻し時に「通す」非表示を確認（人魚の唄に構成レビュー第1回・差し戻しが1件残置。実レビューとしてそのまま使える）。承認→「通す」の実経路は実データで承認判定が出た際に確認できる（サーバー検証は2重レビュー済み）。マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ

### セッション53: /fix-issue #56 シーンカードへのノート・原稿ファイル紐づけ——PR #103 マージ・本番反映（7/21）

- **Issue #56 を `/fix-issue` フローで処理**（影響範囲分析→設計確認2問→security-reviewer→マイグレーション適用→実装→ペイン実機検証→subagent自己レビュー→PR #103→マージまで1セッション）: シーンカードにノート（設定資料）・原稿ファイル（章）を紐づける導線がなかった（SPEC-beat-board スコープ外項目の昇格。構成と執筆が対応づき、シーンから該当章のエディタへ飛べる）
- **設計確認（AskUserQuestion 2問・DBスキーマ変更のため着手前に実施）**: ①原稿ファイルの持ち方→**1シーン=1ファイルの `scenes.manuscript_path` 列**（中間テーブル案は不採用。複数シーンが同じ章を指すのは列でも自然に可能）②カード表示→**小さなアイコンバッジ**（原稿ありバッジ=クリックでエディタへ・ノート件数バッジ。ダイアログ内のみ案は不採用）
- **実装は14ファイル（+522/-118）**: マイグレーション `20260721000002`（`scene_notes` 中間テーブル=proposal_notes と同型のRLS（シーン所有 AND ノート所有・using/with check 対称）＋`scenes.manuscript_path` nullable text）→ Server Action `attachSceneNote` / `detachSceneNote`（attachProposalNote と同型・ノート検索は既存 `searchNotesForLink` 再利用）→ シーン編集ダイアログに紐づけセクション（ノートチップは即時保存・原稿 select は `getManuscriptTree` 遅延取得＋repo/PAT 未設定は誘導文・「エディタで開く」リンク）→ カードバッジ（カード全体が `<button>` のため原稿バッジは `role="link"` span＋stopPropagation で `router.push`）
- **企画書の紐づけノートUIを `LinkedNoteChips`（components/notes/）として抽出・共通化**——チップ・検索ポップオーバーを1:1で切り出し、attach/detach のサーバー保存・state・トーストは呼び出し側の責務（LinkedNotes は薄いラッパー化・見た目挙動不変）。ボード側は BeatBoard が `notesMap` を state 管理してダイアログ・カード件数へ配布
- **subagent 自己レビュー指摘3件を修正して再レビュークローズ**: ①原稿 select の候補が base_path 配下の全 .md/.txt で、エディタが開ける章（`manuscripts/*.md`・listChapters の規則）と不一致＝無言のデッドリンクが作れる→章集合にフィルタ（末尾スラッシュ処理まで listChapters と同一規則を確認済み）②`/api/review` の fetchScenes が manuscript_path 非取得のまま `as SceneRecord[]`（型の嘘）→列追加 ③scene_notes 初期表示に order 未指定→`created_at` 順（企画書と同型）
- **security-reviewer 通過（Critical/High/Medium なし・Low 2件は実害なし記録のみ）**: 新RLSは作成と同時に有効化・FOR ALL の using/with check 完全対称で行の付け替えも遮断・anon は default privileges revoke と to authenticated の二重遮断。manuscript_path は保存時形式検証（`manuscriptFilePathSchema`）のみだが、エディタ側が章一覧完全一致＋base_path 再検証で開くため越権参照に至らない（多層防御の整理をレビュー報告に記録）
- 検証: typecheck / lint 通過。`db push` 適用（migration list 一致・`db:types` 再生成が手動先行パッチと一致）。ペイン実機でノート検索→紐づけ→チップ→リロード復元→解除、カードの「紐づけノート 1件」バッジ、企画書ページの回帰（チップ・ポップオーバー）を確認（検証シーンは削除済み）。原稿 select は対象リポジトリの `manuscripts/` にまだ章ファイルがなく描画（gate=ok・選択肢なし）までの確認——初章作成後に実導線が通る。マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ
- ペイン検証メモ: 同一フォルダの別セッション dev サーバーは Next 16 の二重起動ロックで自前起動不可→既存サーバー（同じ作業ツリー配信）を `preview_start {url}` で流用する定石（セッション㊵）を追認

### セッション54: /fix-issue #104 アトリエの参照画像アップロード——PR #105 マージ・本番反映（7/23）

- **Issue #104 を `/fix-issue` フローで処理**（影響範囲分析→設計確認1問→マイグレーション適用→実装→ペイン実機検証→security-reviewer＋subagent自己レビュー並行→PR #105→マージまで1セッション）: 生成イラストの雰囲気・キャラ統一のリファレンスとして外部画像をアップロードして参照画像に使いたい（P2・enhancement・**SPEC-illustrator §7 スコープ外項目の昇格**。SPEC は §9 追補として改訂）
- **設計確認（AskUserQuestion 1問・DBスキーマ変更＋セキュリティ関連のため着手前に実施）**: 保存方式→**アップロード画像を `illustrations` の1行（kind 新値 'reference'・ラベル「参照用」）として保存**（専用テーブル分離案・保存せず都度添付案は不採用）。既存の参照選択（`reference_illustration_id`）・署名URL・ギャラリー・削除（被参照警告）・生成APIの参照ダウンロードを**無変更で流用**できる最小構成
- **実装は9ファイル（+264/-31）**: マイグレーション `20260723000001`（kind CHECK に 'reference' 追加のみ・後方互換・RLS/Storageポリシー変更なし）→ Server Action `uploadReferenceImage`（png/jpeg/webp・10MB・レートリミット分10/日100・projects RLS越し所有確認→Storage保存→行insert・失敗時オブジェクト掃除・パスはサーバー採番 `{user_id}/{uuid}.{ext}` で file.name 非使用）→ ギャラリーヘッダーに「参照画像をアップロード」ボタン（hidden input・クライアント側サイズ事前検査＋catch）→ 拡大表示は prompt 空で説明文非表示・依頼フォームのプロンプト引き継ぎも空ならスキップ（入力中の内容を消さない）
- **型の分離が要**: 'reference' は生成の依頼種別ではない——zod の `illustrationKinds` には追加せず propose/generate の入力から遮断し、DB保存されうる全体は `storedIllustrationKinds` として別定義（依頼フォームの種別セレクタは illustrationKinds 列挙のため UI にも出ない）。生成ルートの拡張子マップは `ILLUSTRATION_EXTENSION_BY_MIME` としてスキーマへ移してアップロードと共用
- **security-reviewer: Critical〜Medium ゼロ（Low 3件）**——L-2 クライアント catch なし・L-3 fileName 長さ上限なしは対応済み。L-1「MIME はクライアント申告値のみ（Storage 側検証も同じ申告値）」は非公開バケット＋署名URL配信の Content-Type が保存時値に固定でスクリプト実行に至らず許容と判断（コードコメントに実態を明記）
- **subagent 自己レビュー指摘1件（中）を対応**: Server Action の `bodySizeLimit`（15mb）超過はアクション到達前に reject されサーバー側の検証文言が出せない＝15MB超のファイルで無反応になる→クライアント側で `REFERENCE_UPLOAD_MAX_BYTES` を事前検査してトースト表示。rate-limit の日次超過文言が「AI利用回数」固定な点は既存共通関数の制約として未対応（実害なし）
- 検証: typecheck / lint 通過。`db push` 適用（CHECK 張り替えのみ・旧コード非影響のためデプロイ前適用で安全と判断・ユーザー承認済み）。ペイン実機（ユーザーにペインの再ログインを依頼）で合成PNG注入→アップロード→「参照用」バッジ＋ファイル名タイトルでギャラリー先頭表示→拡大表示で説明文非表示→生成画像参照からアップロード参照への切替でプロンプト266字保持→text/plain 偽装のサーバー側拒否トースト→11MB のクライアント側事前拒否→削除（参照チップ自動解除）まで一巡・コンソールエラーなし（検証画像は削除済み）。マージ後: main 取り込み・ローカルブランチ削除・Vercel 自動デプロイ
- ペイン検証メモ: ネイティブのファイル選択ダイアログは操作不可→`DataTransfer` で合成 File を `input.files` に注入して change をディスパッチする方式が有効（canvas でPNG実体も合成できる）。accept 属性はプログラム注入を素通しするため、この方式はサーバー側検証の実証にもなる
