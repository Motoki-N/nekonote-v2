# SPEC-chat-thread-list: スレッド一覧UI（ダッシュボード相談の複数スレッド化）

作成日: 2026-07-14（インタビュー駆動で策定）
ステータス: **確定**（2026-07-14 レビュー済み）

## 1. 目的

Sprint 6 残置分その1。SPEC-conversational-personas §7 でスコープ外に残置した「スレッド一覧・複数スレッド」を実装する:

- ダッシュボード相談（アシスタント・喫茶店のマスター）のスレッドを**ペルソナごとに複数**持てるようにする
- スレッドの一覧・リネーム・削除を行う **/chats ページ**を新設する
- SPEC-conversational-personas §4.1 の予告（「将来スレッド一覧型に拡張する場合はこのインデックスを外す」）を実行する

会話の場は従来どおり相談パネル1箇所（ダッシュボード組み込みの決定は変えない）。掘り下げチャット（ノート紐づけ）は**従来どおりノートごとに1本のまま**変更しない。

## 2. 決定事項（インタビュー結果）

| 論点 | 決定 |
|---|---|
| 対象範囲 | **ダッシュボード相談のみ複数スレッド化**。掘り下げ（note_id 非null）は1ノート1本を維持し、/chats 一覧にも載せない |
| 画面形態 | 会話は従来どおり相談パネル。**一覧・リネーム・削除だけ /chats ページ**に置く（パネル内に一覧ビューは作らない） |
| タイトル | **自動（スレッド先頭の user 発言からAI生成・低コストモデル・最大50字）＋一覧からリネーム可**。生成失敗時は先頭行の機械的整形にフォールバック（Issue #44 で AI生成に変更。当初決定は「AI生成はしない」だった） |
| 「会話をリセット」 | **「新しい会話」に置き換え**。旧スレッドは履歴として残り、削除は一覧から個別に行う |
| パネルの初期表示 | ペルソナごとに**最後に更新したスレッドを継続**（前回の続きから再開。現行の使い勝手を維持） |
| 一覧からの導線 | 行クリックで**ダッシュボードへ遷移→相談パネルが該当スレッドを開いた状態で自動オープン**（URLクエリで指定） |
| 削除の流儀 | **確認ダイアログ→完全削除**（ごみ箱なし。残したい内容は「ノートに保存」で救済済みという整理） |

## 3. 画面とUX

### 3.1 相談パネルの変更（components/dashboard/consult-panel.tsx）

- タブごとの初期ロードを「get-or-create」から「**最新スレッドの取得のみ**」に変更（なければ未作成の新規会話状態）
- 「会話をリセット」ボタンを廃止し、**「新しい会話」ボタン**に置き換え:
  - 押すとそのタブが空の新規会話状態になる（**DB行は作らない**。スレッドは最初の送信時に作成＝空スレッドを溜めない）
  - 確認ダイアログ不要（何も消えないため）
- パネルヘッダーに**「履歴」リンク**（→ /chats）。グローバルナビには追加しない（相談機能はダッシュボード起点の思想を維持）
- URLクエリ `/?consult=<threadId>` 付きでダッシュボードが開かれたら、パネルを自動オープンし該当スレッドを表示。担当ペルソナのタブをアクティブにする。見つからない（他人のid等）場合はパネル内に not_found エラー表示

### 3.2 /chats スレッド一覧ページ（新設）

- 自分のダッシュボード相談スレッド（note_id null）を**更新日時の降順**で一覧表示
- 行の表示: ペルソナ名バッジ・タイトル（null は「無題の会話」）・更新日時
- 行クリック → `/?consult=<threadId>` へ遷移（§3.1 の自動オープン）
- 行メニュー（ドロップダウン）:
  - **リネーム**: ダイアログで入力（1〜100字・trim）
  - **削除**: 確認ダイアログ → 完全削除（cascade でメッセージも消える）
- 空状態: 「まだ会話がありません」＋ダッシュボードへの導線
- 検索・絞り込み・ページネーションは付けない（§7）。色はテーマ用CSS変数のみ

## 4. データ

### 4.1 マイグレーション（1本のみ・プランモード承認）

```sql
-- SPEC-conversational-personas §4.1 の予告どおり「ペルソナごと1本」の保証を外す
drop index public.chat_threads_user_persona_dashboard_uniq;

-- スレッドタイトル（null = 無題。最初の user 発言から自動設定）
alter table public.chat_threads add column title text;
```

- 既存スレッド（現行のペルソナごと1本）の title は、マイグレーション内で**最初の user メッセージの1行目からバックフィル**する（先頭のMarkdown記号除去・50字。note_id null のスレッドのみ対象）
- 掘り下げ用の `chat_threads_user_note_uniq`（1ノート1本の保証）には触らない
- 一覧の並び替えは既存の `chat_threads_user_id_idx` ＋ updated_at で足りる想定（一人利用の件数規模。専用インデックスは追加しない）

### 4.2 updated_at の扱い（設計判断）

現状、メッセージ保存はスレッド行を更新しないため `updated_at` が「最終更新」を表さない。`/api/chat` の onEnd（履歴保存）で**スレッド行を UPDATE して updated_at をバンプ**する（§5.2）。「最後に更新したスレッドを継続」「一覧の更新日時降順」の両方がこれに載る。

## 5. 実装方式

### 5.1 Server Actions（lib/actions/chat.ts）

- `getLatestDashboardThread(personaId)`: **getOrCreateDashboardThread を置き換え**。conversational 型のサーバー再検証は現行どおり。note_id null・persona_id の最新（updated_at 降順1件）＋履歴を返す。**なければ作らない**（threadId null を返し、パネルは新規会話状態に）
- `createDashboardThread(personaId)`: 初回送信時にクライアントが呼ぶ新規作成。conversational 再検証は同じ。ユニークインデックス撤去後なので 23505 の取り直しは不要になる
- `getDashboardThreadById(threadId)`: `/?consult=` 導線用。RLS 越し取得（0件→not_found）＋ **note_id null を検証**（掘り下げスレッドを相談パネルで開かせない）。persona_id と履歴を返し、パネルがタブを合わせる
- `listConsultThreads()`: note_id null の自スレッド一覧（id・title・persona名・updated_at。personas を join）
- `renameThread(threadId, title)`: zod（trim 1〜100字）→ RLS 越し UPDATE（0件→not_found）
- `deleteThread(threadId)`: 既存 `resetThread` を改名して流用（実体は同じスレッド削除。確認ダイアログはUI側）

### 5.2 `/api/chat` の拡張（最小）

リクエスト形態・コンテキスト組み立ては**変更なし**。onEnd の履歴保存に1クエリ追加:

```
update chat_threads set title = coalesce(title, <今回の user 発言からAI生成したタイトル>) where id = threadId
```

- title 未設定（null）のスレッドだけ自動設定される＝新規スレッドでは先頭発言がタイトルになる。リネーム済み・設定済みは coalesce で上書きされない
- UPDATE 自体が set_updated_at トリガーを発火させ、**毎回の保存で updated_at がバンプ**される（§4.2）
- タイトル生成は `lib/ai/chat-title.ts`（`generateChatThreadTitle`）。capability 'low' のモデルで生成し、失敗時のみ `chatTitleFrom` の1行目整形にフォールバック（サーバー側で本文から生成＝クライアント注入不可。Issue #44）
- 履歴保存の失敗で応答を壊さない方針は現行どおり

### 5.3 UI

- `components/dashboard/consult-panel.tsx`: §3.1 の変更（最新スレッド取得・新しい会話・履歴リンク・`initialThreadId` prop）
- `app/page.tsx`: searchParams から `consult` を読んで ConsultPanel に渡す（サーバーコンポーネントのまま。スレッド取得はクライアント側の Server Action 呼び出しに任せる）
- `app/chats/page.tsx`: 一覧（サーバーコンポーネントで取得）＋クライアントの行メニュー（リネーム・削除ダイアログ）

## 6. 対象ファイル

| ファイル | 役割 |
|---|---|
| `supabase/migrations/XXXX_chat_thread_list.sql` | インデックス撤去＋title列追加＋バックフィル（プランモード承認後） |
| `lib/actions/chat.ts` | getLatestDashboardThread / createDashboardThread / getDashboardThreadById / listConsultThreads / renameThread / deleteThread（resetThread改名） |
| `app/api/chat/route.ts` | onEnd にタイトル自動設定＋updated_at バンプの UPDATE 追加 |
| `components/dashboard/consult-panel.tsx` | 新しい会話・履歴リンク・initialThreadId 対応 |
| `app/page.tsx` | `?consult=` の受け渡し |
| `app/chats/page.tsx` ほか `components/chats/` | スレッド一覧ページ（行・リネーム・削除） |

## 7. スコープ外

- 履歴の全文検索（SPEC-conversational-personas から引き続き残置）
- ペルソナでの絞り込み・ソート切替・ページネーション（一人利用の件数想定。必要になったら）
- 掘り下げ（ノート紐づけ）スレッドの複数化・一覧掲載（管理は従来どおりノート側）
- ごみ箱・アーカイブ（削除は完全削除。救済は「ノートに保存」）
- 構造化スケジュール保存・メモの自動ノート化（Sprint 6 の次項目）

## 8. E2E検証手順（完了条件）

1. **新しい会話**: パネルの「新しい会話」→ 空状態になる（この時点でDB行は増えない）→ 送信で新スレッドが作られる
2. **複数スレッド並存**: 同一ペルソナでスレッド2本以上（DBで note_id null・同一 persona_id の複数行を確認）
3. **タイトル自動設定**: 新スレッドの先頭発言からAI生成されたタイトルが付く（20字程度・50字以内）。2通目以降で上書きされない。AI生成失敗時は先頭発言1行目の機械的整形（Markdown記号除去・50字）にフォールバックする
4. **継続再開**: パネルを閉じて開き直す→ ペルソナごとに最後に更新したスレッドが表示される
5. **一覧表示**: /chats にペルソナ名・タイトル・更新日時が降順で並ぶ。既存スレッド（バックフィル分）にもタイトルが付いている
6. **一覧からの導線**: 行クリック→ ダッシュボードに遷移し、パネルが該当スレッドを開いた状態で自動オープン。担当ペルソナのタブがアクティブ
7. **リネーム**: 一覧からリネーム→ 一覧・パネル双方に反映。以降タイトル自動設定に上書きされない
8. **削除**: 確認ダイアログ→ 完全削除（DBからメッセージごと消える）。他のスレッド・もう一方のペルソナは無傷
9. **掘り下げ回帰**: ノートの掘り下げパネルが従来どおり動く（1ノート1本・/chats に出ない）
10. **RLS/認証**: 未認証で /chats・Server Actions が弾かれる。他人（架空）の threadId を `?consult=` に直打ちしても not_found 表示。renameThread / deleteThread も他人のidで not_found
11. **モバイル375px**: 1〜8 の全操作が成立する（/chats の行・メニュー・ダイアログ含む）

※ マイグレーション（ユニークインデックス撤去の影響確認）・`?consult=` 経由のスレッド読み込み（IDOR）・renameThread / deleteThread の所有境界・タイトル自動設定のサーバー側生成は **security-reviewer 必須ゲート**の対象。
