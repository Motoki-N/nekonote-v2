# 🐱 ネコノテAI（第二期）実装計画

作成日：2026年7月11日
バージョン：v2（2026-07-13 スケジュール改訂）
前提ドキュメント：ネコノテAI（第二期）要求仕様ドキュメント

---

## 1. ゴールとスケジュール前提

- **8/1（土）**：運用開始 — 実際の執筆準備（構想・企画・設計）に使い始められる状態
- **8/11（水・山の日）**：開発仕上げ — 全機能（校正フェーズ含む）が揃った状態
- 本日が7/11のため、**運用開始まで21日間**。全機能を8/1に揃えるのは依然難しいため、**「執筆プロセスの進行順」に機能を届ける**戦略を取る

### 7/13 改訂の前提（v2）

- Sprint 0・Sprint 1 が **7/13 時点で完了**（元計画の Sprint 1 完了予定 7/20 に対し約1週間先行）
- **Claude Fable 5 の無償利用が 7/20 午後（JST）まで**。以降はモデルが変わる前提
- **7/17（金）〜7/20（月・海の日）が4連休**で集中開発可能
- → 方針：**モデル性能が効く重量級タスク（レビューゲート・ビートボードD&D・GitHub連携＋AI校正・SPECインタビュー）を 7/20 までに前倒し**し、定型的な仕上げ（ダッシュボード・設定UI・UX改善）を 7/20 以降に残す

### 段階的リリースの考え方
ユーザー（開発者本人）の12月COMITIA向け執筆は「構想→企画→設計→執筆→校正」の順に進む。アプリの機能も同じ順で完成させれば、**常に執筆プロセスの一歩先を開発が走る**形になり、8/1時点で校正フェーズが未完成でも運用を開始できる（校正が必要になるのは執筆が進んだ後のため）。

| リリース | 期日 | 使えるようになること |
|---|---|---|
| R1（運用開始） | 8/1 | 構想（ノート・タグ）＋企画（企画書・担当編集レビュー）＋設計（ビートボード・構成/シーンレビュー） |
| R2（仕上げ） | 8/11 | 校正（GitHub連携・AI校正・修正提案フロー）＋対話型ペルソナ全員＋ダッシュボード充実 |

---

## 2. 開発の基本方針

1. **縦に通す**：機能単位（構想→企画→設計→校正）で、UI→API→DB→AIまで一気通貫で完成させてから次へ。横展開（全画面の骨組みを先に作る等）はしない
2. **基盤は最初に固める**：認証・DBスキーマ・テーマ変数・エラーハンドリングはSprint 0で確定させる（第一期の「後付けで崩壊」の再発防止）
3. **毎日デプロイ**：その日の成果をVercelにデプロイして動作確認してから終了（「デプロイしたら寝る」ルール継続）
4. **スキーマファースト**：ER図 → Supabaseマイグレーション → Zodスキーマ → TypeScript型の順で、実装前にデータ構造を確定
5. **YAGNI**：パフォーマンス最適化・仮想化リストはMVPでは実装しない

---

## 3. データモデル（ER図 Draft）

```mermaid
erDiagram
    users ||--o{ notes : owns
    users ||--o{ projects : owns
    notes }o--o{ tags : "note_tags"
    projects ||--o| proposals : has
    proposals }o--o{ notes : "proposal_notes"
    projects ||--o{ scenes : has
    projects ||--o{ review_sessions : has
    personas ||--o{ review_profiles : "default担当"
    review_profiles ||--o{ review_sessions : uses
    review_sessions ||--o{ review_feedbacks : contains
    projects ||--o{ manuscript_links : has
    manuscript_links ||--o{ revision_suggestions : has
    projects ||--o{ writing_progress : has

    notes {
        uuid id PK
        uuid user_id FK
        text title
        text content "Markdown"
        timestamptz created_at
        timestamptz updated_at
    }
    tags {
        uuid id PK
        uuid user_id FK
        text name
        text kind "category | working_title"
    }
    projects {
        uuid id PK
        uuid user_id FK
        text title
        text status "planning|writing|editing|completed"
        int target_pages
        date deadline
        text event_name
        text repo "原稿リポジトリ"
        text base_path "リポジトリ内パス"
    }
    proposals {
        uuid id PK
        uuid project_id FK
        text genre
        text target_audience
        text content "Markdown（コンセプト/キャラ/テーマ）"
        text status "draft|in_review|approved"
    }
    scenes {
        uuid id PK
        uuid project_id FK
        text part "setup|response|attack|resolution"
        text anchor "pp1|pinch1|midpoint|pinch2|pp2|null"
        int order_index "ボード上の並び順"
        text title
        text content "状況/出来事/葛藤 自由記述"
        text emotion_start "plus|minus"
        text emotion_end "plus|minus"
    }
    personas {
        uuid id PK
        text name
        text description "性格・口調・スタンス"
        text ai_capability "high|medium|low"
        text reference_scope
        text persona_type "review|dialogue"
        bool is_default
    }
    review_profiles {
        uuid id PK
        text name
        text target_phase "proposal|character|structure|scene|proofreading"
        text prompt_template
        uuid default_persona_id FK
        bool is_default
    }
    review_sessions {
        uuid id PK
        uuid project_id FK
        uuid review_profile_id FK
        uuid persona_id FK "実際に起用したペルソナ"
        text target_ref "レビュー対象（proposal id / scene id / 原稿パス）"
        text status
        timestamptz created_at
    }
    review_feedbacks {
        uuid id PK
        uuid review_session_id FK
        text content "AIからのフィードバック"
        text user_response "ユーザーの返答・改稿メモ"
    }
    manuscript_links {
        uuid id PK
        uuid project_id FK
        text file_path
        text last_reviewed_commit
    }
    revision_suggestions {
        uuid id PK
        uuid manuscript_link_id FK
        text granularity "sentence|scene"
        text original_text
        text suggested_text
        text reason
        text status "pending|accepted|rejected|on_hold"
        text committed_sha "コミット後に記録"
    }
    writing_progress {
        uuid id PK
        uuid project_id FK
        date date
        int total_chars "Git取得原稿から集計"
    }
```

**設計メモ**
- `ai_model_settings`（能力レベル→provider/model_idのマッピング）と`user_settings`（GitHub PAT暗号化保管、テーマ設定）は独立した設定系テーブルとして別途定義
- チャット履歴（対話型ペルソナ用）は`chat_threads`/`chat_messages`として追加予定。R3で詳細化
- 第一期の`characters`/`chapters`等の構造化テーブルは**作らない**（ノート＋テンプレートで代替）

---

## 4. 画面一覧（Draft）

| # | 画面 | 主な機能 | リリース |
|---|---|---|---|
| 1 | ログイン | Google認証 | R1 |
| 2 | ダッシュボード | プロジェクト一覧、進捗サマリー、今日のスケジュール | R1(簡易)→R2 |
| 3 | ノート一覧/検索 | タグ・仮タイトル絞り込み、全文検索 | R1 |
| 4 | ノートエディタ | Markdown編集、タグ付け、テンプレート挿入（プロットに落とし込む）、AI掘り下げ | R1 |
| 5 | プロジェクト作成/設定 | イベント・目標・締切・リポジトリ設定 | R1 |
| 6 | 企画書エディタ | 定型フォーマット編集、ノート紐づけ、担当編集レビュー（ゲート） | R1 |
| 7 | ビートボード | 4レーン＋転換点アンカー、シーンカードD&D、感情の起伏表示 | R1 |
| 8 | レビュー画面 | レビューセッション実行・履歴、フィードバック⇄返答 | R1 |
| 9 | 校正ワークスペース | 原稿読み込み、AI校正実行、提案の受入/拒否/保留、コミット | R2 |
| 10 | チャット（対話型ペルソナ） | アシスタント/マスターとの会話、メモ化 | R2（R1で簡易版検討） |
| 11 | 設定 | AIモデルマッピング、ペルソナ/プロファイル編集、GitHub PAT、テーマ | R1(最小)→R2 |

---

## 5. スプリント計画（v2：7/13改訂）

### Sprint 0：基盤構築 ✅ 完了（7/11〜7/12）
- リポジトリ作成、Next.js + TypeScript + shadcn/ui + Supabase + Vercel セットアップ
- **認証**：Supabase Auth（Google）をセッション管理含めて最初に実装・検証
- **テーマ**：next-themes + CSS変数でライト/ダーク切り替えの土台
- DBスキーマ全体（16テーブル＋RLS）をマイグレーション化、Zodスキーマ＋型生成、AppError＋共通ハンドラー
- ✅ 完了条件達成：ログインでき、テーマが切り替わる空アプリがVercelで動く

### Sprint 1：構想フェーズ ✅ 完了（7/12〜7/13）
- ノートCRUD、Tiptapエディタ（Markdown保存）、タグ付け、絞り込み一覧、ごみ箱
- テンプレート挿入機能（標準テンプレ4件シード）
- Vercel AI SDK（v7）導入、`ai_model_settings`解決、AI掘り下げ支援（サイドパネル・履歴DB保存）
- ✅ 完了条件達成：Notionの代わりにネコノテでネタメモが取れる

### Sprint 2：企画フェーズ＋レビュー基盤（7/13〜7/16）
- 7/13（月）：SPECインタビュー（企画書エディタ＋レビュー基盤）。余力があればプロジェクトCRUD実装まで
- 7/14（火）：プロジェクトCRUD＋企画書エディタ（定型フォーマット、ジャンル/ターゲット層、ノート紐づけ）
- 7/15（水）：ペルソナ＋レビュープロファイルのシード（reviewer 4人）＋レビューセッションのゲートフロー
- 7/16（木）：E2E検証・デプロイで完了。**夜に Sprint 3 のSPECインタビュー（ビートボード）を前倒し実施**
- 平日のため無理をしない。7/16に終わらなくても、レビューゲートの反復部分だけ7/17朝に回せば連休計画は崩れない
- ✅ 完了条件：企画書を書いて担当編集のレビューゲートを回せる

### Sprint 3：設計フェーズ（7/17〜7/19）★R1相当を前倒し達成
- 7/17（金・休）：ビートボード実装 Day1（スキーマ承認→dnd-kitのD&D基盤）。**最大リスクを連休初日に置く**
- 7/18（土・休）：ビートボード完成（4レーン＋転換点アンカー、スマホ縦積み）＋シーンカード編集＋構成/シーンレビュー
- 7/19（日・休）：E2E検証・デプロイで完了 = **R1相当を7/19に達成**（元計画比 約2週間前倒し）。**夜に Sprint 4 のSPECインタビュー（GitHub連携）を前倒し実施**
- ✅ 完了条件：実際のCOMITIA作品の構想・企画・設計を始められる（運用開始は8/1を待たず前倒し可）

### Sprint 4：校正フェーズ・前半（7/20）＋後半（7/21〜）
- 7/20（月・休）：**Fable 5 最終日（午後まで）**。核となる縦通し — PAT登録（暗号化保存）、`GitCredentialProvider`抽象化、原稿読み込み、AI校正実行 — をできるところまで
- 7/21以降（通常ペース）：修正提案の受入/拒否/保留フロー、確定分のまとめてコミット、進捗管理（文字数集計・日次記録）
- ✅ 完了条件：ダミー原稿でレビュー→コミットの一連の流れが通る

### Sprint 5：仕上げ（Sprint 4完了後〜8/11）★R2リリース
- 対話型ペルソナ完成（アシスタントのスケジュール提案、マスターのメモ化、読者代表・書店員のレビュー）
- ダッシュボード充実、設定画面完成（ペルソナ/プロファイル編集UI、AIモデルマッピング）
- 不具合修正・UX改善のバッファ（前倒し分がそのままバッファになる）
- ✅ 完了条件：**8/11開発仕上げ**。全ペルソナ・全フェーズが動作

### 7/20までの日次リズム（補足）

- 各SPECインタビューは**前日夜**に実施し、連休中の昼間を実装に全振りする（インタビュー→SPEC確定→翌朝新セッションで実装、の流儀は維持）
- 「デプロイしたら寝る」ルールは継続：毎日 typecheck / lint / E2E → 本番デプロイで締める
- 複雑な設計判断・難所のデバッグは、モデルが変わる7/20午後までにできる限り踏み抜いておく

---

## 6. Claude Code運用方針

- **CLAUDE.md**に以下を明記：技術スタックと規約、DBスキーマ、テーマ変数ルール、エラーハンドリング規約、コミット規約（feat/fix/refactor）、「スキーマ変更は必ずマイグレーションで」
- **日次リズム（5時間タイマー）**：
  - 朝7時：今日のスプリントタスクを指示（挨拶だけでもOK）
  - 昼13時：進捗確認・バグ修正指示
  - 夜18時：動作確認・デプロイ・翌日の準備
- **指示の単位**：1指示=1機能（縦切り）。大きな機能は「スキーマ→API→UI」の3段階に分割
- 日報を記録し、スプリント終了ごとに簡易レポート（技術書典の原稿ネタとして蓄積）

---

## 7. リスクと判断基準

| リスク | 兆候 | 対処 |
|---|---|---|
| Sprint 2が連休前に終わらない | 7/16夜時点でレビューゲート未完 | 反復ゲート部分のみ7/17朝に回す（ビートボード開始を半日遅らせる範囲まで許容）。それ以上なら企画書レビューを「1回きりのフィードバック」に簡略化し反復ゲートはR2へ |
| ビートボードのD&Dが難航 | **Fable期間中（〜7/20）は1日詰まったら縮退判断**（期間内の1日の価値が高いため。7/21以降は従来どおり3日） | リスト形式（並び替えのみ）に縮退し、2次元ボードはR2以降へ |
| GitHub連携の認可/差分処理が複雑化 | Sprint 4前半で読み込みが通らない | 原稿の手動アップロード（ファイル貼り付け）を暫定手段として先に作る |
| AI応答の品質不足 | レビューが的外れ | プロンプト（レビュープロファイル）の改善を優先。モデル変更は設定で即試せる |
| 認証がまた不安定 | セッション切れ再発 | Sprint 0で検証済みのはずだが、再発したら他機能を止めてでも最優先で修正 |

**共通ルール**（キックオフドキュメントより）：同じ問題に2時間で切り替え検討、同種エラー3回で設計見直し、締切1/3経過で未着手機能はスコープカット。v2では前倒し目標（7/19 R1相当）に対する判断ポイントを **7/18昼**（ビートボード未完なら縮退）とし、8/1運用開始のセーフティネットは従来どおり7/25に維持。

---

*v2（2026-07-13）：Sprint 0・1 の早期完了と Claude Fable 5 無償期間（〜7/20午後）・4連休（7/17〜20）をふまえ、スプリント日程を前倒し改訂。承認済み。*
