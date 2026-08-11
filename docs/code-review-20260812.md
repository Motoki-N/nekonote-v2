# コードレビュー結果（2026-08-12）— 締めくくり作業 Step 1

保守性向上を目的とした**コードベース全体**のレビュー記録。修正はせず、問題点を「重複コード / 命名不統一 / 責務違反 / 型の緩さ / 未使用コード」に分類してリスト化する。対象の取捨選択・SPEC化・段階実施は別セッションで行う（締めくくり作業計画 Step 1）。

- **対象**: v0.2.0-rc ＋ Issue #176/#177 修正マージ後の main（16dcfb1 時点・app/components/lib 約32,700行）
- **前回レビュー（code-review-20260714.md・直近3コミット対象）との違い**: 今回は全体走査。定量シグナル（ファイルサイズ・`as` アサーション・未使用エクスポート・パターン出現数）＋重点ファイルの読解による
- `npm run typecheck` / `npm run lint` はエラーなしで通過（レビュー時点）

## 前回指摘（2026-07-14）の消化状況

- **全9件（M-1〜3・L-1〜6）対応済み**（前回ドキュメント末尾の対応結果どおり。1指摘=1コミットで消化済み）
- **要確認2件は今回も監視継続**: ①AI SDK のステップ集約挙動（`ai` メジャー更新時に `/api/chat` onEnd を再確認）②Next.js proxy の matcher 記法（Next 更新時に警告有無を確認）。どちらも行動不要の注意書き

## 総評

**Critical 相当はゼロ。** `as any`・`@ts-ignore`・TODO/FIXME が全てゼロ、非nullアサーション1箇所のみ、Server Action の `toActionError` 共通化と境界防御（クライアント入力の再検証・RLS 依存の所有確認）は前回同様に一貫している。全体レビューで見えたのは個別バグではなく**成長痕**——機能追加のたびに同じ形のコード（Git コンテキスト解決・日付ヘルパ）が増殖し、初期の2ファイル（vertical-editor.tsx / actions/editor.ts）に機能が集積し続けている構図。リファクタリングの主戦場はこの2点に絞られる。

---

## 重複コード

### D-1. Git コンテキスト解決（認証→プロジェクト取得→PAT復号）が11ファイルに別実装

- **優先度: High**（重複統合の本丸。Step 2 のセキュリティ監査面も縮む）
- **該当**: `patCredentialProvider.getCredential` の呼び出しが 19箇所/11ファイル。`lib/actions/editor.ts` は `loadEditorContext`、`lib/actions/zenn.ts` は `loadZennContext` として関数化済みだが、`lib/actions/critique.ts`・`lib/actions/manuscripts.ts`・`app/api/review|proofread|illustration/propose|editor/asset|editor/build-asset` はインライン実装で、「auth 確認→ projects を RLS 越しに select → repo ゲート→ PAT 復号→ base_path 正規化」の同型ブロックが微妙に違う形で並存
- **なぜ問題か**: 認可境界のコードが散在していると、変更時（例: Issue #176 のような base_path 規約変更・PAT の扱い変更）に漏れが出やすく、security-reviewer の監査対象も広がる。過去の M-1（phase4・書き込み先パス再検証欠落）もこの散在が遠因
- **修正方針**: `lib/git/project-context.ts`（仮）に `loadProjectGitContext(projectId, { requireRepo })` を新設し、全11ファイルを乗せ替える。戻り値型は既存 `EditorContext` を一般化。インターフェース不変・機械的な置換で、回帰テスト §7/§8 で検証可能

### D-2. base_path 正規化（`?? ''`・末尾スラッシュ除去）が14箇所に散在

- **優先度: Medium**（D-1 に吸収される）
- **該当**: `project.base_path ?? ''` パターン14箇所。末尾 `/` 除去をするのは editor.ts の2箇所のみで、他は素通し（現状は保存時スキーマが末尾 `/` を拒否するため実害なし）
- **修正方針**: D-1 の共通コンテキストが正規化済み `basePath` を返せば全て消える

### D-3. `jstDate` が3ファイルに同一実装＋類似実装1

- **優先度: Medium**（前回 L-3 と同型の「クライアント/サーバー別実装」の再発）
- **該当**: `app/(app)/page.tsx:20`・`app/api/cron/milestone-reminders/route.ts:12`・`app/api/chat/route.ts:52` に同一の `jstDate`。`lib/actions/repo-setup.ts:29` の `backupStamp` も同じ +9h 手法の変種。UTC明示の `Intl.DateTimeFormat` は `project-overview-card.tsx` に別系統
- **なぜ問題か**: JST固定という仕様が4箇所に埋まっており、片方だけ直すと日付判定（進捗記録・リマインド・退避フォルダ名）がずれる。前回 L-1/L-3 で日付まわりは一度火傷している領域
- **修正方針**: `lib/date.ts`（仮）に `jstDateString` / `jstTimestamp` を寄せて参照統一

---

## 命名不統一

### N-1. データ取得関数の動詞が get / fetch / list / load で混在、同名別関数も発生

- **優先度: Medium**
- **該当**: lib 配下のエクスポート関数で get系30＋・fetch系・list系・load系が混在。実害の芽として **`getManuscriptTree` が `lib/git/github.ts` と `lib/actions/manuscripts.ts` で同名別関数**になっており、後者は前者を `as fetchManuscriptTree` にリネームインポートして自身の `getManuscriptTree` を別途エクスポートしている（manuscripts.ts:12,38）
- **なぜ問題か**: grep・ジャンプで誤着地する。レイヤー（git API ラッパー vs Server Action）の区別が名前から読めない
- **修正方針**: 規約を決めて寄せる（例: lib/git は `fetch*`＝外部API、lib/actions は `get*`＝Server Action）。全リネームは機械的だが差分が大きいので、まず同名衝突の manuscripts.ts / github.ts ペアだけ解消する縮小案も可

### N-2. クォートスタイルがファイル単位で分裂（single 75 / double 94）

- **優先度: Medium**（判断が必要: 直すなら独立コミットで一括）
- **該当**: フォーマッタ未導入（prettier 設定なし・eslint にスタイル規則なし）のため、作成時期によりファイルごとに `'` と `"` が分裂
- **なぜ問題か**: 実害はないが、コピペ時の揺れ・diff ノイズの温床。第三者に見せるコードベース（公開化・技術書典）としての見栄えの問題もある
- **修正方針**: prettier（または Biome）を導入して一括フォーマット。**機能変更と絶対に混ぜず単独コミット**にする（git blame 汚染は `.git-blame-ignore-revs` で緩和可能）。やらない判断もあり得る——その場合は「導入しない」を明文化

---

## 責務違反

### R-1. `components/editor/vertical-editor.tsx` 1,757行の単一コンポーネント

- **優先度: High（ただしリスク最大・着手判断は慎重に）**
- **該当**: 章一覧・保存＝コミット・IndexedDB待避・競合マージ・ツールバー・プレビュー（分離窓含む）・字数・コメント一覧・画像・ビルド・ブランチ/PR・書き出し・レビューパネル連携——エディタの全機能が1コンポーネントに集積。state/ref だけで20超
- **なぜ問題か**: 変更のたびに全体を読む必要があり、Issue 対応（#171/#173 等）でも毎回このファイルが肥大。lint 新ルール（react-hooks/refs 等）の影響も集中する
- **修正方針**: custom hooks（useChapterState / useDraftStore / useBranch / useBuild…）＋サブコンポーネント抽出の段階分割。**1段階=1抽出＋回帰テスト §8** を厳守。エディタは直近リリースの中核機能のため、スコープカット（＝今回はやらない判断）も選択肢

### R-2. `lib/actions/editor.ts` 1,079行・20エクスポート

- **優先度: High（低リスクで効果大・構造整理の初手に推奨）**
- **該当**: workspace 解決・章 CRUD・保存・書籍設定フォーム（config/テーマ/奥付）・画像・入稿ビルド・ブランチ・PR が1ファイル
- **修正方針**: `editor/chapters.ts`・`editor/book-settings.ts`・`editor/build.ts`・`editor/branch.ts` 等への**ファイル分割のみ**（関数シグネチャ不変・re-export で呼び出し側無変更も可）。typecheck が守ってくれる純粋な移動なのでリスクが小さい

### R-3. 中規模モノリス（余力があれば）

- **優先度: Low**
- **該当**: `settings-dialog.tsx` 720行・`consult-panel.tsx` 666行・`settings.ts` 633行
- **修正方針**: R-1/R-2 の後、同じ要領で。単独では急がない

---

## 型の緩さ

### T-1. DB文字列列 → union 型への `as` キャストが横断的（アサーションの主成分）

- **優先度: Medium**
- **該当**: `as` アサーション107箇所（database.types 除く）のうち、`as WritingGenre`・`as StructureTemplate`・`as ReferenceScope`・`as AiCapability`・`as SceneRecord[]` 等の「DBの text 列を列挙union に読み替える」キャストが主成分（app/api/review/route.ts 7・lib/actions/settings.ts 6・lib/board.ts 5 など）
- **なぜ問題か**: DBに不正値が入った場合（手動操作・移行ミス）に型が嘘をつき、実行時まで気づけない。列挙の追加時にキャスト箇所の網羅確認が必要
- **修正方針**: 選択肢は2つ。①読み取り境界で `lib/schemas/enums.ts` の zod で `parse`（不正値を AppError 化・フェイルクローズ）②Postgres enum 型に寄せて database.types に列挙を生成させる（スキーマ変更を伴うためプランモード案件）。①が軽い

### T-2. （良好な点）`as any`・`@ts-ignore` ゼロ・非nullアサーション1箇所

- 対応不要。現状の健全性の記録として

---

## 未使用コード

### U-1. `lib/actions/manuscripts.ts:185` `getSuggestions` — 参照ゼロの Server Action

- **優先度: Medium**（未使用コードだが Server Action は公開POST境界のため、削除はセキュリティ面の縮小も兼ねる）
- **該当**: エクスポートされているがアプリ内から一切参照されていない（ts-prune＋grep で確認）
- **修正方針**: 削除。履歴に残るのでいつでも戻せる

### U-2. `lib/schemas/*` の未参照型エイリアス 約25件

- **優先度: Low**
- **該当**: `NoteInput`・`ProposalInput`・`ReviewSessionInput` 等、`z.infer` の型エクスポートでスキーマ本体は使用中・型だけ未参照のもの（ts-prune 一覧より。`ChatContext`・`ProofreadSuggestion` 等も同様）
- **修正方針**: まとめて削除（または「スキーマとペアの型は残す」規約を明文化して対応しない）。どちらでも可・判断だけ残す

### U-3. `lib/ai/personas.ts` の標準ID定数群 — **対応しない候補**

- **優先度: —（判断の明文化のみ）**
- **該当**: 標準ペルソナ・プロファイルの固定UUID定数の大半が TS からは未参照。ただしファイル冒頭コメントのとおり**マイグレーションシードとの対応台帳**として意図的に置かれている
- **修正方針**: 削除しない。ts-prune 等を今後導入する場合は ignore 指定

---

## 分類外: 堅牢性・パフォーマンス（計画の段階4「パフォーマンス」の材料）

すでに dev-log（セッション85）と回帰テスト（セッション88）で観察済みの事項を、レビュー結果として正式に収載する。

- **P-1**: レビュー実行時、初回トークンまで約35〜40秒スピナーのみ（大入力＋高精度モデル起因。途中離脱で生成中断）— 進行表示・ストリーミング前のフィードバック検討
- **P-2**: AI 生成が空文字で終わると保存もエラー表示もない無音失敗経路（`/api/review` route の `if (!text)`）— エラートースト化
- **P-3**: 構成レビューの文字数ガードが全シーンを数える一方プロンプトはジャンルで絞る不整合＋過去フィードバック履歴がガード対象外で反復ごとに入力肥大
- **P-4**: `githubFetch` にリトライなし。dev サーバー長時間稼働時の stale keep-alive（UND_ERR_SOCKET）で講評・イラスト資料読みが500になる事象を回帰テストで実測（本番サーバーレスでは起きにくいが、冪等な GET に限る1回リトライは安価な保険）

---

## 優先的に着手すべき Top 3（段階分割へのマッピング案）

計画書 Step 1 の段階（構造整理→重複統合→型・エラーハンドリング→パフォーマンス）に沿って:

1. **R-2**（構造整理・低リスク初手）: actions/editor.ts のファイル分割。typecheck が保証する純粋移動
2. **D-1＋D-2**（重複統合の本丸）: Git コンテキスト解決の共通化。Step 2 セキュリティレビューの監査面も縮む——**Step 2 の前にやる価値が高い**
3. **T-1①＋U-1＋D-3**（型・小粒まとめ）: enum キャストの zod 化・未使用 Server Action 削除・jstDate 統一

**R-1（vertical-editor 分割）は効果最大だがリスクも最大**。8/12以降は運用期間である事情も踏まえ、「今回のスコープに含めるか」自体をユーザー判断としたい。N-2（フォーマッタ導入）も同様に判断事項。

## 良かった点

- `as any`・`@ts-ignore`・TODO/FIXME が完全にゼロ。lint 新ルールへの追随（react-hooks/refs 等）も済んでいる
- Server Action の `try/catch → toActionError` と `ActionResult` 型・`AppError` の使い分けが全ファイルで統一されており、エラー処理の規約逸脱が見つからなかった
- 境界防御の一貫性は前回レビューから維持（クライアント指定値のサーバー再検証・RLS 依存の所有確認・パス検証の多層防御）
- コンポーネント命名（Dialog/Panel/Card/List 接尾辞）は一貫しており、命名問題は関数動詞とクォートに限られる
