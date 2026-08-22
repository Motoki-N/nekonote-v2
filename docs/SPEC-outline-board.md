# SPEC-outline-board: 目次ボード（非小説ジャンルの構成設計）

作成日: 2026-07-25（Issue #96 のコメント駆動＋インタビューで策定）
ステータス: **確定**（2026-07-25 プラン承認をもって設計確認とする）
起点Issue: #96（親Issue #93 汎用執筆支援の最後の子Issue。前提: SPEC-genre / SPEC-genre-profiles）

## 1. 目的

ビートボード（SPEC-beat-board）の4部構成・5転換点は小説・脚本のメソッドであり、技術書などの解説書には合わない。
一般的な解説書の構成設計は「どういう内容をどの順番で書くかを考える＝目次を組み立てる」程度で十分（Issue #96 コメント）。
そこで**モード化ではなく**、非小説ジャンル向けに**シンプルな目次作成機能（目次ボード）を新設**し、
ビートボードは小説専用のまま無変更で守る。カードを章に見立てて並べ、定番構成テンプレを同梱する。

## 2. 決定事項（2026-07-25）

| 論点 | 決定 |
|---|---|
| 方式 | ビートボードのレーン差し替えではなく**目次ボードの新設**。`/projects/[id]/board` を執筆ジャンルで出し分け（novel=ビートボード / tech_book・other=目次ボード） |
| データモデル | **scenes 共用**。目次カードは `part='chapter'` の1レーン。anchor・感情は null のまま使わない（draft-to-clean-model 判断基準2の範囲。新テーブルは作らない） |
| カード構造 | **フラット1列**（章/節の階層なし）。タイトル＋内容メモ（content）＋原稿ファイル紐づけ（manuscript_path） |
| テンプレ | 定番構成3種をコード内定数で同梱（§3.4）。templates テーブルには入れない |
| テンプレ適用UI | 空ボード時に目立つ形で提示＋カードがあっても常設メニューから**末尾に一括追加** |
| 構成レビュー | 既存 `target_phase='structure'`・承認ゲート（projects.structure_status）・/api/review を**無変更で流用**。技術書構成レビュー（…1013・tech_book・→技術書編集者）をシード |
| ジャンル変更時 | データは削除しない。**ビューが切り替わるだけ**（novelシーンは目次ボードに出ない・章カードはビートボードに出ない。並べ替え保存でも相手ビューのカードは保全される。§4） |
| 「その他」ジャンル | 目次ボードを表示。構成レビューの既定は小説版のまま（#95 の「その他=自動適用なし」の方針。技術書構成レビューを手動選択可能） |
| 持たないもの | ノート紐づけUI・シーンレビュー（4観点）・感情・アンカー（すべて小説理論の項目。§7） |

## 3. 画面とUX

### 3.1 出し分けとタブ文言

- `board/page.tsx` が proposals.writing_genre で分岐（novel→BeatBoard / それ以外→OutlineBoard）
- タブ文言も出し分け: 小説=「ビートボード」/ 技術書・その他=「目次」（layout.tsx で writing_genre を取得し ProjectTabs の `boardLabel` prop で渡す。href・アクティブ判定は不変）

### 3.2 目次ボード本体（components/board/outline-board.tsx）

- 章カードの縦1列（max-w-xl 中央寄せ）。dnd-kit はビートボードと同じ3センサー・楽観更新→保存失敗ロールバック＋トースト。1レーンのため handleDragOver は持たない
- カードの見た目は `SceneCardContent` / `SortableSceneCard` を再利用（anchor/感情 null・status draft のため実質タイトル＋メモ＋原稿バッジのみが出る）
- ヘッダー: 「章 N枚」・構成承認済みバッジ・「定番構成から追加」メニュー・「構成レビューを受ける」トグル
- 「＋章を追加」→ `createScene(projectId, 'chapter')` → 直後に編集ダイアログを開く（ビートボードと同型）

### 3.3 章カードダイアログ（components/board/outline-dialog.tsx）

- 章タイトル・内容メモ・原稿ファイル select（scene-dialog と同じ getManuscriptTree 遅延取得・
  エディタが開ける章のみ表示・消えたパスの現在値温存・「エディタで開く」リンク）・削除（確認→物理削除）
- 保存は `updateScene` に `part:'chapter'・anchor:null・emotion_delta:null` を固定で送る

### 3.4 定番構成テンプレ（lib/constants/outline-template.ts）

| キー | ラベル | 章 |
|---|---|---|
| introduction | 入門型 | 背景 / 環境構築 / 基本操作 / 小さな実装 / 応用 / まとめ |
| problem_solving | 問題解決型 | ある課題 / 原因の整理 / 解決策の比較 / 実装方法 / 注意点 |
| practical_knowhow | 実践ノウハウ型 | 前提知識 / 現場での判断ポイント / 設計例 / 失敗例 / ベストプラクティス |

- 空ボード時: 3テンプレをカード型で提示（ラベル・説明・章一覧プレビュー・「この構成で始める」）＋「白紙から章を追加」
- 常設: ヘッダーの「定番構成から追加」DropdownMenu からいつでも末尾に一括追加
- 適用は Server Action `applyOutlineTemplate(projectId, templateKey)`（zod enum 検証・assertProjectOwned・1回の upsert=原子的）

### 3.5 構成レビュー

- ReviewPanel（kind='structure'・targetId=projectId）を共通流用。emptyText のみ目次文言
- 既定選択: 技術書プロジェクト=**技術書構成レビュー**（#95 のジャンル優先ソートで自動）。
  「その他」=小説の構成レビューのまま（意図した帰結。目次形式の入力に対し4部構成観点になるため、
  必要なら技術書構成レビューを手動選択する）
- 「構成を通す」→ `approveBoardReview`（無変更）→ projects.structure_status='approved'。承認バッジはビートボードと共通の意味
- **フィードバックの「ノートに転記」（Issue #173）**: 企画書レビュー（Issue #99）と同じ `saveFeedbackAsNote` を構成レビューにも許可。ビートボードの構成レビューと共通

## 4. データ設計と2ビュー共存の整合性

- スキーマ変更は `scenes.part` の CHECK への 'chapter' 追加のみ（20260725000004。RLS変更なし）
- 型は `sceneParts`（小説4レーン描画用）と `scenePartsAll = [...sceneParts, 'chapter']`（DB/zod/正準順序用）を分離。
  `SceneRecord.part` は ScenePartAll
- **正準順序（toCanonicalOrder）は5パート走査**（設定→反応→攻撃→解決→章）。
  `reorderScenes` は「送信 order の id 集合＝プロジェクト全 scenes」の完全一致を検証するため、
  両ボードとも「state に全件保持・描画のみフィルタ・送信は全件」とする——これでジャンル切替により
  両種のカードが混在していても、片方のビューでの並べ替え保存がもう一方のカードを保全する
- ビートボード側は「シーン N枚」表示と感情折れ線から章カードを除外（レーン描画は part フィルタで自然に除外）
- AIプロンプト `buildStructureReviewInput` はジャンル分岐: novel=現行出力を維持（chapter を除外）、
  非novel=`# 構成（目次・構成順）` で章タイトル＋内容メモのみ（パート・アンカー・感情行なし）。
  シーンレビューの全シーン一覧からも chapter を除外

## 5. 実装方式

- 既存パターンの踏襲: Server Actions は zod＋AppError の `{ok,error}`、D&D は楽観更新→ロールバック、色はテーマCSS変数のみ
- /api/review・approveBoardReview・review_sessions まわりは**無変更**（security-reviewer ゲートの「対象拡張」に非該当）

## 6. 対象ファイル

新規: outline-board.tsx / outline-dialog.tsx / outline-template.ts / 20260725000004 / 本SPEC。
変更: enums.ts / board.ts / schemas/projects.ts / actions/scenes.ts（applyOutlineTemplate）/ prompts.ts /
board/page.tsx / layout.tsx / project-tabs.tsx / beat-board.tsx（章カード除外）/ scene-dialog.tsx（防御的フォールバック）/ personas.ts

## 7. スコープ外

- 章/節の2階層化（フラット1列で開始。実需が出たらIssue起票）
- 章カードへのノート紐づけUI・シーンレビュー（4観点）・感情・アンカー（小説理論の項目）
- 目次から原稿ファイル群の一括生成・目次のエクスポート
- ビートボード⇄目次ボードのカード相互変換（part の付け替え）

## 8. E2E検証手順

1. 技術書プロジェクトの /board で目次ボード・タブ「目次」・空時テンプレ3種提示
2. テンプレ適用（空時「この構成で始める」＋常設メニューで末尾追加）→ リロード保持
3. 章カードの D&D 並び替え → リロードで順序保持
4. ダイアログでタイトル・メモ・原稿紐づけ → カードに原稿バッジ → 削除
5. 構成レビュー既定=技術書構成レビュー/技術書編集者 → 実行 → 判定行 → 「構成を通す」承認バッジ
6. 小説プロジェクト完全回帰（4レーン・アンカー・感情・シーン/構成レビュー・入力見出し不変）
7. ジャンル切替: novelシーンあり→技術書→目次ボード（シーン非表示・データ残存）→章カード追加・D&D保存→小説へ戻す→元シーンが順序ごと無傷・「シーンN枚」に章が混入しない
