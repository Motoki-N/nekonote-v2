// 原稿の検索置換（Issue #263）の中核ロジック。
// UI・IndexedDB・GitHub から切り離した純粋関数だけを置く（呼び出し側でテストしやすくする）。
//
// 対応するのは「単純な文字列置換」のみ（正規表現は扱わない）。
// 表記ゆれの一括修正が用途であり、正規表現を入れると誤爆の被害が
// 原稿全体に及ぶため、意図的にスコープから外している

/** 1ファイル内で表示する該当箇所プレビューの上限（多すぎるとダイアログが読めなくなる） */
export const MAX_HITS_PER_FILE = 20;

/** 該当箇所1件（プレビュー表示用。位置ではなく「人が読んで確認できる情報」を持つ） */
export type ReplaceHit = {
  /** 1始まりの行番号 */
  line: number;
  /** 置換前のその行 */
  before: string;
  /** 置換後のその行 */
  after: string;
};

/** 1ファイルぶんの置換プラン（実際に書き込むかは呼び出し側の判断） */
export type FileReplacePlan = {
  path: string;
  /** そのファイル内の該当件数（MAX_HITS_PER_FILE で切り詰められない実数） */
  count: number;
  /** 該当箇所のプレビュー（先頭 MAX_HITS_PER_FILE 件） */
  hits: ReplaceHit[];
  /** 置換後の全文 */
  nextContent: string;
};

/** 文字列 `search` の出現回数（重なりなしで前方から数える） */
export function countOccurrences(content: string, search: string): number {
  if (search === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = content.indexOf(search, from);
    if (index === -1) return count;
    count += 1;
    // 置換語に検索語が含まれても無限ループにならないよう、必ず検索語ぶん進める
    from = index + search.length;
  }
}

/**
 * 1ファイルぶんの置換プランを作る。該当が無ければ null。
 *
 * `hits`（プレビュー）は行単位で作るため、**検索語が1行に収まることを前提とする**
 * ——改行をまたぐ検索語では `count` だけが立って `hits` が空になる。
 * 現在の唯一の呼び出し側（置換ダイアログ）は `<input type="text">` で検索語を受け取り、
 * これは仕様上 value から改行を取り除くため前提は常に満たされる。
 * 複数行の検索語を渡す呼び出しを足すなら、ここのプレビュー生成も直すこと
 */
export function planFileReplace(
  path: string,
  content: string,
  search: string,
  replacement: string,
): FileReplacePlan | null {
  const count = countOccurrences(content, search);
  if (count === 0) return null;

  const lines = content.split("\n");
  const hits: ReplaceHit[] = [];
  for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i += 1) {
    const before = lines[i];
    if (!before.includes(search)) continue;
    hits.push({
      line: i + 1,
      before,
      after: before.split(search).join(replacement),
    });
  }

  return {
    path,
    count,
    hits,
    // split/join は重なりなしの単純置換になり、置換語に検索語が含まれても再置換されない
    nextContent: content.split(search).join(replacement),
  };
}

/** 複数ファイルの置換プラン（該当のあるファイルのみ・渡された順序を保つ） */
export function planReplace(
  files: readonly { path: string; content: string }[],
  search: string,
  replacement: string,
): FileReplacePlan[] {
  if (search === "") return [];
  return files.flatMap((file) => {
    const plan = planFileReplace(file.path, file.content, search, replacement);
    return plan === null ? [] : [plan];
  });
}

/** プラン全体の該当件数の合計 */
export function totalHitCount(plans: readonly FileReplacePlan[]): number {
  return plans.reduce((sum, plan) => sum + plan.count, 0);
}
