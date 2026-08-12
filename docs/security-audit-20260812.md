# セキュリティ監査結果（2026-08-12）

締めくくり作業計画 Step 2 として実施した、コードベース全体（`main` @ `022deeb`）のセキュリティ監査の記録。
公開化（Step P）の前提ゲートを兼ねる。各指摘の「状態」を更新しながら消化していくこと
（未対応 / 対応中 / 対応済み / 対応しない（理由））。

## 監査範囲

前回監査 `docs/security-audit-20260714.md`（`main` @ `11701de`）以降の **262コミット・303ファイル・+39,828/-6,489行**
を含む全体再点検。前回からの規模変化は下表のとおりで、新機能（縦書きエディタ・入稿PDFビルド・
イラスト生成・Zenn連携・AI使用量計測・添付ファイル）とセッション92のリファクタリングが主な増分。

| 対象 | 前回（7/14） | 今回（8/12） |
| --- | --- | --- |
| マイグレーション | 9本 | 29本 |
| Route Handler | 3本 | 12本 |
| Server Action ファイル | 8本 | 20本（106関数） |
| Storage バケット | 0 | 2（illustrations / attachments） |

観点別に5系統へ分割し、それぞれ security-reviewer で監査した。

1. 全テーブルの RLS ポリシー網羅性（マイグレーション29本）
2. Route Handler 12本の認証・認可＋`proxy.ts` の保護範囲
3. Server Action 106関数の認証・認可と入力バリデーション（zod スキーマ全ファイル）
4. PAT・APIキーのクライアント／ログ／git履歴への露出経路
5. クライアント描画の XSS・出力境界・CSRF・リダイレクト
6. `npm audit` と依存パッケージ更新

## 総評

**Critical / High はゼロ。** 前回監査で確立した設計規律——作成時RLS・USING/WITH CHECK対・
参照先所有検証・anon多層遮断・「zod → 認証 → RLS → 0件チェック」——は、規模が3倍になった今回も
一貫して維持されている。セッション92のリファクタリング（`lib/git/project-context.ts` への集約・
`editor.ts` の7分割）でも検証水準は落ちておらず、むしろ一貫性は向上した。

指摘は **Medium 2件・Low 6件**。うち Medium 1件（M-1）は前回監査の
「XSSシンクゼロ」という前提が縦書きエディタのプレビュー導入により失効していたもので、
**本監査で実機再現まで確認した唯一の実質的な発見**。もう1件（M-2）は公開リポジトリ規約の
抵触箇所で、Step P の前提として処理が必要。

なお前回監査と同じく、指摘の実害はいずれも **「ALLOWED_EMAILS による単一許可ユーザー制」**
という前提に大きく依存している。複数ユーザー化・共有機能の導入時は、L-4 / L-5 / L-6 と
前回監査 L-5 をまとめて再評価すること。

---

## Medium

### M-1. 縦書きエディタの組版プレビューでアプリオリジンの任意JSが実行される

- **状態**: 対応しない（受容。**2026-08-12 に SPEC-vertical-editor-phase2 §9 へ
  受容済みリスクとして明記し、再評価トリガーを定義済み**）
- **該当**: `lib/editor/preview.ts:99-147`（`buildPreviewHtml`）・
  `components/editor/preview-pane.tsx:69-75,103-108`（Blob URL 化と iframe）・
  `app/editor-preview/[projectId]/page.tsx:69-80`（分離窓も同一経路）
- **何が問題か**: VFM（`@vivliostyle/vfm` の `stringify`）は生HTMLを素通しする。その出力を
  `URL.createObjectURL` で Blob 化し（＝生成元オリジンを継承）、同一オリジンの
  `/vivliostyle/viewer/index.html` に `sandbox` なしの iframe で読ませているため、
  原稿に書いたHTMLがアプリのオリジンで実行される。
- **実測（2026-08-12・本監査で再現確認）**: ビューア資産を同条件で配信し、
  `<img src=x onerror=...>`・インライン `<script>`・`<svg onload=...>` を含む文書を
  同じ経路（Blob URL → `#src=` → `renderAllPages=true`）で読ませたところ、
  **`img onerror` と インライン `<script>` の両方が実行され、`parent`（＝アプリ側 window）へ
  到達できた**。事前の静的解析では「`<script>` は実行されない見込み」と評価していたが、
  実際には実行される。
- **攻撃シナリオ**: 単一ユーザー制のため基本は self-XSS の範囲。ただし前回監査 L-5
  （プロンプトインジェクション残余）と結合すると経路が一段深くなる——ノート/原稿に仕込まれた
  指示 → LLM が校正提案や章生成の出力に `<img src=x onerror=...>` を混ぜる →
  本人が提案を適用（`lib/proofread-apply.ts` は原文一致で機械適用）→ プレビュー描画で
  アプリオリジンのJS実行 → 本人セッションで Server Actions / `/api/editor/*` を叩ける
  （PAT実値は返らないが、リポジトリ書き込み・ノート改変は本人権限で可能）。
  phase5 のブランチ切替でPRブランチの原稿もプレビューできるため、将来リポジトリに
  外部コントリビュータが入ると self-XSS では済まなくなる。
- **修正方針**: 生HTML許容は仕様上必須（`components/editor/codemirror.ts` の
  `insertWarichuText` / `insertPageBreak` が挿入する割注 `<span class="warichu">`（インライン）・
  改ページ `<div class="page-break">`（ブロック）が生HTMLの素通しを前提にしている）
  のため、全面サニタイズは非現実的。選択肢は3つ:
  1. **受容済みリスクとして明文化**（`docs/SPEC-vertical-editor-phase2.md` §9 に追記）。
     Zenn側は `docs/SPEC-zenn-integration.md:199` に self-XSS 範囲と明記済みで、
     縦書きプレビューだけ記述がない状態を解消する。コスト最小
     → **2026-08-12 にこの案を採用し追記済み**
  2. **allowlist サニタイズ**: 割注・改ページ・ルビ等の必要タグのみ許可し、
     `script` とイベントハンドラ属性を落とす。防御としては本命だが実装量あり
  3. **CSP**: `next.config.ts` の `headers()` で `/vivliostyle/viewer/*` に
     `script-src` 制限。ただしビューア自身のスクリプト要件の確認が必要。
     `sandbox` 属性は `allow-same-origin` を外すと blob: 読み込みとページ数取得
     （`preview-pane.tsx:47-59`）が壊れるため単純適用は不可

### M-2. 伏せ字規約に抵触する例示文字列が現存（Step P の前提）

- **状態**: 未対応（Step P の判断事項。**現ファイル差し替えと git 履歴の扱いはセット**）
- **概要**: CLAUDE.md の公開リポジトリ規約が禁じる「未公開作品の実タイトル」に該当する
  例示文字列が、UIコンポーネント・スキーマのエラーメッセージ・manual の3系統に現存する
  （**うち2系統はクライアントバンドルにも乗る**）。あわせて、規約上の「インフラ識別子」が
  過去コミットの diff に残存している（現ファイルでは伏せ字化済み）。
- **具体的な該当箇所・該当文字列・該当コミットは、公開リポジトリの文書には記載しない**
  （どの文字列が実タイトルかの対応関係を自ら晒すことになるため。セッション89 で
  公開Issue化を見送ったのと同じ理由）。実体はリポジトリ外で管理し、Step P の作業時に参照する。
- **本監査で判明した差分**: セッション89 の把握分に加え、**新たに1系統が判明**した
  （zod エラーメッセージ経由でクライアントに届く経路）。導入コミットは `git log -S` で
  2件に特定済み。
- **修正方針**: 現ファイルを汎用例へ差し替え。git 履歴は
  「履歴書き換え（filter-repo）／許容して公開／リポジトリ作り直し」の3択をユーザーが決定する。
  リポジトリは本監査時点で **PRIVATE のまま**であり、公開前に処理できる状態にある。

---

## Low

### L-1. `/api/chat` のメッセージ本文にサイズ上限がない

- **状態**: 対応済み（2026-08-12。モデルへ実際に渡る直近20件の合計文字数に
  `CRITIQUE_MAX_CHARS`（30万字）ガードを追加。全件ではなく直近分を数えるのは、
  モデルに渡らない古い履歴が上限を押し上げて長寿スレッドを止めないため。
  なお `textOf` は text パートのみを数えるため、リクエストを偽造して巨大な
  tool-result / data パートを積む経路は塞がらない——本指摘の目的である
  コスト事故の抑止には足りると判断した）
- **該当**: `lib/schemas/chat.ts:24`（`messages: z.array(z.record(z.string(), z.unknown())).min(1).max(100)`）
- **何が問題か**: 件数（100件）と履歴スライス（直近20件）の制限はあるが、各メッセージの本文長は無検証。
  前回監査 L-3 で入れたサイズ上限（ノート10万字・レビュー30万字ガード）が chat の messages だけ及んでいない。
- **攻撃シナリオ**: セッション奪取または本人の暴走スクリプトで1メッセージに数百万字を詰めて送信
  （Vercel のボディ上限 ~4.5MB までは通る）。10回/分の枠内でも1リクエストのトークンコストが
  他ルートのガード上限を大きく超える。悪意というよりコスト事故の経路。
- **修正方針**: `chatRequestSchema` に合計文字数チェック（`CRITIQUE_MAX_CHARS` 流用の30万字）を
  `convertToModelMessages` の前に追加。

### L-2. 企画書本文ほかに文字数上限がない（前回 L-3 の残存ギャップ）

- **状態**: 対応済み（2026-08-12。企画書 content 10万字・purpose 2000字・
  genre / target_audience 各500字・プロジェクトタイトル500字・イベント名200字・
  タグ名500字を追加。**タグ名はプロジェクトタイトルと同値に揃えた**——レビューの
  ノート化がプロジェクトタイトルをそのまま仮タイトルタグ名にするため、非対称にすると
  「作成はできるがノート化だけ必ず失敗するタイトル長」が生まれる）
- **該当**: `lib/schemas/projects.ts` の `proposalInputSchema` の `content`/`purpose`/`genre`/
  `target_audience`、`projectInputSchema` の `title`/`event_name`、
  `lib/schemas/notes.ts` の `tagInputSchema.name`（いずれも修正前は max なし）
- **何が問題か**: ノート10万字・シーン2万字・Zenn20万字と上限が揃えられた中で、
  企画書本文とこれらのフィールドだけ無上限。企画書は自動保存＋`proposal_versions` の
  10分間引きスナップショットで増幅される。
- **攻撃シナリオ**: 数十MBの content を自動保存し DB／転送量が肥大。LLM 側は `/api/review` の
  30万字ガードが健在なためコスト暴走には直結しない。
- **修正方針**: `content` に max（ノートと同じ10万字）、title/event_name/purpose/genre/
  target_audience/タグ名に max 100〜500 を追加。

### L-3. `lib/actions/notes.ts` の id 引数だけ uuid 検証を通していない

- **状態**: 対応済み（2026-08-12。9つの入口（実体は7関数。trashNote / restoreNote は
  setDeletedAt 経由）に `uuidSchema.parse` を追加し他15ファイルと同型に揃えた。
  **ただしエラーコードの正規化までは達成していない**——ZodError も `toActionError` で
  `internal` に落ちるため。`validation` で返したい場合は
  `lib/actions/repo-setup.ts` / `settings.ts` の `safeParse` → `AppError("validation")`
  パターンへの置き換えが別途必要）
- **該当**: `lib/actions/notes.ts` の `updateNote`(88)・`listNoteVersions`(128)・`restoreNoteVersion`(146)・
  `trashNote`/`restoreNote`/`setDeletedAt`(187-215)・`deleteNotePermanently`(218)・`attachTag`/`detachTag`(236-290)
- **何が問題か**: 他15ファイルは全関数で `uuidSchema.parse` しているのに notes.ts だけ欠落。
  PostgREST はパラメータ化されるため注入はなく RLS も効く（実害なし）が、不正な id は
  Postgres の uuid 型エラー → `internal`（固定文言）に化け、`validation`/`not_found` に正規化されない。
- **修正方針**: 各関数冒頭に `uuidSchema.parse` を追加（chat.ts と同型に）。

### L-4. `lib/email.ts` に `import "server-only"` がない

- **状態**: 対応済み（2026-08-12。1行目に `import "server-only"` を追加）
- **該当**: `lib/email.ts:1`（`RESEND_API_KEY` を参照）
- **何が問題か**: 現状の import 元は cron ルートのみで実害はないが、秘密を扱うモジュールで唯一の
  server-only 未ガード。将来クライアントコンポーネントから誤 import してもビルドで弾けない。
  前回監査 L-2（`lib/ai/models.ts`）と同型の指摘。
- **修正方針**: 先頭に `import "server-only";` を1行追加。

### L-5. 承認ゲート列は RLS レイヤーでは保護されていない

- **状態**: 対応しない（単一ユーザー制では受容可能。**複数ユーザー化時に再評価必須**）
- **該当**: `proposals.status`・`scenes.status`・`projects.structure_status`・`review_feedbacks.verdict`
  （`20260712000002_core_schema.sql:89-90`・`20260721000001_structure_scene_review_gate.sql:12-18`・
  `20260713000002_review_gate_and_reviewer_personas.sql:10-11`）
- **何が問題か**: 所有者スコープの `for all` ポリシーは列を区別しないため、本人が自分のJWTで
  PostgREST を直接叩けば AI レビューなしで `status='approved'` を書ける。保護はアプリ層の
  zod 入力除外のみ。
- **なぜ受容できるか**: 本人によるレビューゲートの自己迂回のみで、クロスユーザー被害は構造的に不可能
  （前回監査 L-5 と同一クラス）。列単位の保護にはトリガーまたは専用RPC化が必要。

### L-6. `ai_usage_logs` は authenticated が任意値を直接 INSERT 可能

- **状態**: 対応しない（既知・マイグレーション内に文書化済み）
- **該当**: `20260718000001_ai_usage_logs.sql:24-40`
- **何が問題か**: 表示専用統計のため所有者 insert を許可しており、PostgREST 直叩きで偽の使用量行を積める。
- **なぜ受容できるか**: 自分の統計表示を自分で汚せるだけ。マイグレーションのコメント自体が
  「クォータ制御・課金判断に使う場合は insert を revoke しサーバー専用経路へ」と条件を明記している。
- **再評価トリガー**: **この値をレートリミット・課金・クォータの入力に使う変更が入る際は、
  insert revoke を必須条件とする**（監査としてもこの条件を引き継ぐ）。

---

## 情報（対応不要・記録のみ）

- **`/api/notes/export` の ZIP を全件メモリ上で構築**（`app/api/notes/export/route.ts:63-86`）。
  総量上限がなく関数メモリ超過で 500 になりうる。他人のデータには触れず可用性のみの話で、
  現実的なノート数では許容範囲
- **未使用スキーマの残置**（`lib/schemas/` の `sceneInputSchema`・`templateInputSchema`・
  `manuscriptLinkInputSchema`・`revisionSuggestionInputSchema` ほか8本）。特に
  `revisionSuggestionInputSchema` は将来 Server Action の入口に使うと `committed_sha`
  （コミット済みゲート列）がクライアント入力可能になる形。現状未使用で実害なし
- **GitHub コミット系アクションのレートリミット適用が不均一**。`commitAcceptedSuggestions`・
  `writeBackOnHoldSuggestions`・`writeBackCritique`・`setupManuscriptRepo` には未適用
  （AIコストに直結せず本人PATの範囲内）
- **PAT 有無判定で暗号文カラム全体を select**（`app/(app)/page.tsx:39`・`lib/actions/settings.ts:68`）。
  Server Component / Action 内で完結し boolean のみ返るため現状漏れなし
- **`illustrations.reference_illustration_id` の DB レイヤー所有検証は意図的に撤去済み**
  （`20260717000003` で RLS 再帰回避。API 側の RLS 越し取得で担保する設計がマイグレーションに文書化済み）
- **`lib/rate-limit.ts` のインメモリ固定ウィンドウは Vercel のインスタンス分離で緩くなりうる**
  （コード内コメントで認識済み・単一ユーザー前提の受容判断を維持）
- **`zenn-markdown-html` のサニタイズへの全面依存**（`components/zenn/zenn-preview.tsx:72`）。
  現状は安全（内部で `sanitize-html` の allowlist を最終段に必ず通す）だが、
  メジャー更新や `embedOrigin` 有効化でこの前提は崩れる。依存更新時のレビュー観点として記録
- **コミット Author メタデータに実メールアドレス**。CLAUDE.md 規約の対象は
  「コミット・PR・dev-log の内容」であり identity は射程外と解するが、
  秘匿したい場合は GitHub の noreply アドレスへの切り替えを検討

---

## 依存パッケージ（`npm audit`）

現状 **22件（high 12 / moderate 10）**。前回監査時の2件（next 同梱 postcss のみ）から増えているが、
その大半は前回以降に公開された新規アドバイザリと、新機能で入った依存の推移的なもの。
3群に分けて扱う。

### 群1: `npm audit fix`（非破壊）で解消できる

`undici` / `brace-expansion` / `fast-uri` / `ip-address` / `js-yaml` / `nanoid` / `hono` /
`@hono/node-server` / `trim`（remark-parse 経由）ほか。いずれも推移的依存のパッチ更新で、
package.json の宣言バージョンは変わらない。

### 群2: `next` 16.2.10 → 16.3.0 で解消する

next 本体の high 9件と、同梱の `postcss`・`sharp`。**前回監査 L-4 で「パッチ待ち」として
対応不可だった postcss がこれで解消できる状態になった**。本アプリとの関係が深いものは以下:

- **App Router の Middleware / Proxy バイパス（GHSA-6gpp-xcg3-4w24）**: 本アプリは
  `proxy.ts` を許可リストの**二次**ゲートに使っている。一次ゲートはDBトリガー
  （`check_email_allowlist`・フェイルクローズ）で健在のため多層防御は崩れないが、
  二次ゲートの信頼性に直結するため優先度は高い
- Server Actions の DoS（GHSA-m99w-x7hq-7vfj）・Edge runtime のペイロード無制限
  （GHSA-4c39-4ccg-62r3）: 本アプリは Server Actions を全面利用し `bodySizeLimit: "15mb"` を設定
- Image Optimization API の SVG DoS（GHSA-q8wf-6r8g-63ch）
- カスタムサーバーの SSRF（GHSA-89xv-2m56-2m9x）: カスタムサーバー不使用のため非該当

`eslint-config-next` も同バージョンへ揃える必要がある。

### 群3: 上流待ち（対応不可）

`valibot`（moderate）・`prismjs` / `refractor`（moderate）。いずれも `@vivliostyle/vfm` の
推移的依存で、**`npm audit fix --force` は `@vivliostyle/vfm` を 2.7.2 → 2.6.0 へ
ダウングレードする**提案のため実行してはならない（入稿PDFビルドの中核依存）。
前回の postcss と同じく「上流の追従待ち」として記録し、次回監査で再確認する。

いずれの脆弱性も、ビルド時処理・サーバー内部の HTTP クライアント・Markdown 変換に閉じており、
単一許可ユーザー制の本アプリで直接悪用される経路は確認されていない。

---

## 確認して問題なしと判断した項目（監査証跡）

### Supabase / RLS（マイグレーション29本）

- **RLS 有効化漏れゼロ**: `create table` 全28箇所を機械走査し、public 24テーブルすべてで
  同一マイグレーション内に `enable row level security` を確認（後付けなし）。
  `private.auth_allowlist` のみ RLS なしだが、PostgREST 非公開スキーマ＋schema/table 双方の
  revoke で到達経路なし
- **USING / WITH CHECK 対**: `for all` ポリシー全件で両方を確認（update の WITH CHECK 漏れゼロ）。
  操作別分離の personas / review_profiles / templates も update に両方あり
- **ポリシーを一部しか持たない2テーブル**（chat_messages: s/i のみ、ai_usage_logs: s/i のみ）は
  いずれも不変・追記専用の設計意図がマイグレーション内に明記されており、欠落ではなく全拒否として機能
- **所有権チェーンの一貫性**: 新規テーブルも既存パターンを踏襲。scene_notes は proposal_notes と
  同型の親2系統検証、note_versions / proposal_versions は所有者直付け＋WITH CHECK で
  参照先所有（note / proposal→project）を検証。JOIN 経由で親の所有確認が抜けている箇所なし
- **Storage 2バケット**: いずれも `public=false`・所有者フォルダスコープ
  （`(storage.foldername(name))[1] = auth.uid()::text`）・`to authenticated` 限定・10MB上限・
  MIME allowlist あり。update ポリシーなし（＝上書き不可）は両バケットで意図的
- **関数・トリガー**: security definer は `check_email_allowlist()` の1本のみで
  `set search_path = ''` ＋ execute revoke 済み。`ai_usage_summary()` は **security invoker**
  （実行者のRLSが効く）＋ search_path='' ＋ public/anon から revoke 済み。`create view` は全体で0件
- **anon 遮断の多層防御**: 全ポリシーが `to authenticated` ＋
  `alter default privileges ... revoke all on tables from anon` により、新規テーブルにも自動適用。
  `grant` 文はリポジトリ全体で0件
- **シード行の保護**: CHECK 制約 `(is_default and user_id is null) or (not is_default and user_id is not null)`
  と各ポリシーの組み合わせで、標準行の update/delete 不可・`is_default=true` の INSERT 不可を両立。
  新規シード（イラストレーター・技術書2人・プロファイル4種）も同じ流儀

### Route Handler（12本）＋ proxy

- 全 API ルートで `supabase.auth.getUser()`（検証あり）を使用。`getSession()` を認可判断に使う箇所なし
- `proxy.ts` の matcher は静的アセット以外の全ページ＋ `/api/:path*` を網羅し、
  画像拡張子つき API URL（`/api/attachments/{uuid}.png` 等）も二次ゲートを通過
- 無認証で到達可能なのは `/login`・`/auth/callback`（SPEC-auth §3.3 の例外）と
  `/api/cron/*`（ルート内 Bearer 認証・同§3.3 例外）のみ
- **cron**: `timingSafeEqual` による定数時間比較。長さ不一致時も自己比較で時間を揃える実装。
  `CRON_SECRET` 未設定・ヘッダなしは 401（フェイルクローズ）。service_role は
  `lib/supabase/admin.ts`（server-only）内でのみ参照
- **アセットプロキシ**: attachments はファイル名を `{uuid}.{許可拡張子}` の厳格パターンで検証し
  署名対象パスを自 uid フォルダに固定。editor/asset は拡張子 allowlist（**SVG 除外**）＋
  `nosniff` ＋ `Cache-Control: private`、パスは `..`・先頭 `/`・`\` 拒否＋`joinRepoPath` の
  segment 解決で base_path 配下に閉じ込め、repo は `validRepo()`（前回 L-1 対応）経由で
  SSRF 経路なし。build-asset のリダイレクト先は GitHub API のレスポンス Location のみ
- **認可（IDOR）**: chat / review / proofread / illustration すべてで RLS 越し取得＋0件チェック。
  review は `target_ref` と `project_id` の一致検証、proofread は DB由来 file_path の再検証、
  illustration は保存パスをサーバー採番（`{user.id}/{uuid}.{ext}`）
- **レートリミット**: AI 5ルート＋プロキシ3ルート＋export の計9ルートに適用（適用漏れなし）。
  maxDuration は chat 60 / review 120 / proofread 120 / illustration 60
- 全ルートが `errorResponse()` 経由で `internal` は固定文言に置換、詳細はサーバーログ限定

### Server Action（20ファイル・106関数）

- **全106関数を開いて確認**し、「入力検証 → RLS 越し取得 → 0件更新チェック」を維持。
  破壊系（deleteProject 等）の 0件チェック省略は冪等削除のため許容
- 明示 `getUser()` は「user.id を使う」「Storage 書き込み」「PAT 使用」の箇所に一貫して存在。
  RLS 委任の読み取り系も未認証時は anon でフェイルクローズ（前回監査で確立したパターンと同一）
- **`lib/git/project-context.ts` に認証スキップのパラメータ分岐はない**。認証を行わない関数も
  「渡された supabase クライアント（Cookieスコープ）のRLS」でしか動けない構造で、
  service_role クライアントはコードベースに存在しない。全19呼び出し箇所を確認し、
  API Route 4本はすべて呼び出し前に `getUser()` あり。`server-only` 付与済み
- **除外列**: `user_id` は全スキーマで入力外（DB default `auth.uid()` ＋ WITH CHECK で偽装不可）。
  `is_default` は create/duplicate 系で `false` 強制。`status`/`structure_status` は
  `proposalUpdateSchema` が omit し scenes の upsert ペイロードからも明示除外。
  `committed_sha` はサーバー側でのみ設定し、`updateSuggestionStatus` は
  `.is("committed_sha", null)` を UPDATE 条件に含めて原子化
- **承認ゲート**: `approveProposal` / `approveBoardReview` はセッションの running 状態・
  target_phase 一致・target_ref と project_id の対応・最新 verdict = approved をすべて
  サーバー側で再検証。status を直接書き換えられる別経路なし
- **パス・repo**: `manuscriptFilePathSchema` を入口とDB由来値の両方に適用（6関数）。
  editor 分割後も `validateChapterPath` が open/save/create の全経路に適用され、
  createChapter は合成後にも再検証する多層防御。zenn は slug `[a-z0-9_-]{12,50}` で
  トラバーサル不能、zenn_repo は使用時に `repoSchema` で再検証。
  `writeBackCritique` の `--`→全角無害化で HTML コメント脱出不可
- **Storage 書き込み**: MIME allowlist（バケット設定と同値）・サイズ上限・空ファイル拒否・
  パスはサーバー生成・レートリミットあり。`deleteIllustration` は storage_path を
  クライアントから受け取らない
- **インジェクション**: 生SQLなし（PostgRESTビルダーのみ）。ILIKE は `searchNotesForLink` の
  1箇所のみで `%_` エスケープ＋`,()"\` 除去済み
- サイズ上限の一貫性を確認: ノート10万字/タイトル500字、シーン2万字/200字、章本文1MB、
  Zenn本文20万字、レビュー組み立ての30万字ガード（5箇所で健在）、ペルソナ1万字・
  プロンプト2万字、PR本文5000字、スケジュール（milestone 20件・label 100字）

### 秘密情報

- **GitHub PAT**: `api.github.com` への fetch は `lib/git/github.ts` のみ（grep で他に0件）。
  取得は全経路が `patCredentialProvider` → `project-context.ts` の4関数経由。平文 PAT を扱う
  例外は登録時の `registerGithubPat` のみ（疎通検証後に暗号文のみ保存）。token を返す
  ヘルパー2件はいずれも**非 export の内部関数**で Server Action にならないことを確認。
  PAT 登録フォームに localStorage/sessionStorage への退避なし
- **AIプロバイダキー**: `lib/ai/models.ts` は server-only 付き。設定画面へは
  `keyConfigured`（boolean）のみ。イラスト生成も `resolveImageModel` 経由でキーに直接触れない
- **server-only ガード**: crypto / git 4本 / ai 3本 / supabase-admin / editor-theme /
  rate-limit / writing-target / zenn-frontmatter に付与済み。`'use client'` ファイルからの
  サーバーモジュール import は2件のみで、いずれも `import type`（コンパイル時に消える）
- **NEXT_PUBLIC_**: コード中は `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` の
  2つのみ（公開可の値）。`.env.local.example` と実コードの env 参照は完全一致し、
  秘密系に接頭辞なし。service_role は `lib/supabase/admin.ts`（server-only・cron専用）のみ
- **ログ出力**: `console.*` 全35箇所を確認。トークン・キー・暗号文・Authorization ヘッダを
  出力する箇所なし。`githubFetch` の GET限定1回リトライは catch で何もログせず再試行のみ
- **クライアントへ返る値**: `getGithubConnection` は `connected: boolean` + `username` のみ。
  export された Server Action / API レスポンスに token・暗号文・キーを含む返り値なし
- **git 履歴走査（`11701de..HEAD`・262コミット）**: `sk-ant-` / `sk-` / `ghp_` / `github_pat_` /
  `gho_` / `AIza` / `postgres://` / `re_` / `BEGIN PRIVATE KEY` / JWT（`eyJ...`）のいずれも **0件**。
  `.env` 系で追跡・変更されたのは `.env.local.example`（雛形・値は空）のみで `.env.local` の
  コミットなし。Supabase プロジェクト ref の混入も0件。検出された実値系は M-2 のみ
- **設定ファイル**: `next.config.ts` の Server Action 引数ログ抑止（`logging.serverFunctions: false`）は
  維持。`vercel.json` は cron 定義1件のみ。`.github/workflows/ci.yml` はシークレット未使用・
  `pull_request_target` 不使用

### XSS・出力境界

- **機械走査**: `dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document.write|eval\(|
  new Function|outerHTML|srcdoc|createContextualFragment` を app / components / lib / scripts / proxy.ts に対して
  実行し、**ヒットは `components/zenn/zenn-preview.tsx:72` の1件のみ**。`innerHTML` /
  `document.write` / `eval` / `new Function` / `srcdoc` はゼロ。`iframe` はプレビュー1箇所のみ
- **LLM出力の描画**: チャット・レビュー・講評・校正・ディープダイブはいずれも React
  テキストノード＋`whitespace-pre-wrap`（計18箇所）。Markdown レンダラを導入した画面は新設なし
- **Tiptap（ノート・企画書）**: markdown 投入経路は `elementFromString`（DOMParser）→
  ProseMirror スキーマ変換で、スクリプト非実行・`onerror` 等の属性はスキーマで脱落。
  リンクは `isAllowedUri` のプロトコル allowlist で `javascript:` を遮断し `openOnClick: false`
- **画像・添付**: バケットは非公開、配信は短寿命署名URL（illustrations 3600秒 /
  attachments 600秒、`Cache-Control: no-store`）。**SVG は許可されていない**
  （DB の allowed_mime_types とコード側スキーマが一致）。生成画像も `mediaType` を
  同 allowlist でフェイルクローズ
- **外部リンク**: `target="_blank"` は3箇所ですべて `rel="noreferrer"`。href の出所は
  GitHub API の `html_url` と自前 API パスで `javascript:` が入る組み立て経路なし。
  `window.open` は分離プレビュー1箇所で URL は自前パス固定
- **ウィンドウ間通信**: `postMessage` ではなく **BroadcastChannel**（仕様上同一オリジン限定）。
  `window.addEventListener("message")` の受信ハンドラは全コードベースにゼロ
- **オープンリダイレクト**: `returnTo` 検証は `auth/callback` と `login/page.tsx` の両方で維持。
  エッジケースを実測（`/\evil.com`・`/\t/evil.com`・`/..//evil.com`）し、いずれもホストは
  アプリのままであることを確認
- **CSRF**: 素の form POST は `/logout` のみで POST 限定を維持（GET ハンドラなし）。
  GET の副作用エンドポイントなし。CORS 許可ヘッダの追加は依然ゼロ

---

## 未確認項目（コードベースから検証できないもの）

前回監査の6項目は、いずれも Dashboard 側の作業のため今回も未確認のまま残っている。
Step P（公開化）および Step 4（RUNBOOK）の作業時に消化すること。

1. **本番SupabaseのDB実状態** — マイグレーション29本が全適用済みか、Dashboard から手動作成した
   テーブル・ビュー・Storageバケットがないか。Security Advisor の実行を推奨
2. **Supabase Auth設定** — リダイレクトURL許可リスト、Auth側レート制限設定
3. **Vercelの環境変数実設定** — `NEXT_PUBLIC_` 名での誤登録がないか、Preview/Development への露出範囲
4. **Google OAuthクライアント設定** — 承認済みリダイレクトURIの範囲
5. **プロバイダ側のスペンド上限設定**（前回 M-1 の対策1の実施状況）
6. **auth.users トリガーの本番存在確認** — `check_email_allowlist_before_insert` が実DBにあるか
   （適用漏れがあると一次ゲートが消える）
