# SPEC 索引

機能仕様（`docs/SPEC-*.md`）の一覧と、**SPEC を策定せずに実装した機能の記録先**。
実装に着手する前に、対応する SPEC をここから引く（CLAUDE.md「SPEC参照」）。

作成: 2026-08-12（締めくくり作業 Step 3）

## SPEC の読み方

- **本文は策定当時（着手前）の設計の記録**であり、現在の実装仕様と1対1ではない。第二期は「着手前に SPEC を書き、新しいセッションで実装する」流儀を採ったため、SPEC は時点の文書として保存している
- 後から決定が変わった箇所は、各 SPEC の冒頭にある **「改訂:」行**（日付＋Issue番号＋要点）と、本文中の**取り消し線**が示す。取り消し線のある「スコープ外」項目は、その後実装されたもの
- 現在の実装が知りたい場合の一次資料は、**スキーマ = `supabase/migrations/`（29本）／挙動 = コード／経緯 = `docs/dev-log.md`**

---

## 1. 基盤・構想フェーズ

| SPEC | 策定 | 対象 |
|---|---|---|
| [SPEC-auth](SPEC-auth.md) | 07-12 | Google OAuth・許可リスト2層ゲート・セッション永続・RLS方針 |
| [SPEC-notes](SPEC-notes.md) | 07-12 | ノート（手帳→プロットモデル）・タグ・テンプレート挿入・ごみ箱。版履歴／エクスポート／表・画像・添付を後から昇格 |
| [SPEC-ai-deep-dive](SPEC-ai-deep-dive.md) | 07-13 | AI基盤（Vercel AI SDK・capability→モデル解決）＋ノートの掘り下げパネル |

## 2. 企画・設計フェーズ

| SPEC | 策定 | 対象 |
|---|---|---|
| [SPEC-proposal-review](SPEC-proposal-review.md) | 07-13 | プロジェクト・企画書・**レビュー基盤**（review_sessions / review_feedbacks・判定・ゲート） |
| [SPEC-beat-board](SPEC-beat-board.md) | 07-13 | ビートボード（4部構成・転換点アンカー・D&D・感情の起伏）・構成/シーンレビュー |
| [SPEC-character-review](SPEC-character-review.md) | 07-14 | キャラクターレビューの実行UI。§9 でノート1枚単位のレビューを追加 |
| [SPEC-structure-templates](SPEC-structure-templates.md) | 07-31 | 構成テンプレート6種（4部構成・三幕・ストラクチャー式・Save The Cat・ヒーローズジャーニー・ストーリー解剖学） |
| [SPEC-outline-board](SPEC-outline-board.md) | 07-25 | 目次ボード（非小説ジャンル。scenes を `part='chapter'` で共用） |
| [SPEC-review-history](SPEC-review-history.md) | 07-27 | レビュー履歴の一覧・閲覧（`/projects/[id]/reviews`） |
| [SPEC-board-chapters](SPEC-board-chapters.md) | 08-30 | 章の導入（`scenes.kind` の章マーカー行）と、目次ボードとの仕組みの統一 |

## 3. 原稿・校正フェーズ

| SPEC | 策定 | 対象 |
|---|---|---|
| [SPEC-proofreading](SPEC-proofreading.md) | 07-13 | GitHub連携（PAT暗号化・`GitCredentialProvider`）・原稿タブ・AI校正・提案の受入/拒否/保留・書き戻し |
| [SPEC-proofread-selection](SPEC-proofread-selection.md) | 07-24 | 縦書きエディタでの選択範囲校正（範囲内 pending のみ置き換え・SHA非更新） |
| [SPEC-manuscript-history](SPEC-manuscript-history.md) | 08-09 | 原稿タブのコミット履歴・差分ビュー（行単位＋行内文字ハイライト） |
| [SPEC-repo-setup](SPEC-repo-setup.md) | 07-24 | 原稿リポジトリの初期セットアップ（テンプレートを GitHub API で1コミット展開） |
| [SPEC-manuscript-bridge](SPEC-manuscript-bridge.md) | 08-30 | 構成→執筆の橋渡し（ボードからの原稿ファイル生成・執筆進捗・シーンへの逆引き） |

## 4. 縦書きエディタ（親SPEC＋フェーズ別）

| SPEC | 策定 | 対象 |
|---|---|---|
| [SPEC-vertical-editor](SPEC-vertical-editor.md) | 07-16 | **親SPEC**。「エディタで組版しない」コンセプト・VFM・Vivliostyle委譲・フェーズ計画 |
| [phase2](SPEC-vertical-editor-phase2.md) | 07-16 | 2ペインエディタ（CodeMirror＋Vivliostyle Viewer）・保存＝コミット・IndexedDB待避・競合マージ |
| [phase3](SPEC-vertical-editor-phase3.md) | 07-16 | 快適性（コメント一覧・ルビ/傍点/縦中横の入力補助・画像D&D・書籍設定フォーム・入稿ビルドUI） |
| [phase4](SPEC-vertical-editor-phase4.md) | 07-17 | ネコノテ連携（相互リンク・校正の保留提案／講評のコメント書き戻し） |
| [phase5](SPEC-vertical-editor-phase5.md) | 07-23 | ブランチ切替・作成・PR作成 |
| [SPEC-aozora-export](SPEC-aozora-export.md) | 07-30 | 青空文庫／カクヨム／なろう形式への書き出し |

## 5. AIエージェント・対話・設定

| SPEC | 策定 | 対象 |
|---|---|---|
| [SPEC-dashboard-critique-settings](SPEC-dashboard-critique-settings.md) | 07-14 | ダッシュボード・プロファイル選択UI・講評（作品全体）・設定画面（ペルソナ/プロファイルCRUD・モデルマッピング） |
| [SPEC-conversational-personas](SPEC-conversational-personas.md) | 07-14 | 対話型ペルソナ（相談パネル・スケジュール提案・ノートに保存） |
| [SPEC-chat-thread-list](SPEC-chat-thread-list.md) | 07-14 | ダッシュボード相談の複数スレッド化と `/chats` 一覧 |
| [SPEC-schedule-and-memo-tools](SPEC-schedule-and-memo-tools.md) | 07-14 | AIツール呼び出し（`saveSchedule` / `saveMemoNote`）・§9 マイルストーン締切リマインドメール |
| [SPEC-illustrator](SPEC-illustrator.md) | 07-17 | アトリエ（イラスト生成・2段階フロー・ギャラリー）。§9 で参照画像アップロード |

## 6. 汎用執筆支援・その他

| SPEC | 策定 | 対象 |
|---|---|---|
| [SPEC-genre](SPEC-genre.md) | 07-25 | 執筆ジャンル・執筆目的の基盤（`proposals.writing_genre` / `purpose`） |
| [SPEC-genre-profiles](SPEC-genre-profiles.md) | 07-25 | ジャンル別ペルソナ・プロファイルとジャンル優先ソートによる既定選択 |
| [SPEC-zenn-integration](SPEC-zenn-integration.md) | 07-25 | Zenn 記事の執筆・投稿（`/zenn/new`）。§11 で画像アップロード |
| [SPEC-refactoring-step1](SPEC-refactoring-step1.md) | 08-12 | 締めくくり作業 Step 1 のリファクタリング段階計画（機能仕様ではない） |

---

## 7. SPEC を策定せずに実装した機能

CLAUDE.md は「仕様が存在しない機能は先に仕様策定を提案する」と定めているが、以下は SPEC を作らずに実装した。いずれも**設計判断は Issue と dev-log に残っている**ため、遡って SPEC は書かない（締めくくり作業 Step 3 で決定）。改修時はここから記録を引く。

| 機能 | 実装 | 記録の所在 |
|---|---|---|
| **AI使用量の計測**（`ai_usage_logs`・`ai_usage_summary(days)`・設定画面の直近30日テーブル） | 07-18 | Issue #45／`20260718000001_ai_usage_logs.sql` |
| **グローバルナビ＋エディタ集中モード**（`app/(app)/` ルートグループ化を伴う16ファイル改修） | 07-18 | dev-log セッション㊶（Issue非経由。チャット相談→プランモードで設計合意） |
| **ノート一覧のソート切替** | 07-19 | Issue #85・PR #86／dev-log セッション㊽ |
| **ノートの Markdown 一括エクスポート**（ZIP・frontmatter付き） | 07-23 | Issue #38・PR #112／dev-log セッション58 |
| **ノートの版履歴**（時間ベース間引きスナップショット） | 07-23 | Issue #111／`20260723000004_note_versions.sql` |
| **エディタの横書き対応**（テーマ追従の自動判定） | 07-23 | Issue #97・PR #116／dev-log セッション61 |
| **EPUB 出力**（`v*-epub` タグ・`build-epub.yml`・EPUB専用テーマ） | 07-24 | Issue #119・PR #120／dev-log セッション64（設計3点を AskUserQuestion で確定） |
| **企画書の版管理・差分表示** | 08-09 | Issue #64・PR #168／`20260809000001_proposal_versions.sql`／dev-log セッション83 |

※ ノートの版履歴・企画書の版管理・EPUB出力は、それぞれ親にあたる SPEC（SPEC-notes / SPEC-proposal-review / SPEC-vertical-editor）の冒頭「改訂:」行からも辿れる。

---

## 8. SPEC ではない設計・運用ドキュメント

| ドキュメント | 内容 |
|---|---|
| [要求仕様](ネコノテAI_第二期_要求仕様ドキュメント.md) | 第二期の目的・第一期の問題点6件・機能要件・非機能要件。§9 に実装での拡張の追補 |
| [実装計画](ネコノテAI_第二期_実装計画.md) | スプリント計画・ER図（策定時Draft）・画面一覧。§8 に後日談 |
| [Claude Code 運用計画](claude-code-operation-plan.md) | CLAUDE.md / skills / hooks / subagents の分業構成・Issue駆動フロー。§7 に後日談 |
| [締めくくり作業計画](ネコノテAI_第二期_締めくくり作業計画.md) | 開発完了後の Step 0〜8 |
| [TESTING.md](TESTING.md) | 全機能の回帰テストチェックリスト |
| [manual.md](manual.md) | ユーザーマニュアル |
| [dev-log.md](dev-log.md) | セッション単位の開発記録（**実装経緯の一次資料**） |
| [第一期・第二期比較.md](第一期・第二期比較.md) | 第一期との比較（規模・機能・品質・開発の進め方）＋**第二期の KPT** |
| [第三期引き継ぎメモ.md](第三期引き継ぎメモ.md) | シリーズ機能の確定済み設計6点と、第三期マイルストーンの棚卸し |
| [dev-story/](dev-story/README.md) | 開発記録の章単位ドラフト（技術書典21 向け書籍の素材） |
| [incident-log.md](incident-log.md) | 障害記録（INC採番） |
| [doc-audit-20260812.md](doc-audit-20260812.md) | ドキュメント突き合わせ結果（Step 3） |
| security-audit / code-review（日付つき） | セキュリティ監査・コードレビューの記録 |
| `.claude/skills/` | `story-engineering` / `draft-to-clean-model` / `review-profiles`（知識）・`fix-issue`（ワークフロー） |
