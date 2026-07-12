# SPEC-ai-deep-dive: AI掘り下げ支援（Vercel AI SDK導入・ai_model_settings）

作成日: 2026-07-13（インタビュー駆動で策定）
ステータス: **確定**（2026-07-13 レビュー済み）

## 1. 目的

書き留めたネタについて、AI（アシスタント）から掘り下げのアドバイスを受けられるようにする（要求仕様 §3.1「AIによるネタ出し支援」、利用フロー §3.6「アシスタントAIによる掘り下げ支援」）。

同時に、第二期のAI基盤を初めて実装する:

- Vercel AI SDK によるマルチプロバイダ構成（Anthropic / OpenAI / Google）
- 能力レベル（high / medium / low）→ 実モデルのマッピング（`ai_model_settings`）
- この基盤は Sprint 2 以降のレビュー機能（担当編集・校正さん等）がそのまま使う

ペルソナ設計は `review-profiles` スキルが正。

## 2. 決定事項（インタビュー結果）

| 論点 | 決定 |
|---|---|
| UI形態 | **ノートエディタ内サイドパネル**（デスクトップは右サイド、モバイルはボトムシート） |
| 履歴保存 | **ノートごとに1スレッドをDB保存**。`chat_threads` / `chat_messages` をこのSPECで前倒し定義 |
| テーブル設計 | **汎用設計**: `chat_threads.note_id` は nullable＋`persona_id` を保持。今回は「note_id あり・ノートごとに1本」の用途のみ使い、R2の独立チャット画面は同テーブルの note_id null 行で実現する（マイグレーション作り直し不要） |
| ノート削除との連動 | **運命共同体**: ごみ箱中はスレッドも見えないだけ（データは残る）、完全削除で cascade 削除 |
| ペルソナ | **conversational 型の2人（アシスタント・喫茶店のマスター）を標準シード**。掘り下げパネルの担当は**アシスタント固定**（マスターはR2チャットで登場）。reviewer 型4人はレビュープロファイルとセットで Sprint 2 |
| ノートへの反映 | **応答ごとに「ノートに挿入」ボタン** → その内容をMarkdownとしてカーソル位置に挿入（テンプレ挿入と同じ流儀・1操作でUndo可） |
| ai_model_settings | 行がないユーザーは**コード内デフォルト定数にフォールバック**（要求仕様 §4.4 の初期マッピング）。ユーザー行があれば優先。設定UIは Sprint 5（当面の差し替えはSQLで可能） |

## 3. 画面とUX

### 3.1 掘り下げパネル（ノートエディタ内）

- エディタツールバー等に「掘り下げ」ボタン → パネル開閉
  - lg以上: 右サイドパネル（エディタと並列表示）
  - lg未満（スマホ）: ボトムシート
- 初回オープン時にそのノートのスレッドを get-or-create（担当: アシスタント）
- メッセージ入力欄＋送信。応答は**ストリーミング表示**
- 各AI応答の下に「ノートに挿入」ボタン → カーソル位置にMarkdown挿入。挿入済みであることが分かる表示にする
- 「会話をリセット」: スレッドのメッセージを全削除（確認ダイアログあり）。長く使って文脈が汚れたときの逃げ道
- エラーはパネル内に日本語メッセージ表示（APIキー未設定 / ネットワーク / プロバイダエラー。`AppError` 経由で正規化）
- 送信中の多重送信は抑止。ストリーミング中の中断ボタン（stop）あり

### 3.2 プロンプトとコンテキスト

- system プロンプト = ペルソナの `description`（性格・口調）＋掘り下げ役割の指示＋**対象ノートのタイトル・本文・タグ**
  - 役割の指示: 頭ごなしに答えを与えず、要約と深掘り質問でネタを膨らませる。応答は簡潔に（モバイルで読める分量）
  - ノート本文は**送信時点のエディタの現在値**を渡す（保存済みDB値ではなく。編集途中の内容を即題材にできる）
- 会話履歴は**直近20メッセージ**に制限して送る（それ以前は送らない。要約はしない）
- 関連ノート（同じ仮タイトルタグのノート群）はコンテキストに**含めない**（スコープ外。コストと単純さ優先）

## 4. データ

### 4.1 追加テーブル: `chat_threads` / `chat_messages`（要マイグレーション・プランモード承認）

```
chat_threads:
  id uuid PK
  user_id uuid not null default auth.uid() FK auth.users cascade
  note_id uuid null可 FK notes cascade      … null = ノートに紐づかない会話（R2で使用）
  persona_id uuid null可 FK personas set null … 担当ペルソナ（削除されても履歴は残す）
  created_at / updated_at

  部分ユニーク: unique (user_id, note_id) where note_id is not null
  （ノートごとに1スレッド。R2の独立チャットは複数可）

chat_messages:
  id uuid PK
  thread_id uuid not null FK chat_threads cascade
  role text not null check ('user' | 'assistant')
  content text not null
  created_at（updated_at なし: メッセージは不変）

  index (thread_id, created_at)
```

- RLS: `chat_threads` は owner-only（他テーブルと同構成）。`chat_messages` は user_id を重複保持せず、`exists (select 1 from chat_threads where id = thread_id and user_id = auth.uid())` で親経由の owner-only
- ごみ箱連動: ノートが `deleted_at` 非null の間はUI上パネルを出さないだけ（クエリ・RLSは変更なし）。完全削除で cascade

### 4.2 personas 標準シード（同マイグレーションに同梱・2行）

| name | ai_capability | reference_scope | persona_type |
|---|---|---|---|
| アシスタント | medium | chat_only | conversational |
| 喫茶店のマスター | medium | chat_only | conversational |

- `is_default = true`（user_id null。ハイブリッド所有モデルの標準行）
- `description`（性格・口調プロンプト本文）は review-profiles スキル準拠でシード時に確定（templates の雛形本文と同じ進め方）
- 掘り下げパネルは name ではなく「is_default かつ アシスタント」を初期シードのIDで参照できるよう、**シードで固定UUIDを採番**する（コードから安定参照するため）

### 4.3 ai_model_settings（行データ・トリガーは追加しない）

- テーブルは定義済み（20260712000002）。今回は**読み取りロジックのみ**実装
- 解決順: ユーザー行（user_id, capability）→ なければコード内デフォルト定数
- デフォルト定数（要求仕様 §4.4 初期マッピング。モデルIDは実装時に各社公式で最終確認）:

| capability | provider | model_id |
|---|---|---|
| high | anthropic | claude-sonnet-5 |
| medium | openai | gpt-5.4-mini |
| low | google | gemini-3.1-flash-lite |

## 5. AI基盤の実装方式

- パッケージ: `ai`（Vercel AI SDK）＋ `@ai-sdk/anthropic` / `@ai-sdk/openai` / `@ai-sdk/google` ＋ `@ai-sdk/react`（useChat）。バージョンは実装セッションで最新安定版を確認
- `lib/ai/models.ts`: capability → `ai_model_settings` 解決 → プロバイダ別モデルインスタンス生成（このSPECの中核。レビュー機能も将来ここを通す）
- `lib/ai/prompts.ts`: 掘り下げ用 system プロンプト組み立て（ペルソナ description＋役割指示＋ノートコンテキスト）
- API: Route Handler `POST /api/chat`（ストリーミングのため Server Action ではなく Route Handler）
  1. Supabase 認証チェック（未認証は401）
  2. thread の所有確認（RLS越しの取得で兼ねる）
  3. `streamText` で呼び出し、`onFinish` で user / assistant メッセージ2件をDB保存
- スレッド作成・リセットは Server Actions（`lib/actions/chat.ts`）。Zod＋AppError の既存パターン踏襲
- 環境変数: **今回必須は `OPENAI_API_KEY` のみ**（medium帯）。`ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` は設定で差し替えたとき・Sprint 2 以降に登録。未設定プロバイダの呼び出しは AppError「このプロバイダのAPIキーが未設定です」を返す（落ちない）
  - キーは Vercel 環境変数＋`.env.local`（サーバー側のみ。`NEXT_PUBLIC_` にしない）
- 色はテーマ用CSS変数のみ（パネル・吹き出し含む）

## 6. 対象ファイル

| ファイル | 役割 |
|---|---|
| `supabase/migrations/XXXX_chat_and_conversational_personas.sql` | chat_threads / chat_messages＋RLS＋personas 2行シード（プランモード承認後・security-reviewer ゲート対象） |
| `lib/schemas/chat.ts` | チャット入力のZodスキーマ |
| `lib/ai/models.ts` | capability→実モデル解決＋プロバイダ生成（AI基盤の中核） |
| `lib/ai/prompts.ts` | 掘り下げ用プロンプト組み立て |
| `app/api/chat/route.ts` | ストリーミングAPI（認証・所有確認・保存） |
| `lib/actions/chat.ts` | スレッド get-or-create・リセット |
| `components/notes/deep-dive-panel.tsx` 等 | パネルUI（メッセージ一覧・入力・挿入ボタン） |
| `lib/database.types.ts` | マイグレーション後に `npm run db:types` で再生成 |

## 7. スコープ外

- 独立チャット画面（画面10・R2）。マスターとの対話・ノートに紐づかない雑談はそちらで
- ペルソナ切替UI（掘り下げはアシスタント固定）
- `ai_model_settings` の設定UI（Sprint 5）・サインアップ時の行シード
- レビュー系AI呼び出し（担当編集等。Sprint 2。ただし `lib/ai/models.ts` は共用前提で作る）
- 関連ノート（同じ仮タイトル）のコンテキスト投入
- 会話履歴の要約・トークン数最適化・使用量/コスト計測
- チャット履歴の検索・エクスポート

## 8. E2E検証手順（完了条件）

1. **パネル開閉**: エディタから掘り下げパネルを開閉できる（デスクトップ=サイド、スマホ幅=ボトムシート）
2. **対話**: メッセージ送信→ストリーミングで応答が流れる。ノートの内容（本文・タグ）を踏まえた掘り下げ質問が返る
3. **履歴永続化**: リロード後もパネルを開くと会話が復元される。別ノートには別スレッドが付く
4. **未保存内容の反映**: エディタで追記した直後（自動保存前）に送信しても、追記内容を踏まえた応答になる
5. **ノートに挿入**: 応答の「ノートに挿入」でカーソル位置にMarkdownが入り、1回のUndoで取り消せる
6. **会話リセット**: 確認ダイアログ→メッセージが全消去され、新しく会話を始められる
7. **ごみ箱連動**: ノートをごみ箱へ→復元で会話が残っている。完全削除→chat_threads / chat_messages がDBから消えている（SQLで確認）
8. **モデルマッピング**: `ai_model_settings` に medium の行をSQLで挿入するとそのモデルで応答する（デフォルト定数からの切り替わりをログ等で確認）→ 行を消すとデフォルトに戻る
9. **キー未設定エラー**: 該当プロバイダのキーを外すと、パネルに日本語のエラーメッセージが出て、アプリは落ちない
10. **RLS**: 別ユーザーのスレッド・メッセージが一切見えない（anonキー外形確認＋認証済みユーザー間）
11. **モバイル**: スマホ幅で 2〜6 の全操作が成立する

※ マイグレーション（RLS）と `/api/chat`（認証・キー取り扱い）は **security-reviewer 必須ゲート**の対象。
