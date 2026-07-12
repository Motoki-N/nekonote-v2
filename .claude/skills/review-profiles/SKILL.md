---
name: review-profiles
description: ネコノテAIのペルソナ制AIエージェントとレビュープロファイルの仕様。ペルソナ・レビュー機能・AI呼び出し（Vercel AI SDK）・モデル選定まわりの実装、personas / review_profiles テーブルに関わる作業時に参照する。
---

# ペルソナ制とレビュープロファイル

AIを「フェーズ限定の機能」ではなく「役割を持つキャラクター」として配置する。

## 分離の原則

- **ペルソナ（誰が）**＝性格・口調・能力レベル・参照範囲
- **レビュープロファイル（どんな観点で）**＝その役割が使う評価基準（プロンプト）
- プロファイル側に `default_persona_id` を持たせる（「企画書レビューといえば担当編集」のように役割は概ね固定されるため）。実行時にユーザーが担当を変更することも可能
- レビュー実行 = 「プロファイル＋担当ペルソナ＋対象データ」の組でAIを呼び出す

## ペルソナ一覧（標準同梱）

| ペルソナ | 能力 | 型 | 役割 | 参照範囲 |
|---|---|---|---|---|
| 担当編集 | high | reviewer | 企画書レビュー・原稿校閲（設定との整合性チェック含む）。指摘や深掘り質問のスタンスで、頭ごなしに否定しない | すべて（all） |
| 校正さん | low〜medium | reviewer | 表記揺れ・誤字脱字・文法の機械的チェック特化 | 原稿テキストのみ |
| アシスタント | medium | conversational | スケジュール・進捗助言、名称のネタ出し。チャットベース | チャット文脈のみ |
| 喫茶店のマスター | medium | conversational | 壁打ち相手。要約＋深掘り質問、最後にメモ化 | その場の会話 |
| 読者代表 | medium | reviewer | ターゲット層になりきった主観的感想（「刺さった」「飽きた」）。**設定資料は参照しない**（読者は設定資料を読まないため） | 原稿＋企画のジャンル・ターゲット層 |
| 近所の書店員 | high | reviewer | 客観評価（売れそうか・優れているか・どの層向けか）。辛辣なことも言う | 原稿のみ |

### 設計意図
- **校正さんと担当編集の分離はコスト最適化**：重い整合性チェック（high）と軽い表記チェック（low〜medium）をモデルレベルで使い分ける
- `ai_capability`（high / medium / low）→ 実際の provider / model_id へのマッピングは `ai_model_settings` テーブルで管理。設定変更だけでモデルを差し替えられる
- `persona_type: conversational` のペルソナはレビュープロファイルを持たず、`description`（性格・口調プロンプト）のみで動作する

## テーブル定義

```
personas: id, name, description（性格・口調・スタンス→プロンプトに反映）,
  ai_capability（high|medium|low）, reference_scope（all|manuscript_only|chat_only|manuscript_plus_target 等）,
  persona_type（reviewer|conversational）, is_default

review_profiles: id, name, target_phase（proposal|character|structure|scene|proofreading）,
  prompt_template（編集可能なプロンプト本文）, default_persona_id, is_default
```

- テンプレあり＋自由編集可：標準プロファイルを同梱しつつ、ユーザーが複製・編集・新規作成できる
- プロンプト差し替えでレビューフレームワーク自体を変更できる設計（別の指南書への切り替え等）

## 標準プロファイル（初期セット・5種）

1. **企画書レビュー**（target_phase: proposal、担当編集）— コンセプト・キャラクター・テーマの三要素が成立しているか＋ジャンル・ターゲット層に刺さる企画か
2. **キャラクターレビュー**（character、担当編集）— 5つの問い（誰が・何を・なぜ・失敗の代償・どう変わるか）
3. **構成レビュー**（structure、担当編集）— 4部構成・5転換点チェックリスト
4. **シーンレビュー**（scene、担当編集）— シチュエーション・出来事・感情変化・葛藤の4観点
5. **校正・校閲**（proofreading、校正さん）— 表記揺れ・誤字脱字・一貫性＋文体・表現

各チェックリストの詳細な観点は story-engineering スキルを参照。

## レビューゲート（企画フェーズ）

企画書は担当編集AIのレビューを受け、フィードバックを反映して**企画が「通る」まで反復**する（`proposals.status`: draft → in_review → approved）。実際の出版ワークフローに近い緊張感の演出が目的であり、機械的な合否判定ではない。
