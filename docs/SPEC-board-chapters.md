# SPEC-board-chapters: 章の導入と両ボードの統一

作成日: 2026-08-30（インタビュー駆動で策定）
ステータス: **確定**（2026-08-30 プラン承認をもって設計確認とする）
起点: 構成検討→執筆開始の連携不足の指摘（Issue 未起票の段階で調査 → 設計インタビュー2巡）
関連: SPEC-beat-board / SPEC-outline-board / SPEC-structure-templates / SPEC-manuscript-bridge（本SPECに依存する後続）

## 1. 目的

ビートボードは「シーン」を最小単位として構成を組み立てるが、**複数のシーンを束ねる「章」の概念を持たない**。
一方、縦書きエディタは親SPEC（SPEC-vertical-editor §3）で

> 章ファイル分割により「Gitの差分」「ネコノテのレビュー単位」「目次の章立て」が1対1で対応する

と定め、**1ファイル = 1章**を前提に設計されている。
ところが Issue #56 で後から足されたボード⇄原稿の紐づけは **1シーン = 1ファイル**（`scenes.manuscript_path`）であり、
**両者の間に「章」という層が欠けたまま接続されている**。

本SPECは、この欠けた層を埋める。あわせて、非小説ジャンルの目次ボードが `scenes.part='chapter'` で
表現しているフラットな「章」を、同じ仕組みへ統一する。

前提（決定済み・変更しない）:

- **1シーン = 1原稿ファイル**の粒度は維持する（Issue #56 の決定を覆さない）
- **章立ては任意**。章を1つも作らずに全体を構成してもよい
- **章自体も原稿ファイルを持つ**（章扉。シーンのファイル群の前に入る）
- **章は構成テンプレートのパートをまたげる**（章と部は独立した軸）

原稿ファイルの生成・進捗の可視化・逆引きは **SPEC-manuscript-bridge** が扱う。本SPECは
「章という単位をボード上に置けるようにする」ところまでを対象とする。

## 2. 決定事項（2026-08-30・設計インタビュー2巡の結果）

| 論点 | 決定 |
|---|---|
| 章のデータ表現 | **`scenes.kind`（`'scene'` \| `'chapter'`）を1列追加**し、章を「並びの中の区切り行」として表す。**独立テーブル `chapters` は作らない** |
| 章とシーンの所属 | **保存しない。正準順序上の位置から導出する**（直前の章マーカー行がその章）。所属列も中間テーブルも持たない |
| 連続性の担保 | **不要**。所属が位置から導出されるため、章に属するシーンは定義上つねに連続する。検証関数もエラーメッセージも作らない |
| 章と部の関係 | 正準順序は全レーンを連結した1本の列なので、**章がレーン境界をまたぐのは自然な帰結**。追加機構なし |
| 章マーカーの列の使い方 | 既存列を再利用: `title`=章タイトル / `content`=章のメモ / `manuscript_path`=**章扉ファイル** / `order_index`=並び / `part`=章が始まるレーン / `anchor`・`emotion_delta`=常に null / `status`=使わない（`draft` のまま） |
| 目次ボードの統一 | 既存 `part='chapter'` 行に `kind='chapter'` を立てるだけ。**行の移動・再作成はしない**。描画フィルタを `part` から `kind` へ変更する |
| 空の章 | **許容する**（章扉だけ先に置く運用があるため） |
| D&D で章境界をまたいだシーン | **所属章が変わる**（意図した意味論。スライドをセクション間で移動するのと同じ） |
| 章の削除 | 区切りのみ削除。**属していたシーンは前の章に移り、原稿ファイルは削除しない** |
| レビューへの反映 | 小説の構成レビュー入力に**章見出しを差し込む**。シーンの通し番号（Issue #213）は**章マーカーが消費しない** |

## 3. データ

### 3.1 マイグレーション

`supabase/migrations/20260830000001_board_chapter_marker.sql`

```sql
alter table public.scenes
  add column kind text not null default 'scene'
    check (kind in ('scene', 'chapter'));

-- 目次ボードの既存章カードを章マーカーへ（行の移動・再作成はしない）
update public.scenes set kind = 'chapter' where part = 'chapter';

-- part='chapter'（目次レーン）は章マーカー専用
alter table public.scenes
  add constraint scenes_chapter_part_check
  check (kind = 'chapter' or part <> 'chapter');

-- 逆引き用（SPEC-manuscript-bridge §4.4・§5.5）
create index scenes_project_manuscript_path_idx
  on public.scenes (project_id, manuscript_path)
  where manuscript_path is not null;
```

- **RLS 変更なし。** 既存の `scenes_owner_via_project`（20260712000002）がそのまま効く。
  新テーブルを作らないため、新規ポリシー・新規 revoke・`updated_at` トリガー登録がいずれも不要
- `order_index` に unique 制約はない（index のみ）ため、マーカー行を列に差し込むのに制約変更は要らない
- **ロールバックは `kind` 列を落とすだけ**でデータが失われない（移行が `update` 1文で、行を動かしていないため）

- **移行の規模（2026-08-30 実測）**: 本番の `scenes` は全体で約27行（`supabase inspect db table-stats`）。
  `update` の対象はこのうち `part='chapter'` の行のみで、実行時間・ロック時間とも問題にならない

**適用前に `npx supabase db dump` を取得すること。** 本番 Supabase は PITR 無効・物理バックアップ0件で、
自前ダンプが唯一の復旧経路である（RUNBOOK §5.1）。

### 3.2 なぜ独立テーブルではないのか

`.claude/skills/draft-to-clean-model` の判断基準に照らす。

1. **基準1（テンプレでノートに書いてもらう）では足りない。** 章はボードの描画・原稿ファイル生成の採番・
   entry への追記順という、画面とサーバーが確実に構造参照する対象である
2. **基準2（構造参照する項目だけカラム化）に収まる。** 追加は `kind` 1列のみで、章タイトル・メモ・原稿パスは
   `scenes` の既存列の再利用。新しい概念のための新しい列は増えない
3. **基準3（独立テーブル＝思想への逸脱としてユーザー確認）に到達しない。**
   `docs/第一期・第二期比較.md` の「`chapters` テーブルを作らなかったのは正しかった」という総括と整合する

`docs/manual.md` §1.1 は「アプリは『キャラクター表』『章立て表』のような固定の入力フォームを持たない」と
述べているが、同節は続けて「構成設計と原稿だけは例外的に構造を持つ。並び順や転換点、感情の起伏は、
AIと画面が構造として読む必要があるためである」と例外を定めている。**章マーカーはこの既存の例外の延長**であり、
新しい例外を作らない（`scenes` の並びに1種類のカードを足すだけで、新しい順序も新しい器も作らない）。

### 3.3 採用しなかった案

**案B: 独立テーブル `chapters` ＋ `scenes.chapter_id`**

1. `docs/第一期・第二期比較.md` の総括と真っ向から衝突する。覆すには「思想への逸脱」としての確認が別途要る
2. **順序の一次情報が2つになる。** `scenes.order_index` と `chapters.order_index` が独立に動くため、
   「章順とシーン順が食い違う」状態を検証・修復するコードが要る。採用案は列が1本なのでこの矛盾を表現できない
3. 既存 `part='chapter'` 行の移行が「別テーブルへの引っ越し」になり、その行に紐づく `scene_notes` と
   レビューセッション（`review_sessions.target_ref`）の扱いを個別に決める必要が出る
4. RLS ポリシー・revoke 一覧・`updated_at` トリガー・`database.types.ts` の追加が必要になり、
   security-reviewer の対象範囲が広がる
5. `SceneCardContent` / `updateScene` / `reorderScenes` / `deleteScene` / `persistChanges` の全部に
   章用の双子を作ることになる

**案C: 先頭シーンへのマーカー列**（`chapter_title` / `chapter_manuscript_path` を先頭シーン行に持たせる）

1. **1行が「シーンの原稿ファイル」と「章扉ファイル」を同時に持つ**ため、カード1枚に2本のファイルがぶら下がる
2. 目次カードを「先頭シーン兼章」に変形させる移行が必要になり、統一が複雑化する
3. 先頭シーンを削除すると章が消える。章に属するシーン0枚が表現できない

### 3.4 章順の一次情報をどこに置くか（二重管理の回避）

エディタには既に「章構成（entry）」の並べ替えUI がある（SPEC-vertical-editor-phase3 §7-2 /
`components/editor/settings-dialog.tsx` / `lib/actions/editor/book-settings.ts` の `saveBookConfig`）。
ボードにも章順が生まれるため、分界線を明記する。

- **DB が持つのは「構成（プラン）の順序」。** `scenes.order_index` がすでにそれを持っており、
  章マーカーは新しい順序を作らない
- **本の出力順の一次情報は `book.config.js` の `entry` のまま。**
  `lib/actions/editor/context.ts` の `listChapters` が entry 順を正とする挙動は**無変更**
- **同期は一方向・1回きり**（原稿ファイル生成時にボード順で entry へ追記。SPEC-manuscript-bridge §5.3）。
  逆方向（entry を読んでボードを並べ替える）も、生成後の追従（ボードを並べ替えたら entry も並べ替える）も
  **やらない**。やった瞬間に二重管理になる
- 章タイトルの実体も原稿ファイル側（frontmatter / `#` 見出し）にある。DB の `title` は構成カードのラベルであって、
  リポジトリへ同期しない（生成時の初期値としてのみ使う）
- **entry の編集口は今後も書籍設定フォーム1箇所**とする

## 4. 正準順序と導出

`toCanonicalOrder`（`lib/board.ts`）は**無変更**。章マーカーは普通のカードとして各レーンに混ざり、
`order_index` が 0..N-1 で振り直される。`lib/board.ts` に純関数を2本追加する。

```ts
/** 正準順序の全行を、章マーカーを区切りにグループ化する（章に属さない先頭群は chapter: null） */
export function groupByChapter(scenes: SceneRecord[]): {
  chapter: SceneRecord | null;
  number: number | null;   // 1..M（章マーカーの出現順）
  scenes: SceneRecord[];   // kind='scene' のみ
}[]

/** シーンID → 所属章番号（章なしは null）。カードのラベル・レーン先頭の「つづき」表示に使う */
export function chapterNumberByScene(scenes: SceneRecord[]): Record<string, number | null>
```

- 章に属するシーンは**定義上つねに正準順序で連続する**。D&D でどう動かしても崩れないため、
  `findTurningPointOrderViolation` のような検証の砦を増やさない
- 章が部をまたぐケースは、正準順序が全レーンを連結した1本の列であることから自動的に成立する。
  章マーカーの `part` は「章が始まるレーン」を意味するだけ
- 派生的な性質として「1つの章が含む部は連続した部になる」。自然な帰結であり制限にならない

### 4.1 既存の順序系ロジックへの影響

| 対象 | 影響 |
|---|---|
| `toCanonicalOrder` | **無変更** |
| `findTurningPointOrderViolation` | **無変更**（章マーカーは `anchor === null` なのでスキップされる） |
| `computeEmotionArc` / `EmotionLine` | 入力を `kind === 'scene'` で絞る（現在の `part !== 'chapter'` フィルタの置き換え） |
| `sceneNumbers`（Issue #213 の通し番号） | 同上。**章マーカーは番号を消費しない**＝AIレビューの採番との一致を維持 |
| `reorderScenes` の全件一致検証 | **無変更**。章マーカーも並びに含めて全件送信する（SPEC-outline-board §4 の方式をそのまま拡張） |
| `switchStructureTemplate` | 章マーカーも先頭レーンへ寄る。相対順が保たれるので**章の所属関係は保全される**。確認ダイアログの文言に一行追記 |

## 5. 画面とUX

### 5.1 ビートボード

- **章マーカーカード**（`components/board/chapter-card.tsx` 新規）
  - レーン内のカード列にインラインで並ぶ。`border-dashed` ＋ `bg-muted/50` ＋ 左肩に Badge「第3章」
  - タイトル・メモ抜粋・原稿バッジ（`ManuscriptBadge` を `scene-card.tsx` から切り出して共用）
  - `useSortable` でシーンと同じ `SortableContext` に載せる（章の位置＝章の始まり位置なので、
    章の移動＝所属の変更として自然）
  - **色はテーマ用CSS変数のみ。新しいテーマ色は追加しない**
- **章が部をまたぐことの可視化**: 章マーカーを含まないレーンの先頭に、淡い1行ラベル「第3章のつづき」を出す
  （`chapterNumberByScene` からの導出値。カードではないので D&D の対象外）
- **追加導線**: `components/board/lane.tsx` のレーンフッタ「＋シーンを追加」を `DropdownMenu` 化し、
  「シーンを追加」/「章の区切りを追加」の2択にする
- **ヘッダ**: 「章 M / シーン N枚」＋既存の構成承認バッジ（原稿の件数は SPEC-manuscript-bridge §4.1）
- **削除**: 既存の `AlertDialog` パターン。文言は
  「この章の区切りを削除します。章に属していたシーンは前の章に移ります。原稿ファイルは削除されません」

### 5.2 目次ボード（統一）

- 描画フィルタを `part === 'chapter'` から **`kind === 'chapter'`** へ変更する。
  これでジャンルを小説→技術書に切り替えたプロジェクトでも、ビートボードで作った章がそのまま目次に並ぶ
- D&D は「同一 `part` 内でのみ `arrayMove`」に一般化する（純粋な目次プロジェクトでは全件 `part='chapter'` なので
  現状と同挙動。混在時のみ効く安全弁）
- `PART_LABEL.chapter = "章"` は**そのまま残す**（目次レーンのラベルとして正しい）。
  `scenePartsAll` / `CHAPTER_PART` も無変更
- **1カード1ファイルの保証**: 目次ボードに描画されるのは `kind='chapter'` 行のみ。シーン行は目次ボードに出ない。
  したがって目次カードが持つファイルは常に `manuscript_path` 1本

### 5.3 ダイアログの共通化

`components/board/outline-dialog.tsx` は「タイトル・メモ・原稿ファイル・削除」だけを持ち、
章マーカーの編集内容と完全に一致する。**`components/board/chapter-dialog.tsx` へ改名し、両ボードから使う**
（新規コンポーネントを書かない）。変更点は2つだけ:

1. 保存時の固定値を `part: 'chapter'` 固定から「渡された `part` を維持」に変える
2. 「原稿ファイルを新規作成」ボタンの追加（SPEC-manuscript-bridge §4.2）

### 5.4 レビュー入力への章の反映

`lib/ai/prompts.ts` の `buildStructureReviewInput`:

- 可視判定を `kind` ベースに変える。非小説= `kind === 'chapter'`。小説はビートボードのカード列
  （= `part !== 'chapter'`。シーンと章マーカーの両方）を走査し、シーンだけに番号を振る
  ——章見出しを差し込むには章マーカーが走査対象に残っている必要があるため
- **小説の構成レビュー入力に章見出しを差し込む。** 章マーカーの位置に `## 第3章 〇〇` の見出し行を置き、
  続くシーン群がその章に属することを AI が読めるようにする。シーンの通し番号は章マーカーを飛ばして
  連続させる（画面の通し番号と一致させる。Issue #213 の規約）
- `buildSceneReviewInput` の全シーン一覧も `kind` で除外する

入力肥大化ガード（`CRITIQUE_MAX_CHARS`）の数え方は変更しない（章見出しは1行のため実質影響がない）。

## 6. 対象ファイル

**新規**: `supabase/migrations/20260830000001_board_chapter_marker.sql` / `components/board/chapter-card.tsx` / 本SPEC

**改名**: `components/board/outline-dialog.tsx` → `components/board/chapter-dialog.tsx`

**変更**:

| ファイル | 内容 |
|---|---|
| `lib/database.types.ts` | `npm run db:types` で再生成 |
| `lib/schemas/enums.ts` | `sceneKinds = ["scene","chapter"]` / `SceneKind` を追加 |
| `lib/board.ts` | `SceneRecord.kind` 追加、`groupByChapter` / `chapterNumberByScene` 追加 |
| `lib/actions/scenes.ts` | `SCENE_COLUMNS` に `kind`。`createScene(projectId, part, kind)` へ拡張（`kind='scene'` × `part='chapter'` を拒否、初期本文テンプレの条件を `kind` 判定へ）。`persistChanges` の upsert ペイロードに `kind` を含める（新規行の挿入に必要）。`duplicateScene` は `kind` を引き継ぐ |
| `lib/ai/prompts.ts` | §5.4 |
| `app/api/review/route.ts` | `fetchScenes` の select に `kind` |
| `app/(app)/projects/[id]/board/page.tsx` | select に `kind` |
| `components/board/beat-board.tsx` | `novelScenes` の判定を `kind` へ。章マーカーの描画受け渡し・追加導線・ヘッダ集計・削除文言 |
| `components/board/lane.tsx` | カード列に章マーカーを混在描画。追加ボタンを2択の `DropdownMenu` へ |
| `components/board/scene-card.tsx` | `ManuscriptBadge` を章カードと共用できる形に切り出し |
| `components/board/outline-board.tsx` | 描画フィルタを `kind` へ。D&D の同一 part 制約 |
| `components/board/scene-dialog.tsx` | `CHAPTER_PART` フィルタを `kind` へ |

> ⚠️ `scenes` の select 列挙が**3箇所に重複**している（`lib/actions/scenes.ts` の `SCENE_COLUMNS` /
> `app/(app)/projects/[id]/board/page.tsx` / `app/api/review/route.ts`）。`kind` を足すときは3箇所とも揃えること。

## 7. スコープ外

- 章・節の2階層化（SPEC-outline-board §7 のまま据え置き。実需が出たら別途起票）
- 原稿ファイルの生成・進捗の可視化・逆引き（**SPEC-manuscript-bridge**）
- `book.config.js` の entry をボード順に追従させる双方向同期（§3.4 の決定により恒久的にやらない）
- 章単位のレビュー（構成レビュー・シーンレビューの2種のまま）
- 章マーカーへのノート紐づけ・感情・転換点アンカー（いずれもシーンの項目）
- Issue #215（原稿ファイル読み込み中にシーンを閉じるとフリーズ）の修正。別扱いとする

## 8. E2E検証手順（完了条件）

1. **マイグレーション**: 適用前に `npx supabase db dump` を取得。適用後、既存の目次プロジェクトの章カードが
   件数・タイトル・メモ・原稿紐づけ・順序すべて無傷であること
2. **章の追加**: 小説プロジェクトのレーンフッタから「章の区切りを追加」→ ダイアログが開く →
   タイトル入力 → 閉じて保存 → リロードで復元
3. **部をまたぐ章**: 設定レーンの途中に章を置き、反応レーンの先頭に「第N章のつづき」ラベルが出ること
4. **D&D**: 章マーカーをレーン内・レーン間で動かせること。シーンを章境界をまたいで動かすと所属章が変わること。
   リロードで順序が保持されること
5. **通し番号**: 章マーカーを追加してもシーンの通し番号が変わらないこと（章は番号を消費しない）
6. **感情の折れ線**: 章マーカーが折れ線の点として現れないこと
7. **転換点**: 境界アンカーのレーン末尾固定・転換点の相対順検証が章マーカー混在でも従来どおり動くこと
8. **削除**: 章を削除すると区切りだけが消え、属していたシーンが前の章に移ること。原稿ファイルは残ること
9. **テンプレ切替**: 章マーカーも先頭レーンへ寄り、章の所属関係（相対順）が保全されること
10. **目次ボード**: 技術書プロジェクトで章カードが従来どおり表示・追加・並べ替え・編集・削除できること。
    ジャンルを小説から切り替えたプロジェクトで、ビートボードで作った章が目次に並ぶこと
11. **構成レビュー**: 小説の構成レビュー入力に `## 第N章 〇〇` の見出しが入り、シーンの番号が画面と一致すること。
    非小説の目次レビューが従来どおり動くこと
12. **RLS回帰**: anon キーの REST SELECT で `scenes` が拒否されること（既存ポリシーの確認のみ）

※ マイグレーションを伴うため **security-reviewer ゲートの対象**とする（新規ポリシーはないが CHECK 制約と
既存ポリシーの適用範囲の確認）。
