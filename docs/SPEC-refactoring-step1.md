# SPEC: 締めくくり作業 Step 1 リファクタリング（段階実施計画）

- **入力**: `docs/code-review-20260812.md`（Step 1 前半のレビュー結果）
- **スコープ決定**: 2026-08-12 ユーザー承認「全部入り」= Top 3（R-2 / D-1+D-2 / 型・小粒）＋ R-1（vertical-editor 分割）＋ N-2（フォーマッタ導入）
- **原則**: 挙動変更ゼロ（リファクタリングのみ）。1段階 = 1ブランチ = 1PR = 人間のマージ承認。各段階後に `docs/TESTING.md` の関連節で回帰テスト。段階の途中でスコープを追加しない
- **本番反映**: すべて PR 経由（main 直 push なし）。認証・RLS・秘密情報に触れる段階（段階2）は security-reviewer を通す

## 段階一覧（実施順）

| 段階 | 対象 | リスク | 回帰テスト範囲 |
|---|---|---|---|
| 0 | N-2: フォーマッタ導入・一括適用 | 低（機械的） | §1 静的検査＋ビルド＋スモーク |
| 1 | R-2: `lib/actions/editor.ts`（1,079行）のファイル分割 | 低 | §1＋§8 エディタ主要経路 |
| 2 | D-1＋D-2: Git コンテキスト解決の共通化（11ファイル） | 中 | §1＋§7/§8/§11 の GitHub 系経路 |
| 3 | 型・小粒まとめ: T-1①（enum キャストの zod 化）・U-1（未使用 Server Action 削除）・D-3（jstDate 統一）・N-1縮小（同名衝突解消）・P-2/P-4（無音失敗のエラー表示・githubFetch の冪等GETリトライ） | 低〜中 | §1＋各該当節のスポット確認 |
| 4 | R-1: `components/editor/vertical-editor.tsx`（1,757行）の分割 | 高 | §1＋**§8 全項目** |

### 段階0: フォーマッタ導入（N-2）

- prettier を devDependencies に追加。設定は**デフォルト**（`.prettierrc` は空オブジェクト相当・設計原則「最もシンプル」）。現状の多数派（double quote＋セミコロン・94ファイル）とも一致する
- `package.json` に `format` / `format:check` スクリプトを追加
- 全ファイル一括適用を**単独コミット**にし、コミットSHAを `.git-blame-ignore-revs` に登録
- 完了条件: `npx prettier --check .` がパス・typecheck / lint / build がグリーン・ペインでダッシュボード表示スモーク

### 段階1: actions/editor.ts の分割（R-2）

- `lib/actions/editor/` 配下へ関数シグネチャ不変のまま移動: `workspace.ts`（コンテキスト・章一覧）/ `chapters.ts`（開閉・保存・新規）/ `book-settings.ts`（config・テーマ・奥付）/ `assets.ts`（画像）/ `build.ts`（タグ・ビルド状態）/ `branch.ts`（ブランチ・PR）を目安に、実装を見て自然な境界で分割
- 既存 import パスは `lib/actions/editor.ts` を re-export ファサードとして残すか、呼び出し側を一括更新するか、分割時に差分の小さい方を選ぶ
- 完了条件: typecheck / lint グリーン・§8 の主要経路（章一覧→開く→保存・書籍設定・ビルドダイアログ表示・ブランチメニュー）が動作

### 段階2: Git コンテキスト解決の共通化（D-1＋D-2）

- `lib/git/project-context.ts`（仮）に `loadProjectGitContext(projectId, opts)` を新設: auth 確認→ projects RLS 取得→ repo ゲート（opts.requireRepo）→ PAT 復号→ base_path 正規化（`?? ''`・末尾 `/` 除去）を一元化
- 乗せ替え対象: lib/actions の editor（分割後）・critique・manuscripts・zenn・repo-setup・settings ＋ app/api の review・proofread・illustration/propose・editor/asset・editor/build-asset
- **PAT・認可境界に触れるため security-reviewer 必須**
- 完了条件: typecheck / lint グリーン・§7（原稿・校正・講評）§8（保存）§11（Zenn）の実経路確認・security-reviewer 通過

### 段階3: 型・小粒まとめ

- T-1①: DB 文字列列→union の `as` キャストを、読み取り境界で `lib/schemas/enums.ts` の zod `parse` に置換（不正値はフェイルクローズ）。Postgres enum 化（案②）はスキーマ変更のため**今回はやらない**
- U-1: `getSuggestions`（参照ゼロの Server Action）を削除
- D-3: `lib/date.ts` 新設・`jstDate` 3実装＋`backupStamp` を統一
- N-1縮小: `getManuscriptTree`（lib/actions/manuscripts.ts）を改名し lib/git/github.ts との同名衝突を解消（全面的な動詞統一は**やらない**）
- P-2: `/api/review` の空文字終了を日本語エラートースト化（挙動変更だがフェイルクローズ方向のみ）
- P-4: `githubFetch` の冪等 GET に限り1回リトライ（POST/PUT/DELETE は対象外）
- U-2（未参照型エイリアス）: 削除はせず「zodスキーマとペアの型は残す」を規約としてコメント明文化のみ。U-3（personas 台帳）: 対応しない（決定済み）
- 完了条件: typecheck / lint グリーン・校正/講評/エディタ保存のスポット確認

### 段階4: vertical-editor.tsx の分割（R-1）

- custom hooks 抽出を基本に、1PR = 1〜2抽出で複数PRに分ける: `useDraftStore`（IndexedDB待避）/ `useBranchState`（ブランチ・PR）/ `useBuildFlow`（ビルド・ポーリング）/ `useEditorComments`・字数 / プレビュー連携、の順を目安に実装を見て決める
- 各PRごとに §8 の関連項目で回帰。**最終PR後に §8 全項目を一周**
- lint 新ルール（react-hooks/refs・set-state-in-effect）の既知の罠に注意（dev-log の定石参照）
- 完了条件: 分割後も §8 全項目グリーン・vertical-editor.tsx が目安 800 行以下

## やらないこと（今回のスコープ外）

- 動詞 prefix の全面統一（N-1 の全体）・R-3（中規模モノリス）・P-1（初回トークン待ち UX）・P-3（文字数ガード設計）→ 必要なら個別 Issue で
- Postgres enum 化（スキーマ変更）・機能追加・挙動変更（P-2/P-4 のフェイルクローズ強化を除く）

## リスクと中断基準

- 各段階で回帰テストが NG になったら、修正できるまで次の段階に進まない（二失敗ルール適用: 同一アプローチで2回失敗したら手を止めて相談）
- 段階4は運用期間（8/12〜）のコード凍結原則との緊張が最も大きい。段階3まで完了した時点で、段階4の着手前にユーザーへ進捗と残リスクを報告し、続行判断を仰ぐ
