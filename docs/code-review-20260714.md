# コードレビュー結果（2026-07-14）

直近の実装3コミットに対する厳格レビューの記録。修正は別セッションで1件ずつ検討・対応する。
各指摘の「状態」を更新しながら消化していくこと（未対応 / 対応中 / 対応済み / 対応しない（理由））。

**→ 2026-07-14 修正セッションで全9件対応済み。末尾「対応結果」参照。**

## レビュー対象

| コミット | 内容 |
|---|---|
| `b3b2594` | feat: 構造化スケジュール保存・メモの自動ノート化（SPEC-schedule-and-memo-tools・AIツール呼び出し初導入） |
| `32f06fd` | feat: キャラクターレビュー実行UI（SPEC-character-review） |
| `6d973f3` | refactor: middleware.ts → proxy.ts（Next.js 16 proxy規約） |

- 差分に加え、現行の関連ファイル（review route全体・review-validation・SPEC・seedマイグレーション・スキーマ定義）を突き合わせて確認
- `npm run typecheck` / `npm run lint` は両方エラーなしで通過（レビュー時点）

## 総評

**Critical / High はゼロ。** RLS依存の所有確認、`resolveProfileForPhase` によるプロファイルとphaseの整合検証、jsonbの読み書き両側でのzod検証、verdict/status遷移のproposal限定化など、疑ってかかった箇所はいずれも裏が取れた。

---

## Medium

### M-1. 締めのテキストが空だと、ツール実行結果がセッション内からも消える

- **状態**: 対応済み（`mergeToolParts` をマッチしなかったカード保持メッセージを元の並び位置へ残す方式に変更。補足の誤付着エッジは順方向マッチのまま許容）
- **該当**: `components/dashboard/consult-panel.tsx` の `mergeToolParts`（73行付近）＋ `app/api/chat/route.ts` の `onEnd`（`if (content) rows.push(...)`、270行付近）
- **何が問題か**: サーバー側 `onEnd` はテキストが空のassistantメッセージをDBに保存しない。一方クライアントは応答完了後300ms/1500msでDBの内容にメッセージ一覧を差し替え、`mergeToolParts` は「role＋テキスト一致」でツールカードを引き継ぐ。モデルがツール実行だけして締めのテキストを出さなかった場合（`stopWhen: stepCountIs(3)` を3ステップともツールで使い切った場合も同様）、DB側に対応するメッセージが存在しないため、保存は成功しているのにカードごとassistantの応答が画面から消える。
- **なぜ問題か**: プロンプトで「必ず締めの文を返す」と指示しているが、モデルの遵守は保証されない。ユーザーには「保存されなかった」ように見え、再保存（スケジュールなら丸ごと上書き、メモなら重複ノート）を誘発する。
- **修正方針**: `mergeToolParts` で、`next` にマッチしなかったツールカード保持メッセージを捨てずに元の位置（またはリスト末尾）へ残す。あるいはサーバー側で、ツールpartを持つ応答はテキスト空でも空文字以外のプレースホルダで保存するかを検討。前者がシンプル。
- **補足（同関数の別エッジ）**: テキストが完全一致するassistantメッセージが同一セッションに2件あり後者だけがツールpartを持つ場合、順方向マッチにより先のメッセージへカードが誤付着し得る（表示位置がずれるだけの軽微な問題）。

### M-2. `toggleMilestone` 同士の競合には楽観ロックが効かない

- **状態**: 対応済み（新フィールドは足さず、`savedAt` を「最終書き込み日時＝リビジョン」と再定義してトグルでもバンプ。全書き込み経路で比較・更新が揃い、トグル同士の競合も conflict として検出される）
- **該当**: `lib/actions/schedule.ts` の `toggleMilestone`（savedAt楽観比較、57〜66行付近）
- **何が問題か**: `savedAt` による楽観比較は「チャットでの上書き保存 vs トグル」の競合だけを防ぐ。トグルは `savedAt` を更新しないため、トグル vs トグル（別タブ・別デバイス）は read-modify-write の競合になり、先行したトグルの結果が後続の書き込みで巻き戻る。スケジュール全体を丸ごとUPDATEする方式なので、失われるのはチェック状態1件分。
- **なぜ問題か**: 実害は小さい（シングルユーザー・チェック1個）が、「楽観ロックを入れた」という安心感と実際の保護範囲がずれており、将来スケジュールに書き込み経路が増えたときに気づきにくい穴になる。
- **修正方針**: 書き込みのたびに更新されるリビジョン（`rev` カウンタか `updatedAt`）をスキーマに足し、全書き込み経路でそれを比較・更新する。現状の規模なら「既知の制約」としてコメントで明示するだけでも可。その場合 `savedAt` 比較のコメントに保護範囲の限定を書き足すこと。

### M-3. `ToolOutput` の契約がサーバーとクライアントで手動二重定義

- **状態**: 対応済み（`SaveMemoNoteOutput` / `SaveScheduleOutput` を lib/schemas/schedule.ts に定義し、route.ts の execute 戻り値注釈とクライアントの結果カードの両方で参照。zod化はツール出力が実際に複雑化するまで見送り＝アサーション1箇所は残る）
- **該当**: `components/dashboard/consult-panel.tsx` の `ToolOutput` 型（64行付近）と `app/api/chat/route.ts` の execute 戻り値（117〜178行付近）
- **何が問題か**: クライアント側は「route.ts と対応」というコメント頼みの手書き型＋ `part.output as ToolOutput` のアサーションで、サーバー側の戻り値を変えても型エラーで検知できない。
- **なぜ問題か**: ツールは今後増える方針（今回が初導入）なので、フィールド追加・rename時にカード表示が静かに壊れる（`undefined` 表示）リスクがある。
- **修正方針**: `lib/schemas/schedule.ts`（または新設の共有モジュール）にツール出力の型を定義し、route.ts の execute 戻り値とクライアントの両方でimportする。zodスキーマ化して `safeParse` すればアサーション自体も消せる。

## Low

### L-1. 期日の日付表示がタイムゾーン依存（判定ロジックと不整合）

- **状態**: 対応済み（`dateFormat`・`dueLabel` の両フォーマッタに `timeZone: "UTC"` を明示。YYYY-MM-DD＝UTC深夜をそのまま整形する方式で、DeadlineCountdown・最新文字数の日付表示もまとめて解消）
- **該当**: `components/dashboard/project-overview-card.tsx` の `dueLabel`（74〜79行付近）。既存の `DeadlineCountdown` も同様
- **何が問題か**: `daysUntil` は文字列同士の比較でTZ非依存と明記されている一方、表示側は `new Date("YYYY-MM-DD")`（UTC深夜として解釈）を端末ローカルTZで整形する。UTCより西のTZでは日付が1日前に表示される。サーバー側は `jstDate` でJST固定しており方針が揃っていない。
- **修正方針**: `dueDate.split("-")` から表示文字列を組むか、`Intl.DateTimeFormat` に `timeZone: "UTC"` を渡す。実利用者がJSTのみなら優先度は低いが、直すコストも極小。

### L-2. `deleteSchedule` には競合ガードがない

- **状態**: 対応済み（挙動は変えず、「削除＝今あるものを消す意図なので楽観比較しない」を設計判断として doc コメントに明記）
- **該当**: `lib/actions/schedule.ts` の `deleteSchedule`（78〜98行付近）
- **何が問題か**: 削除ダイアログを開いている間にチャット側で新しいスケジュールが確定保存されると、ユーザーが見たものと違う（保存されたばかりの）スケジュールを消す。「削除＝あるものを消す意図」と解釈すれば許容だが、`toggleMilestone` にだけロックがある非対称は設計判断としてコメントに残す価値がある。

### L-3. 7日ペース計算のロジック重複

- **状態**: 対応済み（`lib/writing-progress.ts` に純関数 `deltaSince(rows, today, days)` を新設し、route.ts の delta7/delta30 とカードの `recentPace` を両方これに乗せ替え。境界日計算は today 文字列基準に統一＝JSTはDSTなしのため従来と同値）
- **該当**: `components/dashboard/project-overview-card.tsx` の `recentPace`（83行付近）と `app/api/chat/route.ts` の `deltaSince`（82〜91行付近）
- **何が問題か**: 「境界日以前の直近記録を基準に実スパンで割る」という同一アルゴリズムがクライアント/サーバーで別実装。片方だけ仕様変更すると、AIが語る数字とカードの数字が食い違う。
- **修正方針**: `lib/` の純関数として共通化が理想。少なくとも相互参照コメントを入れる。

### L-4. 保存失敗時にも `router.refresh()` が走る

- **状態**: 対応済み（`onFinish` の判定に `output.ok` を追加。M-3で共有化した `SaveScheduleOutput` を利用）
- **該当**: `components/dashboard/consult-panel.tsx` の `useChat` `onFinish`
- **何が問題か**: `state === "output-available"` だけを見ており、`output.ok === false`（execute内で握ったDB失敗）でもrefreshする。実害はほぼない冗長refetchだが、「保存成功時に概況カードを更新」という意図とコードがずれている。`ok` まで見るのが正確。

### L-5. `saveMemoNote` のタイトルが空文字になり得る

- **状態**: 対応済み（空なら「メモ YYYY-MM-DD」（JST）にフォールバック）
- **該当**: `app/api/chat/route.ts` の `saveMemoNote` execute（130行付近）＋ `lib/chat-title.ts`
- **何が問題か**: `chatTitleFrom` は先頭行がMarkdown記号のみ（例: `---`）だと空文字を返す。スレッドタイトル側は `if (title)` でガードしているが、`saveMemoNote` は無条件でinsertするため空タイトルのノートが作られ得る（DBは `default ''` で許容）。
- **修正方針**: 空なら「メモ YYYY-MM-DD」等のフォールバックを一段挟む。

### L-6. 細かい消し忘れ・冗長（まとめて1件扱い）

- **状態**: 対応済み（onEnd はタイトル設定UPDATEが走った経路ではトリガーにバンプを任せて2本目を省略。描画条件は `textOf(message) !== ""` に明示化。`dailyTargetChars` は独立定義に変更）
- `app/api/chat/route.ts` `onEnd`（280〜293行付近）: タイトル設定時は `set_updated_at` トリガーで `updated_at` も更新されるため、直後の updated_at バンプUPDATEがその経路では冗長（2往復）。1本のUPDATEに統合可能
- `components/dashboard/consult-panel.tsx` のメッセージ描画: `{(message.role === "user" || textOf(message)) && (...)}` は空文字を返す短絡で動作はするが、`textOf(message) !== ""` と書く方が意図が読める
- `lib/schemas/schedule.ts`: `dailyTargetChars: milestoneInputFields.targetChars` の流用は「たまたま同じ制約」の共有で、片方の制約変更がもう片方に波及する。独立に定義する方が安全

## 要確認（憶測で断定しない事項）

1. **AI SDK v5 のステップ集約**: `/api/chat` の `onEnd` は `finalMessages` の最後の1件だけをassistantとして保存している。`stopWhen` による複数ステップが単一のUIMessageに集約される前提（現行AI SDKの挙動）に依存しているため、`ai` パッケージのメジャー更新時はここが回帰ポイント。
2. **Next.js 16 proxy の `config.matcher`**: `proxy.ts` は移行ガイド通りで本番反映確認済みだが、matcher記法はNext側の非推奨変更が続いているため、次回Nextアップデート時に警告有無を再確認する。

---

## 良かった点

- **境界防御が一貫している**: ツールexecuteがRLS越しクライアントをクロージャで掴む設計、`resolveProfileForPhase` によるクライアント指定値の再検証、`approveProposal` の phase ガードなど、「クライアント入力は信用しない」が全経路で徹底されている
- **jsonbを「器」と割り切った上で読み書き両側 `safeParse`**: 不正データを未保存として退化させる方針が page.tsx / chat route / schedule actions で揃っており、マイグレーションも最小（1行）。draft-to-clean-modelの判断基準にも合致
- **キャラクターレビューの実装が「増築」でなく「共通化」**: `fetchProposalWithNotes` の抽出により proposal 分岐がむしろ短くなり、verdict/status遷移の proposal 限定もコメント付きで明示。ProposalReviewPanel が共通 ReviewPanel のラッパーである既存構造にきれいに乗っている

## 優先的に直すべき Top 3

1. **M-1**: 締めテキストなしケースでのツールカード消失（唯一「ユーザーが誤解して二重保存する」実害シナリオがある）
2. **M-3**: `ToolOutput` 契約の共有化（ツールが増える前の今が一番安い）
3. **M-2**: 楽観ロックの保護範囲の明確化（rev導入か、最低限コメントでの制約明示）

---

## 対応結果（2026-07-14 修正セッション）

全9件を「修正する」と判断し、1指摘=1コミットで対応した（各コミットに本ドキュメントの状態更新を同梱）。

| 指摘 | コミット | 対応の要点 |
|---|---|---|
| M-1 | `2522da0` | `mergeToolParts` をマッチしなかったカード保持メッセージを元の並び位置へ残す方式に変更 |
| M-2 | `a0187ca` | 新フィールドは足さず `savedAt` を「最終書き込み日時＝リビジョン」と再定義し、トグルでもバンプ（`savedAt` が UI・プロンプト非表示の内部値であることを確認済み） |
| M-3 | `9600247` | `SaveMemoNoteOutput` / `SaveScheduleOutput` を lib/schemas/schedule.ts で共有。zod化はツール出力が複雑化するまで見送り |
| L-1 | `8a9c57b` | 日付フォーマッタに `timeZone: "UTC"` を明示（DeadlineCountdown・最新文字数の日付もまとめて解消） |
| L-2 | `aad34f6` | 挙動は変えず「削除は楽観比較しない」を設計判断として doc コメントに明記 |
| L-3 | `c25db13` | `lib/writing-progress.ts` 新設・純関数 `deltaSince` に一元化（route.ts と概況カードの両方が利用） |
| L-4 | `b8f81f6` | `onFinish` の refresh 判定に `output.ok` を追加（M-3の共有型を利用） |
| L-5 | `6a0bb05` | 空タイトル時は「メモ YYYY-MM-DD」（JST）にフォールバック |
| L-6 | `82aaec6` | onEnd のUPDATE統合（タイトル設定経路はトリガーにバンプを任せる）・描画条件の明示化・`dailyTargetChars` 独立定義 |

- **検証**: 各コミットごとに `npm run typecheck` / `npm run lint` 通過。ブラウザでダッシュボード描画（L-1修正後の期日ラベル）とマイルストーントグルON→OFF実操作（M-2の `savedAt` バンプ後も楽観比較が正常・conflict なし・状態復元）を確認。コンソール・サーバーログにエラーなし
- **限界**: M-1 の再現条件（モデルが締めテキストを返さない）はAI応答依存で決定的に再現できないため、ロジック・型検証まで
- **要確認2件**（AI SDKのステップ集約・proxy matcher）は行動不要の注意書きとしてそのまま残す（`ai` パッケージ／Next のメジャー更新時に再確認）
