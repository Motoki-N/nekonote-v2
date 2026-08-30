"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  chapterNumberByScene,
  toCanonicalOrder,
  type SceneRecord,
} from "@/lib/board";
import {
  fetchProjectScenes,
  persistChanges,
  toMap,
} from "@/lib/board/scene-store";
import { extractEntryPaths, joinRepoPath } from "@/lib/editor/book-config";
import { insertEntryPaths, type EntryInsertion } from "@/lib/editor/entry-sync";
import { planManuscriptFileNames } from "@/lib/editor/manuscript-naming";
import {
  chapterScaffold,
  sceneScaffold,
} from "@/lib/editor/manuscript-scaffold";
import {
  chapterFileNameSchema,
  parseBranch,
  validateChapterPath,
} from "@/lib/actions/editor/context";
import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import {
  createCommit,
  createTree,
  getBranchHeadShaOrNull,
  getDefaultBranch,
  getFileContent,
  getFullTree,
  getManuscriptTree,
  updateBranchRef,
  type SetupTreeEntry,
} from "@/lib/git/github";
import {
  loadProjectGitContext,
  loadProjectGitOrGate,
} from "@/lib/git/project-context";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// ボードからの原稿ファイル生成（SPEC-manuscript-bridge §5.1）。
// 単体作成も一括生成も同じ経路を通す（単体は対象1件）。
// 新規 .md 群と更新後の book.config.js を Git Data API の1コミットにまとめる——
// createChapter の N 回呼び出しでは 12件で 36リクエストとなり perMinute:12 の枠を
// 1操作で使い切るうえ、途中失敗で「一部だけ作られた」状態が履歴に残る

/** 1回に生成できる件数の上限（SPEC §5.1） */
const MAX_TARGETS = 50;

const uuidSchema = z.uuid();
const targetIdsSchema = z.array(uuidSchema).max(MAX_TARGETS);

const generateInputSchema = z.object({
  targets: z
    .array(
      z.object({
        id: uuidSchema,
        /** ダイアログでインライン編集されたファイル名（省略時は自動採番） */
        fileName: chapterFileNameSchema.optional(),
      }),
    )
    .max(MAX_TARGETS, `一度に作成できるのは${MAX_TARGETS}件までです`),
  appendToEntry: z.boolean(),
  branch: z.string().optional(),
});

export type GenerateManuscriptsInput = z.input<typeof generateInputSchema>;

/** 生成ダイアログに出す対象1件（プレビュー） */
export type PlannedManuscript = {
  id: string;
  kind: "scene" | "chapter";
  title: string;
  /** 章番号（章）またはシーン通し番号（シーン）。雛形にも書き込む値 */
  number: number;
  /** 生成予定のファイル名（manuscripts/ 直下） */
  fileName: string;
};

/** プレビューの取得結果。前提未達は gate でフェイルソフトに返す（SPEC §5.1-1） */
export type ManuscriptPlanData =
  | { gate: "no_repo" }
  | { gate: "no_pat" }
  | {
      gate: "ok";
      targets: PlannedManuscript[];
      /** 未紐づけが上限を超えたため先頭 {@link MAX_TARGETS} 件に絞ったか */
      truncated: boolean;
    };

export type GenerateManuscriptsResult = {
  /** 保存後の全シーン（ボードの state をそのまま置き換える） */
  scenes: SceneRecord[];
  /** 作成したファイル（シーンID → リポジトリルート基準のパス） */
  created: { id: string; path: string }[];
  /**
   * book.config.js の entry の扱い。
   * "added" = 追記できた／"skipped" = 追記しない指定だった／"failed" = 追記できなかった
   * （failed のときだけ UI が「entry 未登録」と案内する。SPEC-manuscript-bridge §5.3）
   */
  entryStatus: "added" | "skipped" | "failed";
};

/** 番号の導出（ボード表示と同じ規則）。章マーカーはシーンの通し番号を消費しない */
function numberResolver(scenes: SceneRecord[]): (scene: SceneRecord) => number {
  // ビートボードに並ぶカード（目次レーンは除く）。章番号は出現順（SPEC-board-chapters §4）
  const boardCards = scenes.filter((s) => s.part !== "chapter");
  const chapterNumbers = chapterNumberByScene(boardCards);
  const sceneNumbers = new Map(
    boardCards
      .filter((s) => s.kind !== "chapter")
      .map((s, index): [string, number] => [s.id, index + 1]),
  );
  // 目次ボードの章（part='chapter'）は目次内の出現順で番号を振る
  const outlineNumbers = new Map(
    scenes
      .filter((s) => s.part === "chapter")
      .map((s, index): [string, number] => [s.id, index + 1]),
  );
  return (scene) => {
    if (scene.kind !== "chapter") return sceneNumbers.get(scene.id) ?? 1;
    return outlineNumbers.get(scene.id) ?? chapterNumbers[scene.id] ?? 1;
  };
}

/** manuscripts/ 直下の *.md のファイル名（採番の衝突回避に使う） */
function manuscriptFileNames(treePaths: string[], basePath: string): string[] {
  const dir = `${basePath === "" ? "" : `${basePath}/`}manuscripts/`;
  return treePaths
    .filter((path) => path.startsWith(dir) && path.endsWith(".md"))
    .map((path) => path.slice(dir.length))
    .filter((name) => !name.includes("/"));
}

/** 生成対象1件の解決結果（ボード順） */
type PlannedTarget = PlannedManuscript & { scene: SceneRecord };

/**
 * 対象の抽出とファイル名の決定（プレビューと生成で共用）。
 * 対象は `manuscript_path === null` の行のみ——既存の紐づけは絶対に上書きしない。
 * targetIds が空なら未紐づけの全件
 */
function resolvePlan(
  scenes: SceneRecord[],
  existingNames: string[],
  targets: { id: string; fileName?: string }[],
  targetIds: string[],
  /** 先頭から何件までを採番するか（プレビューは上限で切って一覧を出す） */
  limit?: number,
): { planned: PlannedTarget[]; total: number } {
  const idFilter = new Set(targetIds);
  const requested = new Map(targets.map((t) => [t.id, t.fileName]));
  const all = scenes.filter(
    (scene) =>
      scene.manuscript_path === null &&
      (idFilter.size === 0 || idFilter.has(scene.id)),
  );
  // ボード順の先頭から切る。採番はボード順に進むため、切ってから採番しても
  // 残した分の名前は「全件を採番したときの先頭 N 件」と同じになる
  const selected = limit === undefined ? all : all.slice(0, limit);

  const numberOf = numberResolver(scenes);
  // 自動採番はファイル名を指定されなかった行だけに使う。
  // 指定された名前も衝突回避の対象にするため、既存名として渡す
  const autoTargets = selected.filter((s) => !requested.get(s.id));
  const fixedNames = selected
    .map((s) => requested.get(s.id))
    .filter((name): name is string => name !== undefined);
  const autoNames = planManuscriptFileNames(
    [...existingNames, ...fixedNames],
    autoTargets.map((scene) => ({
      kind: scene.kind === "chapter" ? "chapter" : "scene",
      number: numberOf(scene),
    })),
  );
  const autoByScene = new Map(
    autoTargets.map((scene, index): [string, string] => [
      scene.id,
      autoNames[index],
    ]),
  );

  const planned = selected.map((scene): PlannedTarget => {
    const proposed = requested.get(scene.id) ?? autoByScene.get(scene.id);
    if (proposed === undefined)
      throw new AppError("internal", "ファイル名の決定に失敗しました");
    return {
      scene,
      id: scene.id,
      kind: scene.kind === "chapter" ? "chapter" : "scene",
      title: scene.title,
      number: numberOf(scene),
      // 自動採番の結果も含めて再検証する（多層防御。SPEC §3-7）
      fileName: chapterFileNameSchema.parse(proposed),
    };
  });
  return { planned, total: all.length };
}

/**
 * 生成ダイアログのプレビュー（SPEC §4.2）。対象一覧と生成予定ファイル名を返す。
 * repo 未設定・PAT 未登録は gate で返し、ダイアログは誘導文を出して確定ボタンを無効化する
 */
export async function getManuscriptPlan(
  projectId: string,
  targetIds: string[] = [],
): Promise<ActionResult<ManuscriptPlanData>> {
  try {
    const ids = targetIdsSchema.parse(targetIds);
    const supabase = await createClient();
    // RLS越しの取得＝所有確認を兼ねる
    const gitCtx = await loadProjectGitOrGate(supabase, projectId);
    if (gitCtx.gate !== "ok") return { ok: true, data: { gate: gitCtx.gate } };

    const scenes = toCanonicalOrder(
      await fetchProjectScenes(supabase, gitCtx.projectId),
    );
    const tree = await getManuscriptTree(
      gitCtx.token,
      gitCtx.repo,
      gitCtx.basePath,
    );
    const existingNames = manuscriptFileNames(
      tree.map((entry) => entry.path),
      gitCtx.basePath,
    );
    const { planned, total } = resolvePlan(
      scenes,
      existingNames,
      [],
      ids,
      MAX_TARGETS,
    );
    return {
      ok: true,
      data: {
        gate: "ok",
        targets: planned.map(({ id, kind, title, number, fileName }) => ({
          id,
          kind,
          title,
          number,
          fileName,
        })),
        truncated: total > planned.length,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * ボードの章・シーンから原稿ファイルを作る（SPEC-manuscript-bridge §5.1）。
 *
 * - 対象は `manuscript_path === null` の行のみ（既存の紐づけは絶対に上書きしない）
 * - `targets` が空なら未紐づけの全件（ボード順・上限 {@link MAX_TARGETS} 件）
 * - ファイル生成と entry 追記は同一コミット。entry の更新に失敗しても
 *   ファイル生成だけコミットする（ベストエフォート。`entryStatus: "failed"` を返す）
 *
 * 既知の限界: コミット成功後に DB の upsert が失敗すると紐づかない孤児ファイルが残る
 * （supabase-js にトランザクションがなく、GitHubコミットとDB更新をまたぐ原子性は作れない。
 * SPEC-manuscript-bridge §7）
 */
export async function generateManuscriptsForBoard(
  projectId: string,
  input: GenerateManuscriptsInput,
): Promise<ActionResult<GenerateManuscriptsResult>> {
  try {
    const parsedInput = generateInputSchema.safeParse(input);
    if (!parsedInput.success) {
      // ZodError は toActionError で internal（固定文言）になるため validation で届ける
      throw new AppError(
        "validation",
        parsedInput.error.issues[0]?.message ?? "入力が不正です",
      );
    }
    const { targets, appendToEntry } = parsedInput.data;

    // ① 認証＋所有確認（RLS越し）＋repo/PAT。前提未達は AppError
    const ctx = await loadProjectGitContext(projectId, {
      repoMessage: "原稿リポジトリが設定されていません（プロジェクト設定）",
      patMessage: "GitHub PATが未登録です。設定から登録してください",
    });
    const branch = parseBranch(parsedInput.data.branch);

    // ② レート制限は1コミット＝1回だけ消費する
    enforceRateLimit(ctx.userId, "editor-save", { perMinute: 12, perDay: 600 });

    // ⑥⑦前半: SPEC の処理順より先に HEAD を確定させ、以降の読み取り（既存ファイル名・
    // book.config.js）をすべてこのコミットに揃える。衝突チェックしたツリーとコミットの
    // base_tree がずれていると、その間に増えた同名ファイルを無警告で上書きしてしまう
    // （createTree の content 付きエントリは既存 blob を置き換えるため）
    const targetBranch =
      branch ?? (await getDefaultBranch(ctx.token, ctx.repo));
    const headSha = await getBranchHeadShaOrNull(
      ctx.token,
      ctx.repo,
      targetBranch,
    );
    if (headSha === null) {
      throw new AppError(
        "validation",
        "先に原稿リポジトリの初期セットアップを行ってください",
      );
    }
    const { treeSha: baseTreeSha, files: baseFiles } = await getFullTree(
      ctx.token,
      ctx.repo,
      headSha,
    );

    // ③④ 対象の解決（正準順序＝ボード順）とファイル名の決定
    const scenes = toCanonicalOrder(
      await fetchProjectScenes(ctx.supabase, ctx.projectId),
    );
    const existingNames = manuscriptFileNames(
      baseFiles.map((file) => file.path),
      ctx.basePath,
    );
    const { planned } = resolvePlan(
      scenes,
      existingNames,
      targets,
      targets.map((t) => t.id),
    );
    if (planned.length === 0) {
      throw new AppError(
        "validation",
        "作成できる対象がありません（すでに原稿ファイルが紐づいています）",
      );
    }
    if (planned.length > MAX_TARGETS) {
      throw new AppError(
        "validation",
        `一度に作成できるのは${MAX_TARGETS}件までです。対象を絞ってください`,
      );
    }

    // 既存ファイル・同一バッチ内での名前衝突を弾く（通ると既存の原稿を空の雛形で上書きする）
    const taken = new Set(existingNames);
    for (const target of planned) {
      if (taken.has(target.fileName)) {
        throw new AppError(
          "conflict",
          `ファイル名「${target.fileName}」は既に使われています。別の名前を指定してください`,
        );
      }
      taken.add(target.fileName);
    }

    // ⑤ ツリーエントリ（新規 .md 群＋更新後の book.config.js）
    const files = planned.map((target) => {
      const path = joinRepoPath(ctx.basePath, "manuscripts", target.fileName);
      if (!path) throw new AppError("validation", "ファイル名が不正です");
      // 開く/保存と同じパス検証を通す（多層防御）
      validateChapterPath(ctx.basePath, path);
      return {
        ...target,
        path,
        relPath: `manuscripts/${target.fileName}`,
        content:
          target.kind === "chapter"
            ? chapterScaffold(target.title)
            : sceneScaffold(target.title, target.number),
      };
    });
    const entries: SetupTreeEntry[] = files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      content: file.content,
    }));
    // book.config.js も base_tree と同じコミットから読む（読み取り後に入った
    // entry の変更を古い内容で巻き戻さないため）
    const entryStatus = !appendToEntry
      ? ("skipped" as const)
      : await appendEntryTreeEntry(entries, {
          token: ctx.token,
          repo: ctx.repo,
          basePath: ctx.basePath,
          ref: headSha,
          scenes,
          files,
        });

    // ⑦ base_tree 付きの1コミットで反映する
    const treeSha = await createTree(ctx.token, ctx.repo, entries, baseTreeSha);
    const commitSha = await createCommit(ctx.token, ctx.repo, {
      message: `執筆: 原稿ファイル${files.length}件を作成（ネコノテAI ボード）`,
      treeSha,
      parentSha: headSha,
    });
    await updateBranchRef(ctx.token, ctx.repo, targetBranch, commitSha);

    // ⑧ 紐づけを1回の upsert で保存する
    const pathByScene = new Map(files.map((file) => [file.id, file.path]));
    const next = scenes.map((scene): SceneRecord => {
      const path = pathByScene.get(scene.id);
      return path === undefined ? scene : { ...scene, manuscript_path: path };
    });
    await persistChanges(ctx.supabase, toMap(scenes), next);

    // ⑨
    revalidatePath(`/projects/${ctx.projectId}/board`);
    return {
      ok: true,
      data: {
        scenes: next,
        created: files.map((file) => ({ id: file.id, path: file.path })),
        entryStatus,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 更新後の book.config.js を同じツリーエントリに積む（SPEC §5.3）。
 * 挿入位置は「ボード順で直前にある、**既に entry に載っている**パスの直後」。
 * config がない・解析できない・書き戻しを検証できない場合は "failed" を返し、
 * ファイル生成だけをコミットさせる（ベストエフォート）
 */
async function appendEntryTreeEntry(
  entries: SetupTreeEntry[],
  params: {
    token: string;
    repo: string;
    basePath: string;
    /** 読み取り ref。コミットの base_tree と同じコミットを渡すこと */
    ref: string;
    scenes: SceneRecord[];
    files: { id: string; relPath: string }[];
  },
): Promise<"added" | "failed"> {
  try {
    const configPath = joinRepoPath(params.basePath, "book.config.js");
    if (!configPath) return "failed";
    const config = await getFileContent(
      params.token,
      params.repo,
      configPath,
      params.ref,
    );

    // ボード順に辿り、各新規パスの「直前にある entry 掲載パス」を決める。
    // entry に載っていないパス（追記なしで作った・追記に失敗した過去のファイル）は
    // 目印にならないので飛ばして遡る——載せると挿入位置が見つからず、
    // 本の先頭（contents 直後）へ落ちてしまう
    const inEntry = new Set(extractEntryPaths(config.content));
    const prefix = params.basePath === "" ? "" : `${params.basePath}/`;
    const relByScene = new Map(params.files.map((f) => [f.id, f.relPath]));
    const insertions: EntryInsertion[] = [];
    let previous: string | null = null;
    for (const scene of params.scenes) {
      const newRelPath = relByScene.get(scene.id);
      if (newRelPath !== undefined) {
        insertions.push({ relPath: newRelPath, afterRelPath: previous });
        // 今回追記する分は、以降の挿入にとって「entry 掲載済み」の目印になる
        previous = newRelPath;
        continue;
      }
      const relPath = scene.manuscript_path?.startsWith(prefix)
        ? scene.manuscript_path.slice(prefix.length)
        : null;
      if (relPath !== null && inEntry.has(relPath)) previous = relPath;
    }

    const updated = insertEntryPaths(config.content, insertions);
    if (updated === null) return "failed";
    entries.push({
      path: configPath,
      mode: "100644",
      type: "blob",
      content: updated,
    });
    return "added";
  } catch {
    return "failed";
  }
}
