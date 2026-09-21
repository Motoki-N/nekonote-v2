"use server";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import { joinRepoPath } from "@/lib/editor/book-config";
import { appendChapterToEntry } from "@/lib/editor/entry-sync";
import { chapterScaffold } from "@/lib/editor/manuscript-scaffold";
import {
  createCommit,
  createFileContent,
  createTree,
  getBranchHeadShaOrNull,
  getDefaultBranch,
  getFileContent,
  getFullTree,
  putFileContent,
  updateBranchRef,
} from "@/lib/git/github";
import type { SetupTreeEntry } from "@/lib/git/github";
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

/** 一括コミットの上限（章は高々数十。ツリー1本に載る範囲で暴発を抑える） */
const MAX_BULK_FILES = 50;

export type BulkCommitFile = {
  path: string;
  content: string;
  /** 編集開始時点の blob SHA（ファイルごとの楽観ロック基準） */
  baseSha: string;
};

/**
 * 未コミットの章をまとめて1コミットにする（Issue #255 の「やりたいこと 2」）。
 * 1ファイルずつの `saveChapter` と違い Git Data API のツリーを使うため、
 * 何章あってもコミットは1つ・履歴も1行で済む（一日の終わりの区切りコミット用）。
 *
 * ファイルごとに `baseSha` を HEAD のツリーと照合し、1つでもずれていれば
 * **何もコミットせず** conflict を返す（部分的に反映されると、どこまで入ったかを
 * ユーザーが追えなくなる）。競合の解消は従来どおり章単位のマージ支援で行う
 */
export async function saveChapters(
  projectId: string,
  params: {
    files: BulkCommitFile[];
    message: string;
    branch?: string;
  },
): Promise<ActionResult<{ commitSha: string; paths: string[] }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    // 何章まとめても1コミット＝1回だけ消費する
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });
    const branch = parseBranch(params.branch);
    const message = commitMessageSchema.parse(params.message);
    if (params.files.length === 0) {
      throw new AppError("validation", "コミットする章がありません");
    }
    if (params.files.length > MAX_BULK_FILES) {
      throw new AppError(
        "validation",
        `一度にコミットできるのは${MAX_BULK_FILES}章までです`,
      );
    }
    // 開く/保存と同じ検証を通す（多層防御）
    const files = params.files.map((file) => ({
      path: validateChapterPath(ctx.basePath, file.path),
      content: contentSchema.parse(file.content),
      baseSha: blobShaSchema.parse(file.baseSha),
    }));
    const paths = new Set(files.map((file) => file.path));
    if (paths.size !== files.length) {
      throw new AppError("validation", "同じ章が重複しています");
    }

    // 衝突チェックとコミットの base_tree を同じ HEAD に揃える
    // （ずれていると、その間に入った他所の変更を無警告で巻き戻しうる）
    const targetBranch =
      branch ?? (await getDefaultBranch(ctx.token, ctx.repo));
    const headSha = await getBranchHeadShaOrNull(
      ctx.token,
      ctx.repo,
      targetBranch,
    );
    if (headSha === null) {
      throw new AppError("validation", "コミット先のブランチが見つかりません");
    }
    const { treeSha: baseTreeSha, files: baseFiles } = await getFullTree(
      ctx.token,
      ctx.repo,
      headSha,
    );
    const shaByPath = new Map(baseFiles.map((file) => [file.path, file.sha]));
    const conflicted = files.filter(
      (file) => shaByPath.get(file.path) !== file.baseSha,
    );
    if (conflicted.length > 0) {
      const names = conflicted
        .map((file) => file.path.split("/").pop() ?? file.path)
        .join("・");
      throw new AppError(
        "conflict",
        `${names} がリモートで更新されています。章を開いて差分を取り込んでから、もう一度まとめてコミットしてください`,
      );
    }

    const entries: SetupTreeEntry[] = files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      content: file.content,
    }));
    const treeSha = await createTree(ctx.token, ctx.repo, entries, baseTreeSha);
    const commitSha = await createCommit(ctx.token, ctx.repo, {
      message,
      treeSha,
      parentSha: headSha,
    });
    await updateBranchRef(ctx.token, ctx.repo, targetBranch, commitSha);
    return {
      ok: true,
      data: { commitSha, paths: files.map((file) => file.path) },
    };
  } catch (error) {
    return toActionError(error);
  }
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

/**
 * 全章の本文を entry 順で返す（明示操作時のみ。SPEC §5.2）。
 * 全体プレビューと、全ファイル置換の対象収集（Issue #263）が使う。
 * blob SHA も返すのは、置換結果を待避に書くとき楽観ロックの基準が要るため。
 * 目次ページ（{ rel: 'contents' }）はCLIビルド時の生成物のためプレビューには含まれない
 */
export async function getAllChapterContents(
  projectId: string,
  branch?: string,
): Promise<ActionResult<{ chapters: ChapterData[] }>> {
  try {
    const ctx = await loadEditorContext(projectId);
    const ref = parseBranch(branch);
    const { chapters } = await listChapters(ctx, ref);
    // 章数は高々数十の想定。5並列で順序を保って取得する
    const results: ChapterData[] = new Array(chapters.length);
    let index = 0;
    async function worker() {
      while (index < chapters.length) {
        const i = index++;
        const { content, sha } = await getFileContent(
          ctx.token,
          ctx.repo,
          chapters[i].path,
          ref,
        );
        results[i] = { path: chapters[i].path, content, sha };
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
