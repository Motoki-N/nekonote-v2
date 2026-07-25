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
| 読者代表 | medium | reviewer | ターゲット層になりきった主観的感想（「刺さった」「飽きた」）を賛否両論で。辛辣なことも言う。**設定資料は参照しない**（読者は設定資料を読まないため） | 原稿＋企画のジャンル・ターゲット層 |
| 近所の書店員 | high | reviewer | 作家のサポーターとして売り込み分析（どの棚・どの客層・何を推すか）。あらすじ・キャッチコピー作成も担当。評価者ではない（Issue #14で役割変更） | 原稿＋企画のジャンル・ターゲット層 |
| 技術書編集者 | high | reviewer | 技術書の企画書レビュー・原稿編集。対象読者定義・前提知識の積み上げ・学習曲線・用語統一を重点。技術的正確さは「動作確認を促す」形で指摘（Issue #95） | すべて（all） |
| エンジニア読者 | medium | reviewer | 技術書のターゲット読者そのもの。前提知識のギャップで詰まった箇所を正直に言う。設定資料は参照しない（Issue #95） | 原稿＋企画のジャンル・ターゲット層 |

### 設計意図
- **校正さんと担当編集の分離はコスト最適化**：重い整合性チェック（high）と軽い表記チェック（low〜medium）をモデルレベルで使い分ける
- `ai_capability`（high / medium / low）→ 実際の provider / model_id へのマッピングは `ai_model_settings` テーブルで管理。設定変更だけでモデルを差し替えられる
- `persona_type: conversational` のペルソナはレビュープロファイルを持たず、`description`（性格・口調プロンプト）のみで動作する

## テーブル定義

```
personas: id, name, description（性格・口調・スタンス→プロンプトに反映）,
  ai_capability（high|medium|low）, reference_scope（all|manuscript_only|chat_only|manuscript_plus_target 等）,
  persona_type（reviewer|conversational|illustrator）, is_default,
  writing_genre（novel|tech_book|other|null。null=全ジャンル共通）

review_profiles: id, name, target_phase（proposal|character|structure|scene|proofreading|manuscript）,
  prompt_template（編集可能なプロンプト本文）, default_persona_id, is_default,
  writing_genre（novel|tech_book|other|null。null=全ジャンル共通）
```

- テンプレあり＋自由編集可：標準プロファイルを同梱しつつ、ユーザーが複製・編集・新規作成できる
- プロンプト差し替えでレビューフレームワーク自体を変更できる設計（別の指南書への切り替え等）

## 標準プロファイル（12種）

小説向け（writing_genre: novel）:

1. **企画書レビュー**（target_phase: proposal、担当編集）— コンセプト・キャラクター・テーマの三要素が成立しているか＋ジャンル・ターゲット層に刺さる企画か
2. **キャラクターレビュー**（character、担当編集）— 5つの問い（誰が・何を・なぜ・失敗の代償・どう変わるか）
3. **構成レビュー**（structure、担当編集）— 4部構成・5転換点チェックリスト
4. **シーンレビュー**（scene、担当編集）— シチュエーション・出来事・感情変化・葛藤の4観点
5. **読者講評**（manuscript、読者代表）— 作品全体の読書体験
6. **売り込み分析**（manuscript、書店員）— どの棚・どの客層・何を推すか
7. **あらすじ作成**（manuscript、書店員）
8. **キャッチコピー作成**（manuscript、書店員）

全ジャンル共通（writing_genre: null）:

9. **校正・校閲**（proofreading、校正さん）— 表記揺れ・誤字脱字・一貫性＋文体・表現（構造化出力）

技術書向け（writing_genre: tech_book。Issue #95・SPEC-genre-profiles）:

10. **技術書企画書レビュー**（proposal、技術書編集者）— テーマ・対象読者と前提知識・本のゴール・スコープ実現可能性
11. **技術書講評**（manuscript、エンジニア読者）— 前提知識の穴・コード例の追従可能性・学びの実感
12. **技術書校正**（proofreading、校正さん）— 技術用語の表記統一＋コードブロック校正除外（構造化出力）

小説系チェックリストの詳細な観点は story-engineering スキルを参照。

## 既定選択の自動適用（SPEC-genre-profiles）

- プロジェクトの執筆ジャンル（proposals.writing_genre）に応じ、一覧を**一致→共通(null)→他ジャンル**の
  優先順にソートして返す（lib/genre-priority.ts。取得後のJS側ソート・同順位内は is_default desc→created_at）
- UIの「一覧先頭＝既定選択」挙動に乗せる。選択肢の絞り込みはしない（クロスジャンル手動選択可）
- 校正はサーバー側ジャンル解決（選択UIなし・標準行限定。/api/proofread）

## レビューゲート（企画フェーズ）

企画書は担当編集AIのレビューを受け、フィードバックを反映して**企画が「通る」まで反復**する（`proposals.status`: draft → in_review → approved）。実際の出版ワークフローに近い緊張感の演出が目的であり、機械的な合否判定ではない。
