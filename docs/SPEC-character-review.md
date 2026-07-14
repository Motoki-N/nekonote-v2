# SPEC-character-review: キャラクターレビュー実行UI

作成日: 2026-07-14（インタビュー駆動で策定）
ステータス: **確定**（2026-07-14 レビュー済み）

## 1. 目的

Sprint 6 残置分その3。標準プロファイル「キャラクターレビュー」（`…1002`・5つの問い・担当編集がデフォルト）はシード済みで設定画面にも表示されるが、実行UIがない。これに起用経路を通し、**標準プロファイル5種すべてが実行可能**な状態にする。

- キャラクター設計（誰が・何を・なぜ・失敗の代償・どう変わるか）を、企画書＋紐づけノート（設定資料）を材料に担当編集がレビューする
- 既存のレビュー実行基盤（対象×プロファイルのセッション並存・反復フィードバック・返答メモ）にそのまま載せる。**新テーブル・マイグレーションなし**

## 2. 決定事項（インタビュー結果）

| 論点 | 決定 |
|---|---|
| 対象単位 | **企画書に紐づく資料一式**（target_ref = 企画書id）。主要キャラクター全体を横断レビューする。プロファイルのプロンプト「渡された資料から主要キャラクター（特に主人公）の設計をレビュー」と整合 |
| 実行UIの置き場所 | **企画書画面に統合**。新規ページなし |
| 入り口の形 | ツールバーに**ボタン2つ（「レビュー」「キャラクター」）・パネルは排他表示**（一方を開くともう一方は閉じる）。共通 ReviewPanel を kind='character' でもう1枚置くだけで、既存コンポーネントの改造なし |
| セッションの型 | **反復フィードバック型**（構成・シーンレビューと同じ）。指摘 → ノート改稿 → 再レビューの running スレッド＋返答メモ |
| AIに渡す資料 | **企画書＋紐づけノート全部**（企画書レビューと同一入力）。世界観ノート等も文脈として渡り、キャラ観点だけプロファイルが絞る。担当編集の reference_scope: all と整合 |
| 企画書ステータスとの関係 | **完全に無関係**。proposals.status に一切触れず（draft→in_review 遷移は企画書レビュー専用のまま）、approved 後も実行可（執筆中のキャラブレ点検にも使える）。判定行・承認フッターなし（verdict は常に null） |
| 紐づけノート0件時 | **実行可・ガードなし**。プロファイル自体が「資料から読み取れること・欠けていることを指摘」する設計なので、資料不足は担当編集が正直に指摘する |

## 3. 画面とUX

### 3.1 企画書画面の入り口（components/projects/proposal-editor.tsx）

- ツールバー右側の「レビュー」ボタンの隣に**「キャラクター」ボタン**を追加（同じ流儀: variant secondary/outline トグル・aria-pressed）
- パネルは排他表示: キャラクターを開くと企画書レビューパネルは閉じる（逆も同様）
- キャラクターレビューパネルは**共通 ReviewPanel を直接使用**（kind='character'・targetId=企画書id）:
  - title「キャラクターレビュー」
  - emptyText: 5つの問いの観点でキャラクター設計を見てもらう旨＋キャラクターノートを企画書に紐づけると材料になる旨の案内
  - showVerdict なし・renderFooter なし（ゲートと無関係）
  - flushSave は企画書レビューと同じものを渡す（企画書本文も資料なので、実行前に編集内容をDBへ確定）
- プロファイル・ペルソナ選択は共通 ReviewPanel の既存挙動のまま（character フェーズのプロファイル一覧・既定は標準 …1002・新規セッション時のみペルソナ変更可）

## 4. データ

**マイグレーションなし。** review_sessions / review_feedbacks の既存スキーマにそのまま載る:

- `review_sessions.target_ref` = 企画書id（proposal レビューと同値だが、**review_profile_id が別なのでセッションは並存**する。既存の「対象×プロファイルごとに running 高々1本」の流儀どおり）
- `review_feedbacks.verdict` = 常に null（構成・シーンレビューと同じ扱い）

## 5. 実装方式

### 5.1 Server Action（lib/actions/review.ts）

- `ReviewTargetKind` / `reviewTargetKindSchema` に `'character'` を追加
- `resolveTarget`: character は proposal と同じ解決（proposals を RLS 越し取得 → project_id。既存 proposal 分岐に相乗り）
- `getReviewPanelBootstrap` / `getOrCreateReviewSession` / `getReviewSessionState` は kind を素通しするだけで無変更（target_phase='character' のプロファイル検証は `resolveProfileForPhase` の既存ロジックがそのまま効く）

### 5.2 `/api/review` の分岐（app/api/review/route.ts）

`phase === 'character'` 分岐を追加:

- 対象の所有確認: proposal 分岐と同じ（proposals を RLS 越し取得＋`project_id === session.project_id` の一致検証）
- コンテキスト組み立て: 企画書＋紐づけノート（ごみ箱除外）＋履歴 = **proposal 分岐と同一**なので、取得・整形部を共通ヘルパーに抽出して両分岐で共用する。入力整形は `buildProposalReviewInput` をそのまま使う（材料が企画書一式である事実は同じ。プロンプトの重複関数は作らない）
- proposal 分岐との差分: `parseVerdict` しない（verdict null で保存）・`proposalIdForStatus` を設定しない（draft→in_review 遷移なし）
- セッションは running のまま反復（構成・シーンと同じ。読み切り確定処理なし）

### 5.3 変更なしの確認事項

- `lib/schemas/review.ts`（reviewRequestSchema）・共通 ReviewPanel・設定画面: 無変更
- 講評（manuscript）・企画書・構成・シーンレビュー: 回帰なし（分岐追加のみ）

## 6. 対象ファイル

| ファイル | 役割 |
|---|---|
| `lib/actions/review.ts` | ReviewTargetKind に character 追加・resolveTarget の proposal 解決に相乗り |
| `app/api/review/route.ts` | phase='character' 分岐（企画書＋紐づけノート取得の共通ヘルパー抽出込み） |
| `components/projects/proposal-editor.tsx` | 「キャラクター」ボタン＋排他表示＋ReviewPanel 設置 |

## 7. スコープ外

- キャラクターノート1枚単位のレビュー（ノート編集画面からの実行。必要になったら別途）
- キャラクタータグによるノート絞り込み（タグ運用に依存させない）
- 実行時のノート選択UI
- 判定・ゲート（キャラクターレビューに合否はない）
- middleware→proxy 移行（Sprint 6 の次項目）

## 8. E2E検証手順（完了条件）

1. **入り口と排他表示**: 企画書画面に「レビュー」「キャラクター」の2ボタン。キャラクターを開くと企画書レビューパネルが閉じる（逆も）
2. **実行**: キャラクターレビュー実行 → 担当編集の口調で5つの問いに沿ったフィードバックがストリーミング表示。DB で review_feedbacks.verdict が null、セッションの target_phase が character であることを確認
3. **反復**: 返答メモを保存 → 再実行 → 「前回指摘の改善確認から始める」文脈が効いている
4. **セッション並存**: 同一企画書で企画書レビュー（running）とキャラクターレビュー（running）が別セッションとして並存（DB確認）
5. **ステータス不変**: draft の企画書でキャラクターレビューを実行しても draft のまま（in_review に遷移しない）。approved の企画書でも実行できる
6. **0件ガードなし**: 紐づけノート0件でも実行でき、資料不足が指摘される
7. **プロファイル・ペルソナ**: character フェーズのプロファイルだけが選択肢に出る（…1002＋複製分）。新規セッション時のみペルソナ変更可
8. **回帰**: 企画書レビュー（判定バッジ・「企画を通す」フッター・draft→in_review）が従来どおり
9. **RLS/認証**: 未認証で弾かれる。他人（架空）の企画書idでは not_found
10. **モバイル375px**: 1〜3 の操作が成立する（パネルのボトムシート表示）

※ resolveTarget の character 分岐（所有確認）と /api/review の対象一致検証は **security-reviewer 必須ゲート**の対象（レビュー基盤の認可境界に触れるため）。
