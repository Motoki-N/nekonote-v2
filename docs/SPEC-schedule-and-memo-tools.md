# SPEC-schedule-and-memo-tools: 構造化スケジュール保存・メモの自動ノート化

作成日: 2026-07-14（インタビュー駆動で策定）
ステータス: **確定**（2026-07-14 レビュー済み）

## 1. 目的

Sprint 6 その2。SPEC-conversational-personas §7 で残置した2機能を、AIの**ツール呼び出し**で実現する:

- **構造化スケジュール保存**: アシスタントのスケジュール提案を「読み捨てのチャット」から「データ」へ。確定した提案をプロジェクトに保持し、ダッシュボードの概況カードに表示する（要求仕様 §3.2「AIが執筆スケジュールを提案・**管理**する」の「管理」の実装）
- **メモの自動ノート化**: マスター（およびアシスタント）に「メモにまとめて保存して」と頼むと、手動ボタンを経ずにそのままノートが作られる（手帳への自動合流）

AI基盤は `/api/chat` の dashboard 分岐（SPEC-conversational-personas §5.2）を拡張する。AI SDK v7 の `tools` を本アプリで初めて使う。

## 2. 決定事項（インタビュー結果・2巡）

| 論点 | 決定 |
|---|---|
| データの形 | **マイルストーン列＋日次ペース目標の両方**（「7/20までに第1章 8,000字」のリスト＋1日あたり文字数目標） |
| 保存の経路 | **AIツール呼び出し**。会話中に「これで確定して」と言うとアシスタントがツールで構造化保存。フォーム手動入力は作らない |
| 表示場所 | **既存のプロジェクト概況カードに統合**。独立カード・独立ページは作らない |
| メモ自動化のトリガー | **AIツール呼び出し**。「メモにまとめて（保存して）」でAIがノートを作成し、チャット内に保存済みリンクを出す |
| 上書き方針 | **1プロジェクト1本・上書き**。世代管理なし（過去の提案はチャット履歴に残る） |
| 達成判定 | **併用**。マイルストーンに任意の目標総文字数を持たせ、あれば writing_progress の最新値と比較して自動判定、なければ手動チェック |
| 確認フロー | **無確認で即保存**。「確定して」の発話自体が同意。チャット内に保存結果カード（リンク付き）を出す。誤保存はカード側・ノート側の削除で救済 |
| ツールの範囲 | **ノート化ツールは両ペルソナ**（マスター・アシスタント）。既存の手動「ノートに保存」ボタンは全応答に**存続** |

## 3. インタビューで聞かずに設計原則で決めた点（レビューで確認）

- **新テーブルは作らず `projects.schedule` jsonb 1列**（マイグレーション1本）。手帳→浄書の判断基準（画面とAIが確実に構造参照するデータのみ構造化・システム管理の構造は最小）に従い、「1プロジェクト1本・丸ごと上書き」のデータをテーブルに分解しない。RLS・cascade は projects のものがそのまま効く
- **ツールの登録は dashboard 分岐のみ**。掘り下げ（note）スレッドは従来どおりツールなし＝回帰ゼロ
- `saveSchedule` ツールは**アシスタント×プロジェクト選択時のみ登録**（「指定なし」やマスターのタブでは保存できない。モデルからツール自体が見えない）
- **マイルストーン id はサーバー採番**（`crypto.randomUUID()`）・上書き保存時に done は**リセット**（新しいスケジュールとして仕切り直し）
- **保存済みスケジュールをスケジュールコンテキストに同梱**（アシスタントが現行スケジュールを踏まえて改訂提案・進捗確認できる）
- **ツール結果カードはセッション内表示のみ**。chat_messages はテキストのみ保持の現行スキーマを変えない（リロード後はカードが消えるが、実体はノート／概況カードに残っている。プロンプトで「保存後は必ず短い締めの文を返す」ことを指示し、履歴上も保存の事実が残るようにする）
- 達成表示 = `done（手動チェック） ||（targetChars あり && 最新総文字数 >= targetChars）`。チェックボックス操作が切り替えるのは done のみ
- スケジュールの削除は概況カードから（確認ダイアログ）。チャットからの削除ツールは作らない

## 4. データ

### 4.1 マイグレーション（1本のみ・プランモード承認）

```sql
-- アシスタントが確定保存する執筆スケジュール（1プロジェクト1本・丸ごと上書き）。
-- 構造の検証は zod（lib/schemas/schedule.ts）で行い、DB側は器のみ持つ
alter table public.projects add column schedule jsonb;
```

### 4.2 schedule の形（zod で検証）

```ts
// lib/schemas/schedule.ts
{
  dailyTargetChars: number | null,   // 1日あたり文字数目標（正の整数・任意）
  milestones: [                      // 期日昇順・最大20件
    {
      id: string,                    // サーバー採番 uuid
      label: string,                 // 1〜100字（「第1章まで」等の定性目標も可）
      dueDate: 'YYYY-MM-DD',
      targetChars: number | null,    // 目標総文字数（正の整数・任意。あれば自動判定）
      done: boolean,                 // 手動チェック（保存時は false 初期化）
    },
  ],
  savedAt: string,                   // ISO 日時（ツール実行時にサーバーで付与）
}
```

## 5. 実装方式

### 5.1 `/api/chat` dashboard 分岐へのツール登録

`streamText` に `tools` と `stopWhen: stepCountIs(3)` を追加（ツール実行後に締めのテキストを続けて生成させる）。ツールの `execute` は RLS 越しの supabase クライアントをクロージャで掴む＝所有確認は RLS が担う:

- **`saveSchedule`**（アシスタント かつ `context.projectId` あり のときだけ登録）
  - inputSchema: `dailyTargetChars` / `milestones[]`（label・dueDate・targetChars。id と done は受け取らない）
  - execute: サーバーで id 採番・done=false・savedAt 付与 → zod 検証 → `projects.schedule` を UPDATE（`eq id projectId`・RLS）→ `{ ok: true, milestoneCount }` を返す
- **`saveMemoNote`**（dashboard 分岐なら両ペルソナで登録）
  - inputSchema: `content`（メモ本文 Markdown・1〜10,000字）
  - execute: `title = chatTitleFrom(content)` → notes に insert（RLS）→ `{ noteId, title }` を返す
  - 既存 `saveChatMessageAsNote`（messageId 方式・手動ボタン）はそのまま併存。こちらは「AIが整形したメモ」を保存する別経路

システムプロンプト（`buildDashboardChatPrompt` 拡張）:

- 共通: 「作者が保存・確定・メモ化を**明確に頼んだときだけ**ツールを使う。勝手に保存しない。保存後は必ず短い締めの文で保存内容を要約して返す」
- アシスタント（スケジュールコンテキストあり）: 「スケジュール提案はマイルストーン（期日・目標）と1日あたり文字数で具体的に示し、作者が確定を求めたら saveSchedule で保存する」＋保存済みスケジュールのブロック（あれば）を進捗データに続けて同梱
- `saveSchedule` が未登録の状況（プロジェクト指定なし・マスター）はツールが見えないだけなので、特別なプロンプト分岐は作らない

### 5.2 相談パネル（ツール結果カード）

`components/dashboard/consult-panel.tsx` のメッセージ描画で tool part を判定し、テキストとは別のカードで表示:

- `saveSchedule` 完了: 「スケジュールを保存しました（マイルストーンN件）」＋ダッシュボード概況カードへの誘導（パネルを閉じれば見える位置なのでリンクは不要）
- `saveMemoNote` 完了: 「ノートに保存しました」＋作成ノートへのリンク（`/notes/<id>`。手動保存ボタンの「保存済み」表示と同じ流儀）
- 実行中（input-streaming / 実行待ち）はスピナー付きプレースホルダ、エラーはパネル内の既存エラーメッセージ流儀
- リロード後は表示されない（§3 の決定どおり）

### 5.3 概況カードのスケジュールブロック

`project-overview-card.tsx` に、schedule があるときだけ出すブロックを追加:

- 日次目標行: 「1日あたり目標 N字」＋直近7日実ペース（既存 series から算出できる範囲）の並記
- マイルストーン一覧（期日昇順・全件表示。一人利用で最大20件）: チェックボックス＋label＋期日（あとN日／超過。既存 `DeadlineCountdown` の流儀）＋targetChars があれば「残りM字」or 達成表示
- 達成 = done または 文字数達成（§3）。チェックボックス操作は Server Action `toggleMilestone` で done をトグル
- ブロック右上に削除（ゴミ箱アイコン→AlertDialog 確認→ `deleteSchedule`）
- 色はテーマ用CSS変数のみ

### 5.4 Server Actions（`lib/actions/schedule.ts` 新設）

- `toggleMilestone(projectId, milestoneId, done)`: RLS 越しに schedule を取得→zod 検証→該当 id の done を書き換えて UPDATE。見つからなければ not_found
- `deleteSchedule(projectId)`: `schedule = null` に UPDATE（`.select('id')` 0件→not_found の流儀）

### 5.5 スケジュールコンテキストの拡張

`buildScheduleContext` が `projects.schedule` も select し、`ScheduleContext` に保存済みスケジュール（マイルストーンの達成状況込み）を追加。プロンプトの進捗データブロックに「# 保存済みの執筆スケジュール」として整形出力（なければ「（未保存）」）

## 6. 対象ファイル

| ファイル | 役割 |
|---|---|
| `supabase/migrations/XXXX_project_schedule.sql` | `projects.schedule` jsonb 追加（プランモード承認後） |
| `lib/schemas/schedule.ts` | schedule / ツール入力の zod スキーマと型 |
| `lib/ai/prompts.ts` | ツール使用指示＋保存済みスケジュールブロック |
| `app/api/chat/route.ts` | dashboard 分岐に tools（saveSchedule / saveMemoNote）＋stopWhen |
| `lib/actions/schedule.ts` | `toggleMilestone` / `deleteSchedule` |
| `components/dashboard/consult-panel.tsx` | tool part のカード表示 |
| `components/dashboard/project-overview-card.tsx` | スケジュールブロック（一覧・チェック・削除） |
| `app/page.tsx` | projects の select に schedule を追加して受け渡し |

## 7. スコープ外

- スケジュールの手動編集フォーム（修正は「アシスタントに再提案→確定」で上書き）
- 世代管理・提案履歴の比較 UI
- 掘り下げ（note）スレッドへのツール導入
- マイルストーンの通知・リマインド
- 日次目標の自動再計算（進捗との乖離はアシスタントに相談して再確定する運用）
- メモノート化時の自動タグ付け（後からノート側で整理＝手帳→浄書の思想どおり）
- ツール結果カードの永続化（chat_messages のスキーマ変更）

## 8. E2E検証手順（完了条件）

1. **スケジュール提案→確定**: アシスタントにプロジェクトを選んでペース相談→提案→「これで確定して」→保存カードが出て、締めの文で内容が要約される
2. **概況カード反映**: ダッシュボードの該当プロジェクトカードにマイルストーン一覧・日次目標が現れる（DB で `projects.schedule` を確認）
3. **上書き**: もう一度別の内容で確定→カードが新内容に置き換わる（世代は増えない・done リセット）
4. **手動チェック**: 概況カードのチェックボックスで達成マーク→リロードしても保持
5. **自動達成**: targetChars が最新総文字数以下のマイルストーンが自動で達成表示になる
6. **スケジュール削除**: 概況カードから削除（確認ダイアログ）→ブロックが消える・DB で null
7. **メモの自動ノート化（マスター）**: 壁打ち→「メモにまとめて保存して」→ノート作成カード＋リンク→ /notes に新規ノート（title=1行目50字）
8. **アシスタントのメモ化**: アシスタントのタブでも「今の話をメモに保存して」でノートが作られる
9. **勝手に保存しない**: 保存を頼んでいない通常の相談ではツールが呼ばれない（提案だけで終わる）
10. **保存不可の状況**: プロジェクト「指定なし」で「スケジュールを確定して」→保存されず、AIがプロジェクト指定を促す返答をする（マスターのタブでも保存されない）
11. **手動ボタン回帰**: 既存の「ノートに保存」ボタンが全応答で従来どおり動く（掘り下げパネル含む）
12. **掘り下げ回帰**: note スレッドではツールが一切動かない（従来どおりの応答）
13. **RLS/認証**: 未認証で Server Actions が弾かれる。他人の projectId ではスケジュールが保存されない（not_found／0件更新）
14. **モバイル375px**: 概況カードのスケジュールブロック・チェック・削除、パネルのツールカードが成立する

※ マイグレーション・ツールの execute（RLS 経由の書き込み・zod 検証・プロンプトインジェクション耐性=ツールは本人のデータにしか書けないことの確認）・`toggleMilestone` / `deleteSchedule` の所有境界は **security-reviewer 必須ゲート**の対象。
