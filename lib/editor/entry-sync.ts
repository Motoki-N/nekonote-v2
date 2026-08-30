import "server-only";

// book.config.js の entry への追記（SPEC-vertical-editor-phase3 §7-2・SPEC-manuscript-bridge §5.3）。
// 追記は一方向・1回きりで、生成後の並び調整は書籍設定フォームに委ねる（双方向同期はやらない）。
// "use server" ファイルは async 関数しか export できず、EditorContext（PATトークンを含む）を
// 引数に取る関数を export するとクライアントから呼べる Server Action になってしまうため、
// 共有ヘルパはこの層に置く（SPEC-manuscript-bridge §5.4）

import {
  extractEntryPaths,
  joinRepoPath,
  parseEntryItems,
  replaceEntryItems,
} from "@/lib/editor/book-config";
import type { EditorContext } from "@/lib/actions/editor/context";
import { getFileContent, putFileContent } from "@/lib/git/github";

/** entry への自動追記（ベストエフォート。失敗しても呼び出し側は「entry未登録」扱いで続行） */
export async function appendChapterToEntry(
  ctx: EditorContext,
  fileName: string,
  branch?: string,
): Promise<boolean> {
  try {
    const configPath = joinRepoPath(ctx.basePath, "book.config.js");
    if (!configPath) return false;
    const config = await getFileContent(
      ctx.token,
      ctx.repo,
      configPath,
      branch,
    );
    const items = parseEntryItems(config.content);
    if (!items) return false;
    const relPath = `manuscripts/${fileName}`;
    if (items.some((item) => item.path === relPath)) return true;
    const updated = replaceEntryItems(config.content, [
      ...items.map((item) => item.raw),
      `'${relPath}'`,
    ]);
    // 置換後に読み取り側と同じ抽出関数で検証してからコミット（SPEC-phase3 §7）
    if (!updated || !extractEntryPaths(updated).includes(relPath)) return false;
    await putFileContent(ctx.token, ctx.repo, configPath, {
      content: updated,
      sha: config.sha,
      message: `設定: ${fileName} を entry に追加（ネコノテAI 縦書きエディタ）`,
      branch,
    });
    return true;
  } catch {
    return false;
  }
}

/** ボード順の1件分の追記指示（SPEC-manuscript-bridge §5.3） */
export type EntryInsertion = {
  /** 追記する entry パス（base_path 相対。例: `manuscripts/03-chapter2.md`） */
  relPath: string;
  /** ボード順で直前にある、既に entry に載っているパス。なければ null */
  afterRelPath: string | null;
};

/** `{ rel: 'contents' }` 等の目次差し込み要素か */
function isContentsItem(raw: string): boolean {
  return /\brel\s*:\s*['"`]contents['"`]/.test(raw);
}

/**
 * entry 配列を書き戻しても壊れないか。
 *
 * `parseEntryItems` は各行の `//` 以降を行コメントとして無条件に落とすため、
 * 文字列リテラルの中に `//` があると（`href: 'https://example.com/toc'` 等）
 * 要素の raw が途中で切れ、**構文の壊れた book.config.js を書き戻してしまう**。
 * 書き戻し後の再抽出は `.md` パスしか見ないので、この破損は検知できない。
 *
 * そこで entry 配列を引用符の状態を追いながら走査し、文字列の中に `//` が
 * 現れるときだけ「書き換え不可」と判定する。テンプレートが使う行末コメント
 * （`{ rel: 'contents' }, // 目次（自動生成）...`）は文字列の外なので通る
 */
function canRewriteEntry(source: string): boolean {
  const body = source.match(/\bentry\s*:\s*\[([\s\S]*?)\]/)?.[1];
  if (body === undefined) return false;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quote !== null) {
      if (char === "\\") {
        i += 1; // エスケープの次の1文字は読み飛ばす
        continue;
      }
      if (char === quote) quote = null;
      else if (char === "/" && body[i + 1] === "/") return false;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    // 文字列の外の `//` は本物の行コメント。落として問題ない
    else if (char === "/" && body[i + 1] === "/") {
      const end = body.indexOf("\n", i);
      if (end === -1) break;
      i = end;
    }
    // ブロックコメントも読み飛ばす。中の引用符を数えてしまうと以降の
    // 文字列判定が反転し、壊れる config を「安全」と誤判定する
    else if (char === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      if (end === -1) return false;
      i = end + 1;
    }
  }
  // 引用符が閉じずに終わるのは走査モデルが破綻している証拠なので書き換えない
  // （entry 内のパスに `]` が混ざって配列の切り出しがずれた場合もここで落ちる）
  return quote === null;
}

/**
 * entry 配列へ複数パスを挿入した book.config.js の中身を返す（コミットは呼び出し側）。
 * 挿入位置は SPEC-manuscript-bridge §5.3 の規則:
 *   ①ボード順で直前にある既存パスの直後 → ②`{ rel: 'contents' }` の直後 → ③末尾。
 * `{ rel: 'contents' }` 等の非文字列要素は位置を保つ（parseEntryItems の raw をそのまま使う）。
 *
 * 解析できない・書き戻し後の再抽出で期待どおり読めない場合は null（呼び出し側はベストエフォートで
 * entry 更新をあきらめ、ファイル生成だけコミットする）
 */
export function insertEntryPaths(
  source: string,
  insertions: EntryInsertion[],
): string | null {
  // 設定ファイルはJSのため、引用符・改行・バックスラッシュを含むパスは書き込まない（多層防御。
  // 実際には chapterFileNameSchema がASCIIに限っており到達しない）
  if (insertions.some((ins) => /['"`\n\r\\]/.test(ins.relPath))) return null;

  // 行コメント除去で既存要素が壊れる config は、そもそも書き換えない
  if (!canRewriteEntry(source)) return null;

  const items = parseEntryItems(source);
  if (items === null) return null;
  const raws = items.map((item) => item.raw);
  const paths = items.map((item) => item.path);

  for (const insertion of insertions) {
    if (paths.includes(insertion.relPath)) continue; // 既に載っている
    const after =
      insertion.afterRelPath === null
        ? -1
        : paths.indexOf(insertion.afterRelPath);
    const anchor = after !== -1 ? after : raws.findIndex(isContentsItem);
    const at = anchor === -1 ? raws.length : anchor + 1;
    raws.splice(at, 0, `'${insertion.relPath}'`);
    paths.splice(at, 0, insertion.relPath);
  }

  const updated = replaceEntryItems(source, raws);
  if (updated === null) return null;
  // 読み取り側と同じ抽出関数で検証してから返す（appendChapterToEntry と同じ作法）。
  // 新規パスが読めることに加え、既存パスが1つも欠けていないことも確かめる
  const extracted = new Set(extractEntryPaths(updated));
  const before = extractEntryPaths(source);
  if (!before.every((path) => extracted.has(path))) return null;
  return insertions.every((ins) => extracted.has(ins.relPath)) ? updated : null;
}
