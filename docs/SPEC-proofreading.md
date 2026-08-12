# SPEC-proofreading: 原稿管理・AI校正（GitHub連携・校正ワークスペース）

作成日: 2026-07-13（インタビュー駆動で策定）
ステータス: **確定**（2026-07-13 レビュー済み）
改訂: 2026-07-14 講評（読者代表・近所の書店員）とプロファイル選択UIを実装（SPEC-dashboard-critique-settings。§7 スコープ外項目の昇格）
改訂: 2026-07-16 校正の**保留提案をコメントで書き戻す**機能を追加（SPEC-vertical-editor-phase4 §3.2）
改訂: 2026-07-25 校正プロファイルを**サーバー側ジャンル解決**に変更（Issue #95・SPEC-genre-profiles §5。`PROOFREADING_PROFILE_ID` の固定UUID直引きを廃止し、`target_phase='proofreading'` の標準行をジャンル優先で1件解決。選択UIは追加していない）
改訂: 2026-07-24 **選択範囲の校正**を追加（Issue #32・SPEC-proofread-selection。§7 スコープ外項目の昇格。長文の自動分割は引き続きスコープ外）
改訂: 2026-08-09 **コミット履歴表示・差分（diff）ビュー**を追加（Issue #31・SPEC-manuscript-history。§7 スコープ外項目の昇格。ブランチ選択は引き続きスコープ外）

## 1. 目的

原稿の実体をGitHubリポジトリに置き、ネコノテは「AIによる差分レビューの場」に徹する（要求仕様 §3.4）。PAT登録（暗号化保存）→ 原稿読み込み → AI校正（構造化提案）→ 受入/拒否/保留 → まとめてコミット → 進捗集計、までの校正フェーズ全体を定義する。

実装は2段階に分割する（実装計画 Sprint 4）:

- **前半（縦通し・本SPECの完了条件）**: PAT登録・`GitCredentialProvider` 抽象化・原稿タブ（ファイル一覧＋読み込み専用ビュー）・AI校正実行・提案カード表示＋保存
- **後半**: 提案の受入/拒否/保留の操作、確定分のまとめてコミット（書き戻し）、writing_progress の文字数集計

前提（決定済み・変更しない）:

- 原稿モノレポ運用。置き場所は `projects.repo`（`owner/repo` 形式）＋ `projects.base_path`（コアスキーマ定義済み）
- 認可は**ユーザー発行の Fine-grained PAT**（対象リポジトリ限定・Contents: Read/Write）。取得部は `GitCredentialProvider` として抽象化し、将来のGitHub App差し替えに備える
- `manuscript_links` / `revision_suggestions` / `writing_progress` はコアスキーマ定義済み。今回のマイグレーションは **user_settings へのPAT暗号化列の追加＋校正プロファイルの出力形式改訂**のみ
- ペルソナ「校正さん」（low帯）とプロファイル「校正・校閲」（target_phase=proofreading）はシード済み

## 2. 決定事項（インタビュー結果・2巡）

| 論点 | 決定 |
|---|---|
| 原稿の入り口 | **自動一覧＋開いたら管理対象**。base_path 配下のファイルツリーをGitHub APIから取得して原稿タブに常時一覧。ファイルを開いた時点で `manuscript_links` を自動作成（登録操作ゼロ。「リポジトリが正」の思想） |
| 校正の実行単位 | **ファイル全文（1ファイル=1実行）**。章単位ファイル運用なら数千〜1万字でモデル入力に収まる。選択範囲・自動分割は必要になってから |
| 校正結果の形式 | **構造化提案カード**。最初から構造化出力（原文抜粋/修正案/理由）で受けて `revision_suggestions` に保存しカード一覧表示。前半は表示まで、受入/拒否ボタンは後半で足すだけにする |
| PAT設定UI | **最小の設定画面 `/settings` を新設**。PAT登録・登録済み表示・差し替え・削除のみ。Sprint 5 の設定画面拡張（モデルマッピング・ペルソナ編集）の受け皿を兼ねる |
| 原稿更新の検知 | **SHA記録＋更新バナー、提案は残す**。校正実行時のファイル最新コミットSHAを `manuscript_links.last_reviewed_commit` に記録。ファイルのHEADが進んでいたら「原稿が更新されています」バナー。提案は破棄せず、後半の適用時に「原文が今の原稿に見つかるか」で適用可否を判定 |
| 再校正時の既存提案 | **pending のみ置き換え**（破棄して新提案に）。保留（on_hold）と処理済み（accepted/rejected）は残す。「保留はコミット後も残る」の要求仕様と整合し、重複提案の洪水も防ぐ |
| 実行中のUI | **提案カードを逐次表示（streamObject）**。確定した提案から順にカードを表示。DB保存は完了時にまとめて（途中切断で半端な保存を残さない） |
| レビューの担い手 | **校正さん固定のみ**。担当編集の原稿校閲・読者代表・書店員の講評は Sprint 5（プロファイル選択UI・講評=文書型の2系統化と一緒に） |

インタビューで聞かずに設計原則で決めた点（レビューで確認）:

- **暗号化方式**: アプリ層 AES-256-GCM。鍵は環境変数 `ENCRYPTION_KEY`（32バイト・base64）で server-only。復号値（PAT平文）は**いかなる形でもクライアントへ返さない**。Supabase Vault は拡張依存が増えるため採らない
- **PAT登録時の疎通検証**: 保存前に GitHub API（`GET /user`）でトークンの有効性を確認してから暗号化保存（失効に使う時まで気づかない事故の防止）。リポジトリへの到達性は原稿タブ側のエラー表示で担保
- **原稿表示はプレーンテキスト**: 読み込み専用ビュー（等幅でない読みやすいフォント・行間）。エディタではないので Tiptap は使わない
- **校正は review_sessions を使わない**: 反復スレッド・返答メモの概念が合わない（構造化提案のライフサイクルは `revision_suggestions.status` が担う）。レビュー履歴はカードの蓄積そのもの
- **校正プロファイルの出力形式改訂**: シード済み prompt_template の「出力形式」節（箇条書き3点セット）は構造化出力と競合するため、マイグレーションで「原文抜粋は原稿から一字一句そのまま引用する」旨の構造化前提の文面に更新する（チェック観点1〜6は維持）
- **granularity は 'sentence' 固定**: 校正さんの機械的チェックは文単位。'scene' は担当編集の校閲（Sprint 5）用に温存

## 3. 画面とUX

### 3.1 設定画面（`/settings`・新設）

- サイドバー等の既存ナビに「設定」導線を追加
- **GitHub連携セクション**のみ:
  - 未登録時: PAT入力フォーム（type=password）＋Fine-grained PAT の発行手順の短い説明（対象リポジトリ限定・Contents: Read/Write）
  - 登録時: `GET /user` で疎通検証 → 成功でGitHubユーザー名を添えて暗号化保存（「@{login} として接続済み」）。失敗時は日本語エラーでフォームに留まる
  - 登録済み時: 接続状態表示＋「差し替え」（再入力）＋「削除」（確認ダイアログ）。**登録済みPATの値は表示しない**（マスク表示もしない。存在と接続先ユーザー名のみ）

### 3.2 原稿タブ（`/projects/[id]/manuscript`・新設）

- 既存タブナビ（企画書 | ビートボード）に「原稿」を追加（`app/(app)/projects/[id]/layout.tsx`）
- **前提チェックの誘導表示**（フェイルソフト）:
  - PAT未登録 → 「設定でGitHub PATを登録してください」＋ `/settings` への導線
  - `projects.repo` 未設定 → 「プロジェクト設定でリポジトリを指定してください」＋プロジェクト編集ダイアログへの導線（repo / base_path 欄は既存フォームに追加）
- **ファイル一覧**: デフォルトブランチのツリーから base_path 配下の `.md` / `.txt` をパス昇順で一覧（Git Trees API・recursive）。デスクトップ=左カラム、スマホ=リスト→本文へ遷移
- **原稿ビュー**: ファイルを開くと本文をプレーンテキスト表示（読み込み専用）。開いた時点で `manuscript_links` を自動作成（既存ならそのまま）。文字数を添える
- **更新バナー**: そのファイルの最新コミットSHA ≠ `last_reviewed_commit` のとき「前回の校正以降に原稿が更新されています」を表示（未校正のファイルでは出さない）
- GitHub APIのエラー（PAT失効・リポジトリ不達・404）は AppError 正規化で日本語表示。ツリー取得失敗時も画面は落とさない

### 3.3 校正の実行と提案カード

- 原稿ビューのヘッダーに「校正を受ける」ボタン → 校正パネル（デスクトップ=右サイドパネル、スマホ=ボトムシート。レビューパネルと同型のレイアウト言語）
- 実行時は**その時点の最新原稿を取得して**校正（画面表示が古くても最新で実行し、表示も更新）
- **streamObject による逐次表示**: 確定した提案から順にカードを表示。実行中はstopボタン・多重実行抑止（既存レビューパネルと同じ作法）
- **提案カード**: 原文抜粋 / 修正案 / 理由 ＋ statusバッジ。前半は pending 表示のみ（受入/拒否/保留ボタンは後半で追加）
- 完了時にサーバー側でまとめて保存: 既存 pending を削除 → 新提案を一括 insert → `last_reviewed_commit` をそのファイルの最新コミットSHAに更新。on_hold / accepted / rejected は残して一覧に併記
- 提案0件なら「指摘事項はありません」を表示
- エラー（GOOGLEキー未設定・PAT失効等）は日本語メッセージをパネル内表示

### 3.4 Sprint 4後半のUX（方針のみ・実装は後半セッション）

- 提案カードに 受入 / 拒否 / 保留 ボタン。受入時は「原文抜粋が現在の原稿に一意に見つかるか」を判定し、見つからない提案は「適用不能」表示（原稿更新で陳腐化した提案の安全弁）
- 「確定分をコミット」: accepted の提案をまとめて適用し**1コミット**で書き戻し（Contents API・ネコノテからの書き込みはこの操作のみ）。コミット後 `committed_sha` を記録。保留はコミット後も残り、後から受入/拒否できる
- 原稿読み込み時に `writing_progress` へ当日の総文字数を upsert（進捗の可視化はダッシュボード=Sprint 5）

### 3.5 校正のプロンプトとコンテキスト

- system = 校正さんペルソナ `description` ＋「校正・校閲」プロファイル `prompt_template`（§2の改訂後文面）
- user 入力 = 原稿ファイル全文のみ（校正さんの reference_scope は「原稿テキストのみ」。企画書・ノート・シーンは渡さない）
- 出力 = 構造化提案の配列（スキーマ: `original_text` / `suggested_text` / `reason`）。原文抜粋は原稿からの完全一致引用をプロンプトで強制（後半の置換適用のアンカーになる）

## 4. データ

マイグレーション1本（`user_settings` への列追加＋プロファイル文面更新）:

- `user_settings.github_pat_ciphertext text`（null可）: AES-256-GCM の iv + authTag + 暗号文を連結して base64 で格納。**平文・ハッシュ・末尾4桁等の派生値は一切保存しない**
- `user_settings.github_username text`（null可）: 疎通検証時の `GET /user` の login。表示用
- 「校正・校閲」プロファイル（固定UUID …1005）の `prompt_template` の出力形式節を構造化出力前提に update
- RLS は既存の user_settings ポリシー（本人のみ）を踏襲。ciphertext は本人にSELECTされうるが、`ENCRYPTION_KEY` なしでは復号不能（アプリからクライアントへ返すAPIは作らない）

既存スキーマの運用セマンティクスの確定:

- `projects.repo`: `owner/repo` 形式のテキスト。`base_path`: リポジトリ内サブフォルダ（空=ルート）。プロジェクト編集フォームに入力欄を追加（Zodで形式検証）
- `manuscript_links`: (project_id, file_path) で一意（定義済み）。**ファイルを開いた時点で自動作成**。`last_reviewed_commit` = 最後に校正を実行した時点の**そのファイルの最新コミットSHA**（リポジトリHEADではなくファイル単位。モノレポで他作品のコミットに反応させない）
- `revision_suggestions`: granularity='sentence' 固定。再校正時は該当リンクの pending を削除して新提案で置き換え（on_hold / accepted / rejected は残す）
- `writing_progress`: 後半で使用（前半は書き込まない）

## 5. 実装方式

- **暗号化**（`lib/crypto.ts` 新設）: Node標準 `crypto` の AES-256-GCM。`ENCRYPTION_KEY`（32バイト・base64）は .env.local ＋ Vercel 本番に登録（`openssl rand -base64 32` で生成。値は画面・ログに出さない運用）。server-only モジュールとして import 制限
- **`GitCredentialProvider`**（`lib/git/credentials.ts` 新設）: `getCredential(supabase): Promise<{ token: string; username: string } | null>` のインターフェース。実装は `PatCredentialProvider`（user_settings から復号）。将来 GitHub App 実装に差し替え可能な形にする（インターフェース分離のみ。DIコンテナ等は作らない）
- **GitHubクライアント**（`lib/git/github.ts` 新設）: fetch 直叩きの薄いラッパー（octokit は入れない）。`getTree`（Trees API recursive・base_path＋拡張子フィルタ）/ `getFileContent`（Contents API・base64復号・1MB上限はAPI制約のまま）/ `getLatestCommitSha`（Commits API `?path=&per_page=1`）。エラーは AppError に正規化（401/403=PAT無効、404=リポジトリ/ファイル不達）
- **Server Actions**（`lib/actions/settings.ts` / `lib/actions/manuscripts.ts` 新設): PAT登録（疎通検証→暗号化保存）・削除／原稿ツリー取得・ファイル読み込み（manuscript_links 自動作成込み）。Zod＋AppError の既存パターン（`{ok, error}` 戻り値）
- **API**: `POST /api/proofread` 新設（`/api/review` とは別ルート。文書ストリームと構造化ストリームで型が違う）。認証→ manuscript_link のRLS越し所有確認→最新原稿取得→ `resolveModel(supabase, 'low')` → `streamObject`（output: 'array'、element = 提案Zodスキーマ）→ onFinish で pending 置き換え保存＋ last_reviewed_commit 更新。クライアントは `@ai-sdk/react` の `useObject` で逐次描画
- **low帯モデルの前提**: デフォルトは google `gemini-3.1-flash-lite` だが **`GOOGLE_GENERATIVE_AI_API_KEY` が未登録**。実装セッション冒頭でユーザーがキー登録（.env.local＋Vercel）するか、`ai_model_settings` に low→anthropic（claude-haiku-4-5）の行を入れて差し替えるかを決める（キー確認は `grep -c` のみの運用を維持）
- **縮退計画**（実装計画の判断ルール準拠）: GitHub読み込み（認可・ツリー・取得）が詰まったら、原稿の手動貼り付け（textarea→校正実行）を暫定の入り口として先に通し、GitHub連携は後半へ回す
- 色はテーマ用CSS変数のみ（バナー・statusバッジ含む）

## 6. 対象ファイル

| ファイル | 役割 |
|---|---|
| `supabase/migrations/20260713000003_github_pat_and_proofreading.sql` | user_settings 列追加＋校正プロファイル文面更新 |
| `app/(app)/settings/page.tsx` | 設定画面（GitHub連携セクション） |
| `app/(app)/projects/[id]/manuscript/page.tsx` | 原稿タブ（ファイル一覧・原稿ビュー・校正パネル） |
| `app/(app)/projects/[id]/layout.tsx` | タブに「原稿」追加 |
| `app/api/proofread/route.ts` | AI校正（streamObject・保存） |
| `components/manuscript/*` | ファイル一覧・原稿ビュー・更新バナー・校正パネル・提案カード |
| `components/settings/*` | PAT登録フォーム・接続状態表示 |
| `lib/crypto.ts` | AES-256-GCM 暗号化/復号（server-only） |
| `lib/git/credentials.ts` | `GitCredentialProvider` 抽象化＋PAT実装 |
| `lib/git/github.ts` | GitHub API薄ラッパー（ツリー・取得・コミットSHA） |
| `lib/actions/settings.ts` | PAT登録（疎通検証込み）・削除 |
| `lib/actions/manuscripts.ts` | ツリー取得・ファイル読み込み（リンク自動作成） |
| `lib/schemas/manuscript.ts` ほか | 入力Zod（repo形式・提案スキーマ） |
| `lib/actions/projects.ts`（既存） | repo / base_path の編集対応 |

## 7. スコープ外

- 提案の受入/拒否/保留の操作・まとめてコミット・writing_progress 集計（**Sprint 4後半**。§3.4の方針に従う）
- ~~担当編集の原稿校閲・読者代表/書店員の講評・プロファイル選択UI（Sprint 5）~~ → **実装済み**（SPEC-dashboard-critique-settings・2026-07-14）
- GitHub App / OAuth 連携（`GitCredentialProvider` の差し替えで将来対応）
- ブランチ選択（**デフォルトブランチ固定のまま**。縦書きエディタ側のブランチ対応＝phase5 とは独立。理由は SPEC-vertical-editor-phase5 §9）／~~コミット履歴表示・差分（diff）ビュー~~ → **実装済み**（SPEC-manuscript-history・2026-08-09）
- ~~選択範囲の校正~~ → **実装済み**（SPEC-proofread-selection・2026-07-24）／長文の自動分割は引き続きスコープ外
- 原稿のアプリ内編集（読み込み専用を堅持）
- 1MB超ファイル対応（Contents API 制約のまま。エラー表示のみ）

## 8. E2E検証手順（前半の完了条件）

検証用の原稿リポジトリ（モノレポ形・`.md` 数ファイル・誤字/表記揺れ入りダミー原稿）と Fine-grained PAT はユーザーが準備する。

1. **PAT登録**: `/settings` で登録→疎通検証→「@{login} として接続済み」。無効なトークンは日本語エラーで保存されない。DB直接確認で平文が存在しない（ciphertext のみ）こと
2. **誘導表示**: PAT未登録・repo未設定それぞれで原稿タブが誘導を出す（落ちない）
3. **原稿読み込み**: repo / base_path 設定→ファイル一覧（base_path 配下の .md/.txt のみ）→開いて本文表示→ `manuscript_links` 自動作成をDB確認
4. **AI校正**: 実行→提案カードが逐次表示→完了後 `revision_suggestions`（pending・sentence）と `last_reviewed_commit`（そのファイルの最新SHA）をDB確認。仕込んだ誤字・表記揺れが検出される
5. **再校正**: 一部提案を on_hold にDB更新→再実行→ pending は置き換わり on_hold は残る
6. **更新バナー**: 校正後にリポジトリへ新コミット（ユーザー操作）→原稿タブで更新バナー表示、既存提案は残存。**モノレポ内の別フォルダへのコミットではバナーが出ない**（ファイル単位SHA）
7. **PAT削除・失効**: 削除→原稿タブが誘導表示に戻る。失効/権限不足のPATでは日本語エラー
8. **キー未設定エラー**: low帯プロバイダのAPIキーを外すと日本語エラーがパネルに出て落ちない
9. **モバイル**: 375px でファイル一覧→本文→校正パネル（ボトムシート）が成立
10. **RLS**: anon キーの REST SELECT で user_settings / manuscript_links / revision_suggestions が拒否される
11. **回帰**: 企画書・ビートボードタブの既存機能が壊れていない（タブ追加のみの確認）

※ マイグレーション（PAT列）・暗号化・PAT取り扱い・`/api/proofread` は **security-reviewer 必須ゲート**の対象（認証・秘密情報の双方に該当）。
