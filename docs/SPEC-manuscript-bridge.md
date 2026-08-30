# SPEC-manuscript-bridge: 構成から執筆への橋渡し（原稿ファイルの生成・進捗・逆引き）

作成日: 2026-08-30（インタビュー駆動で策定）
ステータス: **確定**（2026-08-30 プラン承認をもって設計確認とする）
前提: **SPEC-board-chapters**（章マーカーの導入）。本SPECは章の存在を前提とする
関連: SPEC-vertical-editor-phase2（新規章作成）/ -phase3（entry管理）/ -phase4（相互リンク）/ SPEC-repo-setup / SPEC-proofreading

## 1. 目的

構成を組み立て、レビューを通したあと、**そのままボード上から原稿ファイルを作って執筆に入れる**導線を作る。

現状、構成と執筆の接続は次の状態にある。

- **ボードから原稿ファイルを作れない。** `createChapter` を呼ぶ UI は縦書きエディタの章一覧サイドバーのみで、
  シーンダイアログの原稿 select は**既存ファイルしか出さない**。つまり
  「シーンを作る → エディタへ移動してファイル名を手入力で作る → ボードへ戻って select で選び直す」という往復が要る
- **構成承認の瞬間に導線がない。** `components/board/beat-board.tsx` は
  `toast("構成が通りました！シーンの執筆に進みましょう")` と促すだけで、クリックできる先がない
- **逆引きがない。** エディタ・原稿タブから「この原稿に紐づくシーン」を辿る経路が UI にもデータにもない
  （`lib/actions/editor/*` と `lib/actions/manuscripts.ts` は `scenes` に一切触れていない）
- **未執筆シーンが可視化されない。** ボードの集計は「シーン N枚」のみ

なお Issue #56 の実装時点では対象リポジトリに章ファイルがなく、
**この紐づけは実導線の E2E 確認が取れていない**（dev-log セッション53「初章作成後に実導線が通る」）。
本SPECの検証で初めてその確認を行う。

**スキーマ変更はない**（逆引き用の index は SPEC-board-chapters のマイグレーションに含める）。

## 2. 決定事項（2026-08-30）

| 論点 | 決定 |
|---|---|
| 生成の単位 | **単体作成も一括生成も同じ Server Action 1本**（`generateManuscriptsForBoard`）。単体は対象1件で同じ経路を通す |
| コミット方式 | **Git Data API で1コミット**（新規 `.md` 群＋更新後の `book.config.js` を同一ツリーに含める）。`createChapter` の N 回呼び出しにはしない |
| ファイル名 | **自動採番**（`NN-chapter{章番号}.md` / `NN-scene{通し番号}.md`）。生成ダイアログでインライン編集可。**タイトルからのスラッグ化はしない** |
| 番号の意味 | **番号は名前であって順序ではない。** 本の順序は `book.config.js` の entry が持つ。したがって既存ファイルを一切リネームしない |
| 章扉の雛形 | 既存 `chapterScaffold()` 同型（frontmatter ＋ `# 章タイトル`）。タイトルを受け取れるよう**引数化**する |
| シーンの雛形 | **`<!-- シーンタイトル（N） -->` のコメント1行＋空行**（N＝シーン番号）。VFM のコメントなので組版・入稿PDFに出ない |
| 雛形の値の追従 | 作成時点の値を書き込むだけ。**以後ボードの変更に追従しない** |
| entry への追記 | 生成時に**一方向・1回きり**。生成後の並び調整は既存の書籍設定フォームに委ねる（SPEC-board-chapters §3.4） |
| 章扉を作るか | 生成ダイアログで**章行のチェックを外せる**（既定オン）。章扉が不要な作品に対応する |
| 承認前の生成 | **許可する**（承認後は CTA で強調するだけ。ゲートにはしない） |
| 進捗の表示 | 「未執筆 / 執筆中 / 見つかりません」の3状態をカードのバッジで。**新しいテーマ色は追加しない** |
| 進捗の取得 | `getManuscriptTree` の**blob サイズ**を使う。本文は取りに行かない |
| 逆引きの結合 | `scenes.manuscript_path` の**等値検索**。`manuscript_links` とは結合しない |

## 3. ファイル名の自動採番

`lib/editor/manuscript-naming.ts`（新規・副作用なし・単体テスト可能）

```ts
export function planManuscriptFileNames(
  existingNames: string[],                                // manuscripts/ 直下の *.md（ファイル名のみ）
  items: { kind: "scene" | "chapter"; number: number }[],  // ボード順。number = 章番号 or シーン通し番号
): string[]                                               // 例: ["03-chapter2.md", "04-scene7.md", ...]
```

規則:

1. 既存ファイル名から `^(\d{2})-` の番号を集める
2. **本文帯 = 01〜89。** `00`（扉）と `90〜99`（あとがき・奥付）は予約帯として使わない
   （`docs/templates/manuscript-repo/manuscripts/` の `00-tobira.md` / `90-atogaki.md` / `99-okuzuke.md` の慣習）
3. 開始番号 = 本文帯の既存最大値 + 1。以降ボード順に連番
4. slug は `chapter{章番号}` / `scene{通し番号}`。**タイトルからのスラッグ化はしない**
   （`chapterFileNameSchema` は英数字始まりの ASCII のみを許すのに対しタイトルは日本語であり、
   ローマ字変換は頼まれていない抽象化になる）
5. 同名が既に存在したら番号を1つ進めて再試行（衝突回避）
6. 本文帯が尽きた場合は `AppError("validation", "自動採番の空き番号がありません。ファイル名を指定してください")`
7. 生成した名前は最後に必ず `chapterFileNameSchema`（`lib/actions/editor/context.ts`）で再検証（多層防御）

**番号が飛んでも非単調でも実害がない。** 本の順序は entry が持つため、
「既存ファイルを一切リネームしない」（＝git 上のファイル移動と entry 書き換えを起こさない）方針が成立する。

予約帯の前提はテンプレート由来のため、手作りリポジトリでは崩れうる。崩れていても衝突回避で動くが、番号が飛ぶ。

## 4. 画面とUX

### 4.1 構成承認後の導線

- `components/board/beat-board.tsx` / `outline-board.tsx` の承認時 `toast` を**アクション付き**にする
  （「原稿ファイルを作る」）
- 加えて**恒久的な CTA バー**をボードヘッダ直下に出す（`structureApproved && 未生成件数 > 0` のとき）:
  「構成が通りました。まだ原稿ファイルのない章・シーンが N 件あります」＋ ボタン「まとめて作成」
- ボードヘッダの集計を「章 M / シーン N枚 / 原稿 K件」に拡張する

### 4.2 生成ダイアログ

`components/board/generate-manuscripts-dialog.tsx`（新規）

- 対象一覧（種別アイコン・タイトル・**生成予定ファイル名**・チェックボックス。既定は全選択）。
  **章行のチェックも外せる**
- ファイル名はインライン編集可（1件モードでは入力欄が主役）
- 「`book.config.js` の entry にも追記する」チェック（既定オン）
- フッタ注記「作成すると原稿リポジトリに1コミットされます。並び順は書籍設定の entry で調整できます」
- 実行 → 進行中スピナー → 完了トースト「N 件の原稿ファイルを作成しました」＋「エディタで開く」
- **追加のみの操作なので `AlertDialog` ではなく本ダイアログの主ボタンで確定する**
  （`AlertDialog` は削除・テンプレ切替など既存の破壊的操作専用のまま）

シーンダイアログ（`components/board/scene-dialog.tsx`）と章ダイアログ（`chapter-dialog.tsx`）の
原稿ファイル select の直下に **「原稿ファイルを新規作成」ボタン**を置き、押すと本ダイアログを1件モードで開く。
成功後、そのパスを select の値に反映する。既存の遅延取得・gate 表示・「見つかりません」温存はそのまま。

> ⚠️ シーンダイアログのこの箇所は Issue #215（原稿ファイル読み込み中にシーンを閉じるとフリーズ）の
> 当該コードに隣接する。**触る範囲を select 直下の追加に限定し、`useEffect` の取得ロジックには手を入れない。**

### 4.3 進捗の可視化

カードのバッジで3状態を出す（`Badge variant="outline"` ＋ lucide アイコン。**新色は追加しない**）。

| 状態 | 判定 | 表示 |
|---|---|---|
| 原稿なし | `manuscript_path === null` | バッジなし（現状どおり） |
| 未執筆 | パスが存在し、blob サイズ ≦ 雛形しきい値 | 「未執筆」（`FileText` ＋ `muted-foreground`） |
| 執筆中 | サイズ > しきい値 | 既存の「原稿」バッジ（クリックでエディタへ） |
| 見つかりません | パスがツリーにない | 「見つかりません」（`--destructive`。既存の select の文言と揃える） |

- データ源は `getManuscriptTree` の**1回の呼び出し**。GitHub の trees API は blob の `size` を返すため、
  **ファイル本文を取りに行かずに全件の状態が分かる**。現在の実装はレスポンスの `size` を捨てているので、
  パース型と返り値に `size` を足すだけでよい（`lib/git/github.ts` の `ManuscriptTreeEntry`）
- 取得タイミングは**クライアントのマウント後**（`scene-dialog.tsx` の原稿 select と同じ遅延取得パターン）。
  ボードの初期表示を GitHub のレイテンシと障害から切り離す
- 取得失敗・repo/PAT 未設定のときは**バッジを出さないだけ**（フェイルソフト）

### 4.4 逆引き（エディタ・原稿タブ → シーン）

`components/board/linked-scene-list.tsx`（新規。`LinkedNoteChips` と同じ「参照を軽く見せる」パターン）

- 開いているファイルに紐づくシーン／章を、**タイトル＋構成メモ（`content`）**の読み取り専用リストで表示する。
  執筆中に構成メモが読めることが本質的な価値なので、タイトルだけにしない
- 各項目のリンク先は `/projects/[id]/board?scene=<id>`
- **エディタ**: `components/editor/editor-sidebar.tsx` の章一覧タブ下部、ファイル選択中のときだけ
  「この原稿のシーン」セクションとして表示
- **原稿タブ**: `components/manuscript/manuscript-workspace.tsx` のファイルヘッダ直下に同じコンポーネント

## 5. 実装方式

### 5.1 生成アクション

`lib/actions/manuscript-generate.ts`（新規・`"use server"`）

```ts
export async function generateManuscriptsForBoard(
  projectId: string,
  input: {
    targets: { id: string; fileName?: string }[];  // 空なら未紐づけ全件。上限50件
    appendToEntry: boolean;
    branch?: string;
  },
): Promise<ActionResult<{
  scenes: SceneRecord[];
  created: { id: string; path: string }[];
  inEntry: boolean;
}>>
```

処理順:

1. `getOwnedProject`（所有確認）と `loadEditorContext`（repo / PAT）。
   ダイアログのプレビュー用には `loadProjectGitOrGate` の gate 型で前提未達をフェイルソフトに返す版を用意する
2. `enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 })` を**1回だけ**消費（1コミットのため）
3. `fetchProjectScenes` → 正準順序。対象は **`manuscript_path === null` の行のみ**
   （既に紐づいている行は絶対に上書きしない）
4. `getManuscriptTree` で既存ファイル名を取得 → `planManuscriptFileNames` で採番
   （クライアントが `fileName` を渡してきた場合はそれを検証して優先）
5. ツリーエントリを組む: 新規 `.md` 群 ＋（`appendToEntry` なら）更新後の `book.config.js`
6. `getBranchHeadShaOrNull` → HEAD なしなら
   `AppError("validation", "先に原稿リポジトリの初期セットアップを行ってください")`
7. `getFullTree` → `createTree`（base_tree 付き）→ `createCommit` → `updateBranchRef`
   （422 は既存実装が `conflict` に正規化する）
8. 成功後、**1回の upsert** で `manuscript_path` をまとめて保存する
9. `revalidatePath(/projects/${pid}/board)`

**なぜ `createChapter` の N 回呼び出しではないか**:

- `createChapter` は1件あたり「ファイル作成 PUT ＋ entry の GET/PUT」で最大3回の書き込み。
  12件で 36 リクエストとなり、`perMinute: 12` の枠を**1操作で使い切って自分自身を止める**
- コミットが N 個に分かれ、途中失敗すると「一部だけ作られた」状態がリポジトリ履歴に残る
- Git Data API なら**新規ファイル群と entry 更新が同一コミット**になり、entry と実ファイルの乖離が原理的に起きない。
  前例は `lib/actions/repo-setup.ts`（初期セットアップの1コミット展開）

### 5.2 雛形

- **章扉**: `chapterScaffold(title)` へ引数化（`lib/actions/editor/chapters.ts`）。
  既存の `createChapter` 経路は従来どおりの既定文言で呼ぶ（外部挙動は無変更）
- **シーン**: `<!-- シーンタイトル（N） -->` ＋ 空行。VFM のコメントなので組版・入稿PDFには一切出ず、
  エディタのコメント一覧（SPEC-vertical-editor-phase3 §3）に並んで執筆中の目印になる。
  タイトルが空のシーンは `<!-- （無題）（N） -->` とする

### 5.3 entry への追記

- 既存 entry 要素は `parseEntryItems`（`lib/editor/book-config.ts`）でそのまま保持し、
  `replaceEntryItems` で書き戻す。`{ rel: 'contents' }` 等の非文字列要素は位置を保つ
- 挿入位置の規則（単純さ優先）:
  1. ボード順で直前にある「既に entry に載っているパス」の直後
  2. 見つからなければ `{ rel: 'contents' }` の直後
  3. それもなければ末尾
- 書き戻し後に `extractEntryPaths` で再抽出して期待どおり読めることを**検証してからコミット**する
  （`appendChapterToEntry` と同じ作法）
- 検証に失敗したら **entry 更新をあきらめてファイル生成だけコミットする**（ベストエフォート）。
  `inEntry: false` を返し、UI は「entry 未登録」と案内する。エディタは既に entry 未登録ファイルを
  一覧末尾に印つきで出す実装があるため、ファイルは開ける

### 5.4 共有ヘルパの切り出し

`"use server"` ファイルは async 関数しか export できず、
**`EditorContext`（PATトークンを含む）を引数に取る関数を export するとクライアントから呼べる Server Action になる**。
そのため次を移動する。**いずれもロジックは移動のみで変更しない。**

- `appendChapterToEntry`（現 `lib/actions/editor/chapters.ts` のプライベート関数）
  → `lib/editor/entry-sync.ts`（`"use server"` なし）
- `getOwnedProject` / `fetchProjectScenes` / `persistChanges` / `toMap`（現 `lib/actions/scenes.ts` のプライベート関数）
  → `lib/board/scene-store.ts`（`"use server"` なし）

### 5.5 逆引きの取得

- **`scenes.manuscript_path` の等値検索でよい。** 両側とも「リポジトリルート基準のパス」に正規化済みで
  （`validateChapterPath` / `manuscriptFilePathSchema` を通っている）、等値の意味が定義できている
- **`manuscript_links` とは結合しない。** 理由:
  - 目的が違う（`manuscript_links` は校正の `last_reviewed_commit` を持つためのレコードで、
    原稿タブで開いた瞬間に upsert される遅延生成物）
  - FK を張ると「シーンに原稿を紐づけた瞬間に校正用レコードを作る」ことになり、遅延生成の設計意図を壊す
  - 削除の連鎖も望ましくない（校正レコードを消したらシーンの紐づけが消える、は誤り）
  - 現状 FK なしで運用できており、パスが消えた場合の UI（「見つかりません」の温存表示）も既にある
- **取得はサーバーコンポーネントで**行い、新しい Server Action を作らない。
  `app/(app)/projects/[id]/editor/page.tsx` と `manuscript/page.tsx` で
  `select("id, kind, title, content, manuscript_path").eq("project_id", id).not("manuscript_path", "is", null).order("order_index")`
  を1本引き、`Record<path, LinkedScene[]>` にして子へ渡す
  （`board/page.tsx` が `scene_notes` を引いているのと同じ流儀）。**GitHub API 呼び出しは1回も増えない**
- ボード側の `?scene=<id>` 受け口: `board/page.tsx` が `searchParams` を読み、
  `initialSceneId` として渡す。ボードは `useState` の初期値で編集ダイアログを開く。
  **存在しない id は無視する**（`?file=` と同型の多層防御）

## 6. 対象ファイル

**新規**: `lib/actions/manuscript-generate.ts` / `lib/editor/manuscript-naming.ts` / `lib/editor/entry-sync.ts` /
`lib/board/scene-store.ts` / `components/board/generate-manuscripts-dialog.tsx` /
`components/board/linked-scene-list.tsx` / 本SPEC

**変更**:

| ファイル | 内容 |
|---|---|
| `lib/git/github.ts` | `ManuscriptTreeEntry` に `size: number` を追加（trees API の既存レスポンスを拾うだけ） |
| `lib/actions/manuscripts.ts` | 進捗用に `getManuscriptFileStatus(projectId)`（gate 型 ＋ `Record<path, size>`）を追加。`getManuscriptFiles` は無変更 |
| `lib/actions/editor/chapters.ts` | `chapterScaffold` の引数化、`appendChapterToEntry` の移動と import。`createChapter` の外部挙動は無変更 |
| `lib/actions/scenes.ts` | プライベートヘルパを `lib/board/scene-store.ts` へ移動 |
| `components/board/beat-board.tsx` / `outline-board.tsx` | 承認 toast のアクション化・CTA バー・ヘッダ集計・生成ダイアログ呼び出し・進捗の遅延取得・`initialSceneId` |
| `components/board/scene-card.tsx` / `chapter-card.tsx` | 進捗バッジ |
| `components/board/scene-dialog.tsx` / `chapter-dialog.tsx` | 原稿ファイル欄に「新規作成」ボタン |
| `app/(app)/projects/[id]/board/page.tsx` | `searchParams.scene` を渡す |
| `app/(app)/projects/[id]/editor/page.tsx` / `manuscript/page.tsx` | 紐づけシーンを引いて子へ渡す |
| `components/editor/editor-sidebar.tsx` / `vertical-editor.tsx` / `components/manuscript/manuscript-workspace.tsx` | 逆引きパネルの受け渡しと表示（props 追加のみ） |

## 7. 既知の限界

- **コミット成功後に DB の upsert が失敗すると、紐づかない孤児ファイルがリポジトリに残る。**
  再実行は既存名を避けて採番するため二重作成になりうる。生成前のファイル名プレビューで予防し、
  復旧は「エディタでファイルを開き、ダイアログの select で手動紐づけ」または「リポジトリ側で削除」とする
  （supabase-js にトランザクションがなく、GitHub コミットとDB更新をまたぐ原子性はそもそも作れない）
- 予約帯（`00`＝扉、`90〜99`＝あとがき・奥付）の前提が崩れたリポジトリでは番号が飛ぶ（動作はする）
- 生成後にボードを並べ替えても本の出力順は変わらない（SPEC-board-chapters §3.4 の決定）
- 雛形に書き込まれるシーン番号・タイトルは作成時点の値で、以後追従しない

## 8. スコープ外

- `book.config.js` の entry をボード順に追従させる双方向同期（恒久的にやらない）
- 生成済みファイルのリネーム・削除・並べ替え（既存の書籍設定フォームと VS Code 等に委ねる）
- 原稿ファイルからボードへの逆生成（ファイルを読んでシーンを作る）
- 章・シーン単位の文字数集計（`writing_progress` はプロジェクト単位の総文字数のまま）
- Issue #215 の修正。別扱いとする

## 9. E2E検証手順（完了条件）

検証は**検証専用プロジェクト＋検証用リポジトリ**で行う（TESTING.md §0 のデータ保護ルール）。

1. **前提未達**: repo 未設定・PAT 未登録のプロジェクトで、生成ボタンが誘導文とともに無効化されること（落ちない）
2. **単体作成**: シーンダイアログの「原稿ファイルを新規作成」→ ファイル名が自動提案される →
   作成 → コミットが1つ作られ、select にそのパスが入り、カードに原稿バッジが出る
3. **雛形の中身**: 作成された章扉に `# 章タイトル`、シーンに `<!-- シーンタイトル（N） -->` が入っていること。
   全体プレビューでコメントが組版に出ないこと
4. **entry 追記**: `book.config.js` の entry に追記され、エディタの章一覧に entry 順で並ぶこと
5. **一括生成**: 構成レビューを承認 → CTA バーが出る → 「まとめて作成」→ 対象一覧とファイル名プレビュー →
   実行 → **1コミット**で全ファイルと `book.config.js` が反映されること（コミット履歴で件数を確認）
6. **上書き防止**: 既に紐づいているシーンが対象一覧に出ないこと
7. **章扉の除外**: 章行のチェックを外して実行すると、シーンのファイルだけが作られること
8. **entry 追記の失敗**: entry を解析できない `book.config.js` でも、ファイル生成は成功し
   「entry 未登録」として一覧末尾に出ること
9. **進捗バッジ**: 作成直後は「未執筆」、本文を書いて保存すると「執筆中」に変わること。
   リポジトリからファイルを消すと「見つかりません」になること
10. **逆引き**: エディタで章を開くと「この原稿のシーン」にタイトルと構成メモが出る。
    クリックでボードへ遷移し、該当シーンのダイアログが開くこと。存在しない `?scene=` で落ちないこと
11. **原稿タブ**: 同じ逆引きパネルが出ること。既存の校正・講評・履歴が壊れていないこと（回帰）
12. **レート制限**: 一括生成を短時間に繰り返すと日本語のレート制限エラーが出て、途中コミットが残らないこと
13. **Issue #215 の非悪化**: シーンダイアログの原稿ファイル読み込み中に閉じる操作が、
    改修前と同じ挙動であること（悪化させていないことの確認。修正は別Issue）

※ GitHub への書き込み・レート制限・パス検証を含むため **security-reviewer ゲートの対象**とする。
