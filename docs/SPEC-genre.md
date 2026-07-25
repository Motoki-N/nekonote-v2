# SPEC-genre: 執筆ジャンル・執筆目的の基盤

作成日: 2026-07-25（Issue #94 のインタビュー駆動で策定）
ステータス: **確定**（2026-07-25 プラン承認をもって設計確認とする）
起点Issue: #94（親Issue #93 汎用執筆支援。#95 ジャンル別ペルソナ・#96 ボードのジャンル対応が本SPECの基盤に依存する）

## 1. 目的

小説特化のネコノテを汎用執筆支援（第一目標: 技術書）へ拡張する土台として、
「この作品は何を（執筆ジャンル）・何のために（執筆目的）書くのか」をアプリが知る基盤を企画書に追加する。
執筆ジャンルはジャンル別テンプレの選択・AIレビューの文脈・後続の #95（標準プロファイルの既定選択）・#96（構成ボードのモード）の分岐キーになる。

## 2. 決定事項（インタビュー結果・2026-07-25）

| 論点 | 決定 |
|---|---|
| 執筆ジャンル | `novel`（小説）/ `tech_book`（技術書）/ `other`（その他）の3種から開始。追加はマイグレーションで拡張 |
| 保存場所 | `proposals.writing_genre`（text not null default 'novel'＋CHECK 制約）。既存行は default で小説扱い |
| カラム化の理由 | AIプロンプト・テンプレ選択・後続Issueの分岐が**構造として参照する**ため（draft-to-clean-model 判断基準2）。テンプレ本文はコード内定数のまま |
| 執筆目的 | `proposals.purpose`（text nullable・自由記述）。例:「技術書典17で頒布する」「商業出版を目指す」「学習アウトプット」 |
| 設定場所 | プロジェクト作成ダイアログでジャンル選択（既定: 小説）＋企画書エディタで後から変更可。執筆目的は**企画書エディタのみ**（作成ダイアログはシンプルに保つ） |
| ジャンル変更時 | 企画書本文・テンプレは**書き換えない**（テンプレ再適用しない。本文には一切触れない） |
| 既存「ジャンル」欄 | 「内容ジャンル」（ファンタジー、Webフロントエンド等の自由記述）へ**ラベルのみ**変更。DBカラム名 `genre` は不変 |
| 講評の入力充足チェック | writing_genre / purpose は**加えない**（writing_genre は not null で常在、purpose は任意項目のため） |

## 3. 画面とUX

### 3.1 プロジェクト作成ダイアログ（/projects）

- タイトルの次に「執筆ジャンル」select を追加（既定: 小説）。ネイティブ `<select>`＋`WRITING_GENRE_LABEL` 方式
- 選択ジャンルに応じた初期テンプレ入りで企画書（proposals 行）が自動作成される

### 3.2 企画書エディタ（/projects/[id]）

- メタ情報フィールドを4項目に拡張（grid 2列 × 2行）:
  執筆ジャンル（select・変更可）→ 執筆目的（Input）→ 内容ジャンル（Input・旧「ジャンル」）→ ターゲット層（Input）
- 4項目とも自動保存（2秒デバウンス）・localStorage ドラフト退避・復元の対象
- 旧形式ドラフト（writing_genre なし）の復元時は 'novel' にフォールバック

### 3.3 ジャンル別初期テンプレ（コード内定数）

`lib/constants/proposal-template.ts` の `PROPOSAL_INITIAL_CONTENT: Record<WritingGenre, string>`:

- **小説**: 現行維持 — `## コンセプト` / `## キャラクター` / `## テーマ`（story-engineering の企画3要素）
- **技術書** — `## テーマ` / `## 参加イベント` / `## ターゲット読者` / `## 本のゴール`（各見出し下に1行ガイド文）
- **その他**: 空文字列（汎用ジャンルのため雛形を押し付けない）

templates テーブルには入れない（ノート挿入用途ではない。SPEC-proposal-review §3.2 と同方針）。

## 4. AIプロンプトへの反映

- `ProposalContext`（lib/ai/prompts.ts）に `writingGenre` / `purpose` を必須フィールドとして追加
  （組み立て漏れをコンパイルエラーで検出させる）
- `proposalSection()` の出力（全AI経路共用: 企画書・キャラクター・構成・シーンレビュー、講評、イラスト案出し）:

  ```
  # 企画書
  執筆ジャンル: 技術書        ← WRITING_GENRE_LABEL で日本語化
  執筆目的: 技術書典17で頒布する（未記入なら「（未記入）」）
  内容ジャンル: Webフロントエンド ← 旧「ジャンル:」を改称
  ターゲット層: ...
  本文: ...
  ```

- 講評（target_only スコープ）の企画情報も「ジャンル:」→「内容ジャンル:」に改称のみ（項目追加はしない＝なりきり読者スコープの意味を変えない）

## 5. データ・実装方式

- マイグレーション: `supabase/migrations/20260725000002_proposal_writing_genre.sql`（カラム追加のみ・RLS変更なし）
- enum定数: `lib/schemas/enums.ts` の `writingGenres` / `WritingGenre`
- ラベル: `lib/constants/proposal-template.ts` の `WRITING_GENRE_LABEL`（ディレクティブなしの純定数ファイル。client の UI と server の AIプロンプトの両側から import する共用置き場）
- zod: `proposalInputSchema` に `writing_genre`（enum・default 'novel'）と `purpose`（nullish）を追加 → `proposalUpdateSchema` 経由で自動保存の受け口に自動反映
- `createProject` は第3引数 `writingGenre` で受ける（proposals 側の値のため projectInputSchema に混ぜない。noteIds と同じ流儀）
- DB生成型では CHECK 付き text は `string` になるため、読み出し側は `as WritingGenre` キャストで絞る（`as ProposalStatus` と同方式）

## 6. スコープ外（後続Issue）

- ジャンル別の標準ペルソナ・レビュープロファイルと既定選択の自動適用 → SPEC-genre-profiles（#95 で実装済み）
- 構成設計（ビートボード）のジャンル対応 → #96
- 執筆ジャンルの追加（novel/tech_book/other 以外）はマイグレーション＋enums.ts＋ラベル＋テンプレの4点同時更新で行う

## 7. E2E検証手順

1. 新規プロジェクト作成: 既定「小説」で現行テンプレ / 「技術書」で4見出しテンプレ / 「その他」で空本文
2. 企画書エディタ: 4フィールド表示・自動保存・リロード復元。執筆ジャンル変更で本文が書き換わらないこと
3. 既存プロジェクト（マイグレーション前作成分）: 執筆ジャンル「小説」で表示されること
4. 企画書レビュー実行: フィードバックが執筆ジャンル・執筆目的を認識していること
5. 回帰: 講評ゲート（内容ジャンル/ターゲット層未設定時のフェイルクローズ）が従来どおり動くこと
