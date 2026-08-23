# ネコノテAI 運用ランブック（RUNBOOK）

第二期の運用・保守手順書。**半年後の自分、あるいは引き継いだ第三者が、この1冊で運用を回せる**ことを目標にしている。

- 対象読者: 本アプリの運用担当（＝開発者本人、または引き継いだ人）
- ユーザー向けの使い方は [manual.md](manual.md)、機能仕様は [SPEC-index.md](SPEC-index.md) を参照
- 作成: 2026-08-12（締めくくり作業 Step 4）

## 0. 前提と作法

### 0.1 このリポジトリは public

**手順書に実値・実識別子を書かない。** 具体的には以下を本ドキュメントおよびコミット・PR に含めない（CLAUDE.md の規約）。

- 秘密情報の実値（APIキー・トークン・接続文字列）
- 実メールアドレス、私的リポジトリ名、未公開作品の実タイトル
- インフラ識別子（Supabase プロジェクト ref・Vercel チームスラッグ・デプロイID）

言及が必要な場合は伏せ字（`<project-ref>` / `<team-slug>` / `<owner>/<manuscripts-repo>` / `dpl_xxx`）を使う。

### 0.2 秘密情報を扱うときの作法

過去に実害が出た事故の教訓（[incident-log.md](incident-log.md)・[dev-log.md](dev-log.md)）から、以下を徹底する。

| 作法 | 理由 |
| --- | --- |
| **存在確認は `grep -c '^KEY=' .env.local`**（値を出力しない） | `awk`・`cat` での抽出は端末ログ・スクロールバックに残る |
| **curl の疎通確認は環境変数経由**で渡す（値を直接タイプしない） | シェル履歴に残る |
| **`.env.local` への追記は末尾改行を確認してから**（`tail -c 1 .env.local`） | 改行がないと最終行に連結してキーが壊れる（実際に `ANTHROPIC_API_KEY` を破損させ401にした） |
| **ログ出力を貼る前に秘密が混じっていないか確認** | Next.js dev の Server Action ログは引数を平文出力する（`next.config.ts` の `logging: { serverFunctions: false }` で恒久停止済み。**この設定を外さないこと**） |
| **外部サービスのダッシュボード操作は人間が行う** | CLI で完結しない操作の自動化は事故率が高い |

### 0.3 前提ツール

```bash
npx supabase --version && npx vercel --version && gh --version
```

- Supabase CLI: `npx supabase link --project-ref <project-ref>` 済みであること（プロジェクト ref は `supabase/.temp/project-ref` にある）
- Vercel CLI: `npx vercel link` 済みであること
- GitHub CLI: `gh auth status` が通ること

---

## 1. システム構成と依存サービス

```
      ┌─────────────────────────────────────────────┐
      │  Vercel（Next.js App Router・本番／Preview）  │
      │   ├─ アプリ本体                              │
      │   └─ Vercel Cron → /api/cron/milestone-...  │
      └───┬──────────┬──────────┬──────────┬────────┘
          │          │          │          │
    ┌─────▼────┐ ┌───▼────┐ ┌───▼─────┐ ┌──▼──────┐
    │ Supabase │ │ AI 3社  │ │ GitHub  │ │ Resend  │
    │ DB/Auth/ │ │Anthropic│ │ 原稿repo│ │ メール   │
    │ Storage  │ │OpenAI   │ │ (PAT)   │ │ 送信     │
    └──────────┘ │Google   │ └─────────┘ └─────────┘
                 └─────────┘
```

### 1.1 どこが壊れると何が止まるか

| 依存先 | 停止時の影響 | 縮退運転の可否 |
| --- | --- | --- |
| **Vercel** | 全機能停止 | 不可 |
| **Supabase（DB/Auth）** | 全機能停止（ログインもできない） | 不可 |
| **Supabase Storage** | アトリエの画像表示・添付ファイルのみ停止 | 可（他機能は動く） |
| **AIプロバイダ1社** | その社に割り当てた能力帯（high/medium/low/image）を使う機能のみ停止 | **可**——設定画面のAIモデル設定で別プロバイダへ切り替える（→ §3.2） |
| **GitHub** | 原稿タブ・エディタ・校正の書き戻し・入稿ビルドが停止 | 可（ノート・企画書・ビートボードは動く） |
| **Resend** | 締切リマインドメールのみ停止（サイレント障害になりやすい → §6.4） | 可 |

### 1.2 主要な設定ファイル

| ファイル | 役割 |
| --- | --- |
| `vercel.json` | Cron 定義（`/api/cron/milestone-reminders` を `0 0 * * *` = **UTC 0時＝JST 9時**に実行） |
| `.env.local.example` | 環境変数のテンプレート。変数を増減したらここも更新する |
| `supabase/migrations/` | **スキーマの一次資料**（ER図は策定時のDraft。現行はここを見る） |
| `next.config.ts` | `logging.serverFunctions: false`（Server Action の引数平文出力を停止。外さないこと） |

---

## 2. 環境変数一覧

コードから参照される環境変数は以下の8つ（`app` / `lib` / `scripts` を走査した結果）。

| 変数 | 用途 | Vercel スコープ | 失うと | 再取得 |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 接続先 | Preview + Production | 全機能停止 | Supabase Dashboard（公開前提の値） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 公開鍵 | Preview + Production | 全機能停止 | 同上（公開前提の値） |
| `ALLOWED_EMAILS` | ログイン許可リスト（カンマ区切り） | Preview + Production | **誰もログインできない**（フェイルクローズ） | 自分で決める値。DB側 `private.auth_allowlist` と**手動同期**が必要 |
| `ANTHROPIC_API_KEY` | AI（high 能力帯の既定） | Preview + Production | 該当能力帯のAI機能が停止 | Anthropic Console で再発行 |
| `OPENAI_API_KEY` | AI（medium の既定） | Preview + Production | 同上 | OpenAI Platform で再発行 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | AI（low / image の既定） | Preview + Production | 同上 | Google AI Studio で再発行 |
| `ENCRYPTION_KEY` | **GitHub PAT の暗号化鍵**（AES-256-GCM・32バイトbase64） | Preview + Production | **再発行不能**。登録済みPATが復号できなくなり、設定画面からのPAT再登録が必要になる | **不可**（自分で生成した乱数。紛失＝再登録） |
| `SUPABASE_SERVICE_ROLE_KEY` | cron（締切リマインド）が全ユーザーのプロジェクトを読むため | **Production 専用** | リマインドメールが停止 | `npx supabase projects api-keys` で再取得可 |
| `RESEND_API_KEY` | リマインドメール送信 | **Production 専用** | リマインドメールが停止（**サイレント**） | Resend Dashboard で再発行（ユーザー操作） |
| `REMINDER_FROM_EMAIL` | 送信元アドレス（空なら Resend の既定を使う） | Production 専用 | 送信元が既定にフォールバック（実害小） | 自分で決める値 |
| `CRON_SECRET` | Vercel Cron の Bearer 認証 | **Production 専用** | cron が401で弾かれリマインドが停止 | **新しい乱数を生成するだけでよい**（外部整合不要） |

### 2.1 `ENCRYPTION_KEY` の暗号化対象（重要）

**暗号化しているのは `user_settings.github_pat_ciphertext`（GitHub PAT）のみ**である。

- 暗号化: `lib/actions/settings.ts`／復号: `lib/git/credentials.ts`／実装: `lib/crypto.ts`（AES-256-GCM）
- **ノート本文・企画書・原稿は暗号化していない**（pgcrypto も未使用）

したがって現状の鍵ローテーションは**再暗号化スクリプト不要**で、「新しい32バイト鍵に差し替え → 設定画面で PAT を再登録」で完結する。

> **将来の注意**: 暗号化対象を1つでも増やしたら「差し替えるだけ」は成立しなくなる。旧鍵で復号 → 新鍵で再暗号化する移行スクリプトが必須になる。対象を増やす変更を入れる際は、同時にこの節を書き換えること。

### 2.2 `NEXT_PUBLIC_` の原則

`NEXT_PUBLIC_` を付けた変数は**クライアントバンドルに埋め込まれ、誰でも読める**。秘密情報には絶対に付けない。現状 `NEXT_PUBLIC_` は Supabase の URL と anon key のみで、いずれも公開前提の値（2026-08-12 に Vercel 実設定を確認済み）。

---

## 3. APIキー・トークンのローテーション

### 3.1 共通原則（すべてのキーで守る）

```
新旧併存 → 切替 → 検証 → 旧失効
```

1. **旧キーを先に失効させない。** 新しいキーを発行し、登録・反映・疎通確認まで済ませてから旧キーを失効する
2. **Vercel は環境変数をデプロイ時にスナップショットする。** 値を更新しただけでは反映されず、**再デプロイが必須**（INC-1 で確認済みの仕様）
3. **「登録した」は検証ではない。アプリが実際に読めているかまで確認する。**
   Step P（2026-08-12）で、`RESEND_API_KEY` が**先頭1文字を欠いた名前**で登録されており、リマインドメールが約20日間送信できない状態が続いていたことが発覚した。cron は失敗しても500を返すだけで、気づく導線がなかった。→ **各手順の「疎通確認」を省略しない**
4. **消す前に登録形態を確認する**（→ §4）

#### 3.1.1 反映と疎通確認の共通手順

```bash
# 1) 登録（値は貼らずパイプで渡す。履歴に残さない）
npx vercel env add KEY_NAME production

# 2) 登録名の確認（値は表示されない。名前のタイプミスをここで潰す）
npx vercel env ls
```

```bash
# 3) 再デプロイ（環境変数はデプロイ時に固定されるため必須）
git commit --allow-empty -m "chore: 環境変数の反映のため再デプロイ" && git push
```

> main への push で Vercel が自動デプロイする（2026-07-14 にGit連携済み）。手動 `npx vercel deploy --prod` は不要。

4. **疎通確認** — キーごとの確認方法は以下の各節に記載する。

### 3.2 AIプロバイダのキー（Anthropic / OpenAI / Google）

**3社のうち1社が使えなくても、設定画面から別プロバイダに切り替えれば運用を継続できる**（能力帯 high / medium / low / image ごとに provider と model_id を差し替えられる）。これが本アプリの主要な縮退運転手段。

| プロバイダ | 環境変数 | 発行元 | 既定モデル（`lib/ai/models.ts`） |
| --- | --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | Anthropic Console | high: `claude-sonnet-5` |
| OpenAI | `OPENAI_API_KEY` | OpenAI Platform | medium: `gpt-5.4-mini` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio | low: `gemini-3.1-flash-lite` / image: `gemini-3.1-flash-image-preview` |

#### 手順

1. **（先に縮退）** 該当プロバイダが完全に使えない場合は、設定画面 `/settings` の「AIモデル設定」で、その能力帯を生きているプロバイダのモデルへ一時的に切り替える
2. 各社のダッシュボードで**新しいキーを発行**（旧キーはまだ残す）——**ユーザー実施**
3. ローカルの `.env.local` を更新（末尾改行を確認してから追記・編集する → §0.2）
4. Vercel に登録 → `vercel env ls` で**名前**を確認 → **再デプロイ**（→ §3.1.1）
5. **疎通確認**: 本番アプリにログインし、該当能力帯を使う機能を1回実行する
   - high → 企画書レビュー、medium → 相談（ダッシュボード）、low → 校正、image → アトリエの画像生成
   - **設定画面の「APIキー未設定」バッジが消えているだけでは不十分**（バッジは環境変数の有無しか見ていない）。実際に1回呼び出して成功することを確認する
   - 失敗時は「このプロバイダのAPIキーが未設定です」または provider 側の401が返る
6. **`/settings` の使用量サマリーに新しい行が増えていること**を確認する（`ai_usage_logs` に記録される）
7. 各社ダッシュボードで**旧キーを失効**——ユーザー実施

> **切り替え後にモデルを恒久化する場合**は `lib/ai/models.ts` の `DEFAULT_MODEL_MAP` を更新して PR を出す。設定行（`ai_model_settings`）での切り替えは「まず追従する」ための手段で、恒久化はコード側で行う、という2段構えになっている。

### 3.3 `ENCRYPTION_KEY`（再発行不能・最重要）

**この鍵だけは失うと取り戻せない。** 破壊的操作（削除・上書き）の対象にしないこと。やむを得ず触る場合は事前に控えを取る。

#### 現在の暗号化対象は GitHub PAT のみ（→ §2.1）。ゆえにローテーションは以下で完結する。

1. **新しい32バイト鍵を生成**する（base64）

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

2. `.env.local` と Vercel の `ENCRYPTION_KEY` を新しい値へ差し替える（→ §3.1.1）→ **再デプロイ**
3. **既存の暗号文は復号できなくなる。** アプリは詳細を漏らさず「保存されたトークンの復号に失敗しました。設定から登録し直してください」を返す設計（`lib/crypto.ts`）なので、壊れて止まるのではなく再登録を促す
4. `/settings` の「GitHub連携」で **PAT を登録し直す**——ユーザー実施
5. **疎通確認**: 原稿タブを開いて原稿ファイル一覧が表示されること／エディタで保存（＝コミット）が通ること

> **将来、暗号化対象を増やした場合**は上記手順は使えない。旧鍵で全行を復号 → 新鍵で再暗号化する移行スクリプトを書き、鍵を2つ併存させた状態で移行を完了させてから旧鍵を捨てること。

### 3.4 Supabase のキー

#### 3.4.1 まず現行のキー方式を確認する

Supabase には**旧来の JWT ベースのキー**（`eyJ...` で始まる anon / service_role）と、**新方式の publishable / secret key** の2つがある。**失効の影響がまったく違う**ので、手順に入る前に Dashboard の **Settings > API Keys** で現行方式を確認する。

| 方式 | 失効の影響 |
| --- | --- |
| 旧 JWT ベース（`eyJ...`） | 失効には **JWT secret のローテーション**が伴い、**全ユーザーのセッションが切れる**（再ログインが必要） |
| 新方式（publishable / secret key） | **キー単位で個別にローテーション可能**。セッションは切れない |

#### 3.4.2 `SUPABASE_SERVICE_ROLE_KEY`（cron 用・RLSをバイパスする最強権限）

- **絶対に `NEXT_PUBLIC_` を付けない。Preview に置かない**（Preview では未レビューのブランチコードが動くため。INC-1 の発端がこれ）
- CLI から再取得できる（値は変数内に留め、出力しない）

```bash
npx supabase projects api-keys --project-ref "$(cat supabase/.temp/project-ref)"
```

**手順**: 新キー取得 → Vercel の **Production のみ**に登録 → 再デプロイ → **疎通確認**（→ §3.6 の cron 疎通確認）→ 旧キー失効。

#### 3.4.3 anon key / URL

公開前提の値だが、JWT secret をローテーションすると anon key も変わる。変えた場合は `.env.local` と Vercel の両方（Preview + Production）を更新して再デプロイし、**ログインできることを確認**する。

### 3.5 `CRON_SECRET`

**外部との整合が不要**な唯一のキー。Vercel Cron は環境変数に入っている値をそのまま `Authorization: Bearer` で送るため、**新しい乱数に差し替えて再デプロイするだけ**で完結する。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Production のみに登録 → 再デプロイ → §3.6 の疎通確認。

### 3.6 `RESEND_API_KEY` とリマインドメールの疎通確認

Resend のキーは**外部サービス発行のためCLIから再取得できない**。ユーザーが Resend Dashboard で再発行する。

**この経路はサイレント障害になりやすい**（cron が失敗しても500を返すだけ）。登録後は必ず以下を確認する。

1. **キー名が正しいこと**（Step P で先頭1文字欠落のタイプミスが約20日見過ごされた）

```bash
npx vercel env ls | grep -i resend
```

2. **再デプロイ後**、cron エンドポイントに手動で疎通をかける（値はシェル変数経由で渡し、直接タイプしない）

```bash
read -rs CRON && curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRON" https://<本番ドメイン>/api/cron/milestone-reminders; unset CRON
```

- **200** = 認証通過・処理完了（該当マイルストーンがなければメールは飛ばない）
- **401** = `CRON_SECRET` の不一致（未登録・未反映・値違い）
- **500** = 内部エラー。Vercel のランタイムログで原因を見る（Resend キー欠落はここに出る）

3. 実際にメールが届くことを確認したい場合は、**検証用プロジェクトに「3日後」「翌日」の締切マイルストーンを作って**翌朝の cron を待つか、上記 curl を叩く（リマインド対象は締切3日前・前日の未達成マイルストーン。同日重複通知は抑止される）

### 3.7 GitHub Fine-grained PAT

原稿リポジトリの読み書きに使う。アプリ側は `user_settings` に暗号化保存し、**登録後は値を二度と表示しない**。

#### 必要な権限（対象リポジトリ限定で付与する）

| 権限 | 用途 | 無いとどうなるか |
| --- | --- | --- |
| **Contents: Read and write** | 原稿の読み書き・校正の反映・エディタの保存 | 原稿タブ／エディタが401・403 |
| **Workflows: Read and write** | 初期セットアップで `.github/workflows/` に入稿ビルド用ワークフローを書き込む | 「PATに Workflows: Read and write 権限が必要です」で初期セットアップが失敗 |

#### 更新・差し替え手順

1. GitHub の Settings > Developer settings > Personal access tokens (Fine-grained) で**新しいPATを発行**——ユーザー実施
   - **Repository access に対象リポジトリを全部含める**（原稿リポジトリ・Zenn記事リポジトリ・検証用リポジトリ）。含め忘れると「リポジトリ ○○ が見つかりません」になる
2. `/settings` の「GitHub連携」で登録（差し替え）。登録時に疎通検証が走り「@ユーザー名 として接続済み」と表示される
3. **疎通確認**: 原稿タブでファイル一覧が出ること／エディタで1回保存（＝コミット）してGitHub側にコミットが積まれること
4. GitHub 側で**旧PATを失効**

#### 失効・期限切れ時の症状と対処

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| 原稿タブが「PATを登録してください」誘導を出す | 未登録・削除済み | `/settings` で登録 |
| GitHub関連の 401 / 403 | PATの失効・期限切れ・権限不足 | 再発行して差し替え（上記手順） |
| 「リポジトリ ○○ が見つかりません」 | リポジトリ名の誤り、またはPATの対象リポジトリに含まれていない | 対象リポジトリ込みで差し替え |
| 「Workflows: Read and write 権限がない」 | Workflows 権限の付与漏れ | 権限を追加して差し替え → 初期セットアップを再実行 |
| 「保存されたトークンの復号に失敗しました」 | `ENCRYPTION_KEY` が変わった（→ §3.3） | PAT を登録し直す |

> **Fine-grained PAT には有効期限がある。** 期限切れは予告なく上記の401として現れる。§8 の定期点検で期限を確認しておくと、締切前に原稿が読めなくなる事故を防げる。

---

## 4. Vercel 環境変数の操作

### 4.1 スコープの罠（INC-1・実害あり）

**`npx vercel env rm <KEY> <environment>` は、環境を指定してもエントリごと消える。**

変数が **Preview + Production を対象とする1エントリ**として登録されている場合、`preview` を指定して削除すると **Production からも消える**。スコープの「部分解除」にはならない。

2026-07-23 にこれで本番の3キー（`SUPABASE_SERVICE_ROLE_KEY` / `CRON_SECRET` / `RESEND_API_KEY`）を消失させた（詳細: [incident-log.md](incident-log.md) INC-1）。

#### 削除前チェックリスト

- [ ] **登録形態を確認した** — `npx vercel env ls` で対象キーが単一環境か複数環境1エントリかを見る
- [ ] **復旧経路を確認した** — 値が再取得可能か（`.env.local` にあるか／CLIで取れるか／外部サービスで再発行できるか）を**消す前に**確かめた
- [ ] **再発行不能な鍵ではない** — `ENCRYPTION_KEY` は破壊的操作の対象にしない
- [ ] **スコープ限定で消したい場合の計画がある** — (a) Vercel Dashboard で操作する、または (b)「削除 → 必要な環境へ add し直す」を最初から一連の手順として組む

#### 削除後の必須確認

削除した直後に、**対象スコープだけでなく全環境**を確認する。

```bash
npx vercel env ls
```

INC-1 では、この「直後の全量確認」が最後の防壁として機能し、次回デプロイ後のサイレント障害になる前に発見できた。

### 4.2 スコープ方針

| スコープ | 置いてよいもの |
| --- | --- |
| **Preview + Production** | Supabase 接続情報、`ALLOWED_EMAILS`、`ENCRYPTION_KEY`、AI 3社のキー |
| **Production 専用** | `SUPABASE_SERVICE_ROLE_KEY` / `RESEND_API_KEY` / `REMINDER_FROM_EMAIL` / `CRON_SECRET` |

cron 関連を Production 専用にしているのは、**Preview では未レビューのブランチコードが動く**ため。特に service_role キーは本番DBのRLSをバイパスできる。

> Preview 環境でログインを通すには Supabase の Redirect URLs にプレビューURLのワイルドカードが登録されている必要がある（設定済み。詳細は [SPEC-auth.md](SPEC-auth.md) §3.4）。ブランチ名が長いとプレビューURLはDNSの63文字制限で切り詰め＋ハッシュ付与になるが、ワイルドカードには引き続きマッチする。

---

## 5. Supabase のバックアップとリストア

### 5.1 現状（2026-08-12 時点）— **自前バックアップが唯一の復旧手段**

```bash
npx supabase backups list --project-ref "$(cat supabase/.temp/project-ref)"
```

現在このコマンドは **`pitr_enabled: false` / 物理バックアップ0件**を返す。つまり**Dashboard／CLI から復元できるバックアップは存在しない**。

> ⚠️ **これはリスクとして認識しておくべき状態。** 誤ってテーブルを消す・マイグレーションを誤適用する等が起きても、プラットフォーム側に巻き戻す手段がない。運用期間中は §5.2 の自前ダンプを定期取得するか、有償プランへの移行（自動日次バックアップ／PITR）を検討する。

### 5.2 バックアップの取得（自前・推奨）

DBは約14MB（2026-08-12 時点）と小さいので、ダンプは短時間で終わる。

```bash
# スキーマ（migrations と一致するはずだが、実DBの状態を残す意味がある）
npx supabase db dump --linked -f backup/schema.sql

# データのみ（COPY 形式のほうが速く小さい）
npx supabase db dump --linked --data-only --use-copy -f backup/data.sql

# ロール（必要時のみ）
npx supabase db dump --linked --role-only -f backup/roles.sql
```

**バックアップの保管先は `.gitignore` 配下、またはリポジトリ外にする。** 本リポジトリは public であり、ダンプにはノート本文・企画書・暗号化済みPAT・許可メールアドレスが含まれる。**絶対にコミットしない。**

### 5.3 Storage は別途エクスポートが必要

**`db dump` に Storage のオブジェクト実体は含まれない**（`storage.objects` のメタデータ行だけが入る）。バケットは2つ。

| バケット | 内容 | 規模（2026-08-12） |
| --- | --- | --- |
| `illustrations` | アトリエの生成画像 | 13件 / 約9MB |
| `attachments` | ノートの添付ファイル | 2件 / 微小 |

いずれも**非公開バケット**で、配信は短寿命の署名URL（illustrations 3600秒 / attachments 600秒）。エクスポートが必要な場合は service_role キーで Storage API を叩く（値は変数内に留め、出力しない）。

> Storage の物理削除は CLI の `storage rm` では効かず（`deleted:[]` を返す）、`storage.objects` への直接 DELETE も `storage.protect_delete()` に拒否される。正規ルートは service_role キーで Storage API の `DELETE /storage/v1/object/{bucket}` に prefixes を渡す方式（2026-07-18 に確立）。

### 5.4 リストア手順

1. **影響範囲を確定してから動く。** 全損なのか、1テーブルなのか、1行なのかで手順が違う
2. **部分復旧（推奨）**: ダンプから該当テーブル・該当行だけを取り出して投入する。全体リストアは既存の正常データを巻き戻すため最終手段
3. **全体リストア**:
   - 新規 Supabase プロジェクトを作る（既存を上書きしない。切り戻し先を残す）
   - `npx supabase link --project-ref <new-project-ref>` → `echo Y | npx supabase db push`（マイグレーションでスキーマを再構築）
   - `backup/data.sql` を投入
   - Storage のオブジェクトを再アップロード
   - **Auth 設定（Google OAuth プロバイダ・Redirect URLs）は Dashboard で再設定が必要**——ユーザー実施
   - `private.auth_allowlist` に許可メールを投入し直す（→ §2 の `ALLOWED_EMAILS` と同期）
   - Vercel の Supabase 系環境変数を新プロジェクトの値へ差し替え → 再デプロイ
4. **疎通確認**: ログイン → ダッシュボード表示 → ノート1件作成・削除 → 原稿タブ表示

### 5.5 マイグレーションの適用

**DBへの直接変更は禁止**（CLAUDE.md の規約）。必ずマイグレーションファイル経由で行う。

```bash
echo Y | npx supabase db push   # 非対話だと確認プロンプトで止まるため echo Y を前置
npm run db:types                # 型定義の再生成
```

**適用タイミングの教訓（2026-07-14）**: マイグレーションの本番適用は**コードデプロイの直前**に行う。スキーマ変更が旧コードの前提を壊す型（unique 制約の撤去・列削除など）では、適用からデプロイまでの間に本番が壊れる時間帯が生じる。

現状のマイグレーション本数はローカル・本番とも **29本で一致**（2026-08-12 確認済み）。

---

## 6. 障害時の切り分けフロー

### 6.0 最初の3分

```
① 影響範囲を決める
   「全部が落ちている」のか「1機能だけ」なのか、まずこれを確定する
        ↓
② 全機能停止 → §6.1（Vercel / Supabase を疑う）
   1機能だけ  → §6.2（依存先ごとの切り分け表）
        ↓
③ 直前に何かしたか？
   デプロイ・環境変数の変更・マイグレーション適用・キーのローテーション
   → 心当たりがあれば、まずそれを疑う（原因の大半はここ）
        ↓
④ 直せない／原因が読めない → 切り戻す（§6.5）。原因究明は復旧の後でよい
```

### 6.1 全機能が停止しているとき

| 確認 | 手段 | 判定 |
| --- | --- | --- |
| Vercel のデプロイ状態 | `npx vercel ls`（最新デプロイが READY か・本番エイリアスがそこを指しているか） | ビルド失敗なら §6.5 で切り戻す |
| Vercel 障害 | Vercel のステータスページ | 障害中なら待つしかない |
| Supabase 稼働 | `npx supabase db query --linked "select 1;"` | 応答しなければ Supabase 側 |
| Supabase 障害 | Supabase のステータスページ | 同上 |
| ログイン不可のみ | §6.3 へ | |

### 6.2 特定機能だけ落ちているとき

| 症状 | 疑う先 | 確認手順 |
| --- | --- | --- |
| AIパネルが「このプロバイダのAPIキーが未設定です」 | 環境変数 | `npx vercel env ls` で名前を確認 → 再デプロイ漏れがないか（→ §3.1） |
| AIの呼び出しが provider 側エラー | プロバイダ | 各社ステータスページ／残高・レート上限。**設定画面で別プロバイダへ切り替えて縮退**（→ §3.2） |
| レビューが「AI（〇〇）側のエラーで生成できませんでした（HTTP 5xx）」 | プロバイダ | 障害の可能性。ステータスページを確認し、続くなら §3.2 で別プロバイダへ切り替える |
| レビューが「AI（〇〇）がリクエストを受け付けませんでした（HTTP 4xx）」 | 入力またはモデル設定 | プロバイダの文言をそのまま表示している。`prompt is too long` なら入力過多（構成レビューは全シーン＋紐づけノート＋セッション履歴を送るため最も大きい。紐づけノートを減らす／新しいセッションで再実行する）。`model not found` なら設定画面のモデルIDを見直す |
| レビューが「レビューの実行に失敗しました」（本文が途中まで出て消える） | プロバイダまたは実行時間 | 生成途中で切断された場合。半端なフィードバックは保存しない仕様（判定行を欠いた本文は差し戻し扱いになるため）。再実行で解消しなければ、入力量と Vercel Functions の実行上限（`maxDuration` 120秒）を疑う |
| AI呼び出しが429 | レートリミット | アプリ内の簡易レートリミット（相談・掘り下げ10回/分・300回/日、レビュー/校正 各3回/分・60回/日、アトリエ 案出し5回/分・50回/日・画像2回/分・20回/日）。1分待って再実行 |
| 原稿・エディタが 401 / 403 | GitHub PAT | §3.7 の症状表 |
| 「原稿が更新されています」バナー・提案が「適用不能」 | 障害ではない | 原稿が変わったための正常動作。再校正すればよい |
| 画像が表示されない | Storage | バケットは非公開・署名URLの期限切れ。リロードで再取得される。continue するなら Supabase Storage の稼働を確認 |
| リマインドメールが来ない | cron / Resend | §6.4 |
| ログインできない | 認証 | §6.3 |
| 入稿ビルドが15分でタイムアウト | GitHub Actions | 案内される Actions ページでログを見る（PATの Workflows 権限・ワークフロー自体の失敗） |

### 6.3 ログインできない

認証は**メール許可リストのフェイルクローズ2層ゲート**（環境変数 `ALLOWED_EMAILS` ＋ DB の `private.auth_allowlist`）。**両方に載っていないと入れない。片方だけ更新して弾かれるのが最頻の原因。**

```bash
# DB側の許可リストにいるか（アドレス自体は出力しない形で件数だけ見る）
npx supabase db query --linked "select count(*) from private.auth_allowlist;" -o table
```

| 確認 | 対処 |
| --- | --- |
| 環境変数 `ALLOWED_EMAILS` に入っているか | 入っていなければ追加 → **再デプロイ** |
| `private.auth_allowlist` に入っているか | 入っていなければ `insert into private.auth_allowlist (email) values ('...');` |
| Google OAuth の設定 | Supabase Dashboard > Authentication > Providers、Google Cloud Console の承認済みリダイレクトURI |
| Redirect URLs | Supabase Dashboard > Authentication > URL Configuration（本番ドメイン＋プレビューのワイルドカード） |

新規ユーザーの追加は `auth.users` へのトリガー `check_email_allowlist_before_insert` が拒否する仕組み（本番に存在・有効を 2026-08-12 に確認済み）。

### 6.4 リマインドメールが届かない（サイレント障害に注意）

**この経路は失敗しても誰にも通知されない。** 実際に約20日間気づかれなかった前例がある。

```
① CRON_SECRET は合っているか
   → §3.6 の curl で 401 が返らないか確認
        ↓
② RESEND_API_KEY は「正しい名前で」登録されているか
   → npx vercel env ls | grep -i resend （名前のタイプミスを疑う）
        ↓
③ 登録後に再デプロイしたか
   → していなければ空コミット push（§3.1.1）
        ↓
④ そもそも通知対象があるか
   → リマインドは「締切3日前」「前日」の未達成マイルストーンのみ。
      当日すでに通知済みなら再送しない
        ↓
⑤ Vercel のランタイムログを見る
   → /api/cron/milestone-reminders の 500 と、そのエラー内容
```

### 6.5 切り戻し（ロールバック）

**原因が読めないときは、原因究明より先に切り戻す。**

- **コード**: 問題のPRを revert して main に push（Vercel が自動デプロイ）。Vercel Dashboard から直前のデプロイを Promote してもよい
- **環境変数**: 旧値に戻して**再デプロイ**（値の更新だけでは反映されない）
- **マイグレーション**: 適用済みマイグレーションの自動巻き戻しはない。**打ち消すマイグレーションを新規に書いて push** する（DBを直接いじらない）
- **本番反映は必ずPRマージ経由。** main への直接 push によるデプロイは行わない（CLAUDE.md の規約）

### 6.6 記録する

**事故・ヒヤリハットは [incident-log.md](incident-log.md) に記録する**（INC-1 から採番）。ハインリッヒの法則の考え方で、**軽微で済んだ事象ほど「なぜ重大化しなかったか」まで含めて**書く。構成は「経緯（タイムライン）／直接原因・誘発要因・背景要因／影響／なぜ軽微で済んだか／対策／教訓」。

---

## 7. ランニングコストの棚卸し

### 7.1 データ源

AI の使用量は `ai_usage_logs`（追記専用・RLSで本人分のみ）に**AI呼び出し1回＝1行**で記録される。表示は `/settings` の「直近30日」サマリー（rpc `ai_usage_summary(days)`）。**金額換算はアプリ側では行っていない**——単価が変動するため、棚卸しのたびに各社の料金ページを見て掛ける。

### 7.2 棚卸しの手順

```bash
npx supabase db query --linked "select feature, provider, model_id, count(*) as calls, coalesce(sum(input_tokens),0) as in_tok, coalesce(sum(output_tokens),0) as out_tok from public.ai_usage_logs where created_at >= now() - interval '30 days' group by 1,2,3 order by 1,2,3;" -o table
```

```bash
npx supabase db query --linked "select pg_size_pretty(pg_database_size(current_database())) as db_size;" -o table
```

```bash
npx supabase db query --linked "select bucket_id, count(*) as objects, pg_size_pretty(coalesce(sum((metadata->>'size')::bigint),0)) as bytes from storage.objects group by 1;" -o table
```

概算コスト = `(入力トークン / 1,000,000) × 入力単価 + (出力トークン / 1,000,000) × 出力単価`

### 7.3 スナップショット（2026-07-18 〜 2026-08-12・約26日間）

計測開始は AI 使用量計測の本番稼働日（2026-07-18・Issue #45）。ドッグフーディング期間を含む実使用ベース。

| 機能 | プロバイダ | モデル | 呼出 | 入力tok | 出力tok |
| --- | --- | --- | ---: | ---: | ---: |
| chat | openai | gpt-5.4-mini | 45 | 147,665 | 8,734 |
| chat | google | gemini-3.1-flash-lite | 1 | 68 | 6 |
| review | anthropic | claude-sonnet-5 | 16 | 119,380 | 52,295 |
| review | openai | gpt-5.4-mini | 2 | 54,394 | 1,887 |
| proofread | google | gemini-3.1-flash-lite | 3 | 4,558 | 403 |
| illustration-propose | anthropic | claude-sonnet-5 | 12 | 173,197 | 25,116 |
| illustration-generate | google | gemini-3.1-flash-image-preview | 15 | 3,493 | 22,421 |
| **合計** | | | **94** | **502,755** | **110,862** |

プロバイダ別: Anthropic 28回（入力 292,577 / 出力 77,411）・OpenAI 47回（202,059 / 10,621）・Google 19回（8,119 / 22,830）。

**概算費用（Anthropic 分のみ計算例）**: `claude-sonnet-5` のリスト価格は入力 $3.00 / 出力 $15.00 per MTok。
`0.293 × 3 + 0.077 × 15 ≒ **$2.0**`（26日間・約$0.08/日）。
OpenAI・Google 分は各社の料金ページで現行単価を確認して同じ式で掛ける（本ドキュメントには単価を固定値で書かない——変動するため）。

**総額は月額で数ドル規模**に収まっている。単一ユーザー運用では、AI費用よりも下記の無料枠の方が先に効いてくる。

### 7.4 無料枠の消費状況

| サービス | 主な無料枠の観点 | 2026-08-12 時点 | 判断 |
| --- | --- | --- | --- |
| **Supabase** | DB容量・Storage 容量・帯域・MAU | DB **14MB** / Storage **約9MB**（13+2 オブジェクト）/ MAU **1** | 十分に余裕。**ただし自動バックアップ・PITR は無い**（→ §5.1）——容量ではなくこちらが先に効く制約 |
| **Vercel** | ビルド時間・帯域・関数実行・Cron 本数 | Cron は 1本（日次）・単一ユーザーの通常利用 | 余裕。ビルド回数は PR ごとのプレビュー生成で増えるため、Dependabot PR が増えたときだけ注意 |
| **AIプロバイダ** | 従量課金（無料枠なし前提） | 月数ドル規模 | 暴走時の上限は**各社ダッシュボードのスペンド上限**で守る（→ §8） |
| **Resend** | 月間送信数 | 締切リマインドのみ・日次1回・対象があるときだけ | 事実上使い切らない |

**コスト暴走のリスクと防壁**: アプリ内に簡易レートリミット（インメモリ固定ウィンドウ）を入れてある（→ §6.2）。ただしサーバーレスのインスタンス間で共有されないため**厳密な流量制御ではなく、あくまで抑止**。最後の砦は各社ダッシュボードのスペンド上限。

---

## 8. 定期点検

コードに手を入れない運用期間でも、以下は放っておくと壊れる。

### 8.1 月次

- [ ] **AI使用量とコストの棚卸し**（→ §7.2）。前月比で跳ねていないか
- [ ] **DB・Storage の容量**（→ §7.2）
- [ ] **自前バックアップの取得**（→ §5.2）。プラットフォーム側にバックアップが無いため、これが唯一の復旧手段
- [ ] **リマインドメールが機能しているか**（→ §3.6 の curl で 200 が返ること）。サイレント障害を早期に見つけるための唯一の導線
- [ ] **GitHub の Dependabot アラート**を確認。オープンなアラートの性質が変わっていないか

### 8.2 四半期

- [ ] **Fine-grained PAT の有効期限**を確認（期限切れは予告なく401として現れる → §3.7）
- [ ] **AIプロバイダのスペンド上限**が設定されているか（3社とも）
- [ ] **Supabase の Security Advisor** を実行して指摘ゼロを確認
- [ ] **Supabase Auth 設定の棚卸し** — Redirect URLs の許可リスト・Auth 側のレート制限設定
- [ ] **Google OAuth クライアント設定の棚卸し** — 承認済みリダイレクトURIの範囲が広がりすぎていないか
- [ ] **依存パッケージの脆弱性** — `npm audit`。上流待ちのものは記録して次回再評価

> 上記のうち **Supabase Auth 設定／Google OAuth クライアント設定／AIプロバイダのスペンド上限**の3件は、セキュリティ監査（2026-08-12）が「コードベースからは検証できない未確認項目」として Step 4 へ引き継いだもの。いずれも Dashboard でしか確認できないため、定期点検の項目として恒久化した。詳細は [security-audit-20260812.md](security-audit-20260812.md) の「未確認項目」節。

### 8.3 恒常的な注意

- **Dependabot の更新ジョブが Actions 一覧で失敗し続けているのは想定内**。プロジェクトのCIの失敗ではない。オープンなアラートは推移的依存の上流待ちで、Dependabot が自動更新PRを作れずジョブがエラー終了する（PRは作成されない）。上流が更新されたときに再評価する
- **`next.config.ts` の `logging.serverFunctions: false` を外さない**（Server Action の引数が平文でログに出る）
- **本番DBへの直接 UPDATE / DELETE をしない**。検証も含めて避ける

---

## 9. 保守対応フロー（不具合・要望への対応）

運用期間中は原則コードに手を入れず、**要望・不具合は GitHub Issue に起票する**。修正が必要になったときは以下のフローに乗せる。

### 9.1 全体像

```
① 人間：Issue起票
        ↓
② AI：影響範囲の分析・調査
        ↓
③ 分岐：設計確認が必要？（判断基準は §9.3）
   ├─ YES → 人間に設計確認（承認待ち）
   └─ NO  ↓
④ AI：コード修正 + 検証（typecheck / lint / 実画面確認）
        ↓
⑤ AI：自己レビュー → 問題あれば④に戻る
        ↓
⑥ AI：PR作成
        ↓
⑦ 人間：最終確認 → マージ承認
        ↓
⑧ 自動デプロイ（Vercel: main へのマージで本番反映）
```

### 9.2 起票と実行

- Issue テンプレートは「不具合報告」「要望・改善提案」の2種（`.github/ISSUE_TEMPLATE/`）
- **1 Issue = 1件**にする（フローが1 Issue単位で回るため）
- 文言変更の要望は**最終的な文言を正確に**書く（例示の句読点の位置までそのまま実装される）
- Claude Code のセッションで **`/fix-issue <Issue番号>`** を実行すると ②〜⑥ が一気通貫で進み、PRのURLが提示される

運用ルール（スキルに組み込み済み）:

- **複数Issueは直列で対応**する。1件をPR作成まで進めてから次に着手。同じファイルに触るIssue同士は前のPRマージ後に次へ
- 同じ作業ディレクトリで複数の Claude Code セッションを同時に走らせない（ブランチが衝突する）
- **認証・RLS・秘密情報に触れる修正は security-reviewer の通過が必須**（自動フローでも省略しない）

### 9.3 人間への設計確認が必要な変更

以下のいずれかに該当する修正は、実装前に必ず設計確認を求める（CLAUDE.md に明記済みの基準）。

- DBスキーマの変更を伴う
- 外部APIの認証フロー変更
- 既存APIのインターフェース変更（破壊的変更）
- セキュリティ関連コードの変更
- 3ファイル以上にまたがる大規模リファクタリング

該当しないルーティンな修正（文言・表示崩れ・小さなロジック修正）は確認なしでPR作成まで進めてよい。

### 9.4 マージと本番反映

- PR本文には概要・影響範囲分析の要約・変更点・検証結果が書かれている。差分と合わせて確認する
- 意図と違う場合はPRにレビューコメントを書く → ④に戻って再修正し、同じPRに追加コミットされる
- **本番反映は必ずPRマージを経由する。main への直接 push によるデプロイは行わない**
- リポジトリ設定「Automatically delete head branches」を有効にしておくとマージ後のブランチ掃除が不要

### 9.5 緊急時

- 重大な不具合でフローの往復を待てない場合は、通常の Claude Code セッションで直接修正を依頼してよい。その場合も**本番反映はPR経由**を維持する
- アプリのコード以外（Supabase / Vercel の設定、APIキーのローテーション等）は本ドキュメントの §3〜§5 に従い、人間が直接操作する

### 9.6 リリース前の回帰テスト

大きめの変更やセキュリティ修正の後は [TESTING.md](TESTING.md) のチェックリストを一周する。**§0 のデータ保護ルール**（検証専用プロジェクトを作る・実データに触らない・相談系は「新しい会話」で分離する）を必ず先に読むこと——過去に検証操作が実データ領域へ波及したヒヤリハットが2件ある（[incident-log.md](incident-log.md) INC-2）。

---

## 関連ドキュメント

- [manual.md](manual.md) — ユーザー向けの使い方
- [incident-log.md](incident-log.md) — 事故・ヒヤリハットの記録
- [TESTING.md](TESTING.md) — 回帰テストチェックリスト
- [SPEC-index.md](SPEC-index.md) — 機能仕様の索引
- [claude-code-operation-plan.md](claude-code-operation-plan.md) — Claude Code 運用計画
- [security-audit-20260812.md](security-audit-20260812.md) — セキュリティ監査結果
- [dev-log.md](dev-log.md) — 開発ログ（セッション単位の記録）
