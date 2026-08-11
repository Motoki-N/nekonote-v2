"use server";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import {
  extractEntryPaths,
  joinRepoPath,
  parseEntryItems,
  replaceEntryItems,
} from "@/lib/editor/book-config";
import {
  createFileContent,
  getFileContent,
  putFileContent,
} from "@/lib/git/github";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  blobShaSchema,
  commitMessageSchema,
  contentSchema,
  chapterFileNameSchema,
  parseBranch,
  loadEditorContext,
  validateChapterPath,
  listChapters,
} from "./context";
import type { EditorContext } from "./context";

export type ChapterData = {
  path: string;
  content: string;
  /** blob SHA（保存の楽観ロック基準・IndexedDB待避の baseSha） */
  sha: string;
};

/** 章を開く（最新本文＋blob SHA）。復元・競合判定は呼び出し側が行う（SPEC §7） */
export async function openChapter(
  projectId: string,
  filePath: string,
  branch?: string,
): Promise<ActionResult<ChapterData>> {
  try {
    const ctx = await loadEditorContext(projectId);
    const ref = parseBranch(branch);
    const path = validateChapterPath(ctx.basePath, filePath);
    const { content, sha } = await getFileContent(
      ctx.token,
      ctx.repo,
      path,
      ref,
    );
    return { ok: true, data: { path, content, sha } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 保存＝コミット（SPEC §6）。baseSha による楽観ロック。
 * リモートが先に更新されていると conflict が返る（クライアントはマージ支援へ。SPEC §8）
 */
export async function saveChapter(
  projectId: string,
  filePath: string,
  params: {
    content: string;
    baseSha: string;
    message: string;
    branch?: string;
  },
): Promise<ActionResult<{ commitSha: string; blobSha: string }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    // コスト暴走・暴発の抑止（security-audit の作法に合わせ書き込み系に適用）
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const branch = parseBranch(params.branch);
    const path = validateChapterPath(ctx.basePath, filePath);
    const content = contentSchema.parse(params.content);
    const baseSha = blobShaSchema.parse(params.baseSha);
    const message = commitMessageSchema.parse(params.message);
    const result = await putFileContent(ctx.token, ctx.repo, path, {
      content,
      sha: baseSha,
      message,
      branch,
    });
    return { ok: true, data: result };
  } catch (error) {
    return toActionError(error);
  }
}

/** 新規章の雛形（見出しフロントマター入り。SPEC §3.3） */
function chapterScaffold(): string {
  return `---
title: 新しい章
---

# 新しい章

`;
}

/**
 * 新規章ファイルの作成＝コミット（SPEC §3.3）。`manuscripts/` 配下固定。
 * 作成後、book.config.js の entry へ自動追記する（SPEC-phase3 §7-2。
 * config がない・解析できない等で追記に失敗しても章の作成自体は成功のまま返す）
 */
export async function createChapter(
  projectId: string,
  fileName: string,
  targetBranch?: string,
): Promise<ActionResult<ChapterData & { inEntry: boolean }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const branch = parseBranch(targetBranch);
    const name = chapterFileNameSchema.parse(fileName);
    const path = joinRepoPath(ctx.basePath, "manuscripts", name);
    if (!path) throw new AppError("validation", "ファイル名が不正です");
    // 作成経路でも開く/保存と同じ検証を通す（多層防御）
    validateChapterPath(ctx.basePath, path);
    const content = chapterScaffold();
    const { blobSha } = await createFileContent(ctx.token, ctx.repo, path, {
      content,
      message: `執筆: ${name} を新規作成（ネコノテAI 縦書きエディタ）`,
      branch,
    });
    const inEntry = await appendChapterToEntry(ctx, name, branch);
    return { ok: true, data: { path, content, sha: blobSha, inEntry } };
  } catch (error) {
    return toActionError(error);
  }
}

/** entry への自動追記（ベストエフォート。失敗しても呼び出し側は「entry未登録」扱いで続行） */
async function appendChapterToEntry(
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

/**
 * 全体プレビュー用に全章の本文を entry 順で返す（明示操作時のみ。SPEC §5.2）。
 * 目次ページ（{ rel: 'contents' }）はCLIビルド時の生成物のためプレビューには含まれない
 */
export async function getAllChapterContents(
  projectId: string,
  branch?: string,
): Promise<ActionResult<{ chapters: { path: string; content: string }[] }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    const ref = parseBranch(branch);
    const { chapters } = await listChapters(ctx, ref);
    // 章数は高々数十の想定。5並列で順序を保って取得する
    const results: { path: string; content: string }[] = new Array(
      chapters.length,
    );
    let index = 0;
    async function worker() {
      while (index < chapters.length) {
        const i = index++;
        const { content } = await getFileContent(
          ctx.token,
          ctx.repo,
          chapters[i].path,
          ref,
        );
        results[i] = { path: chapters[i].path, content };
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(5, chapters.length) }, worker),
    );
    return { ok: true, data: { chapters: results } };
  } catch (error) {
    return toActionError(error);
  }
}
