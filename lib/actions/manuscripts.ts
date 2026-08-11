"use server";

import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import {
  getCommitFilePatch,
  getFileContent,
  getLatestCommitSha,
  getManuscriptTree,
  listFileCommits,
  putFileContent,
  type FileCommitEntry,
} from "@/lib/git/github";
import {
  fetchProjectGitFields,
  loadProjectGitOrGate,
  normalizeBasePath,
  requirePatToken,
  resolveRepoGit,
} from "@/lib/git/project-context";
import {
  countChars,
  fetchAllManuscriptContents,
} from "@/lib/manuscript-content";
import { applySuggestions, writeBackAsComments } from "@/lib/proofread-apply";
import { parseEnum, suggestionStatuses } from "@/lib/schemas/enums";
import type { SuggestionStatus } from "@/lib/schemas/enums";
import {
  commitShaSchema,
  manuscriptFilePathSchema,
} from "@/lib/schemas/manuscript";
import { createClient } from "@/lib/supabase/server";
import { jstDateString } from "@/lib/date";

const uuidSchema = z.uuid();

/** 原稿タブの前提チェック結果（誘導表示の出し分け用。SPEC-proofreading §3.2） */
export type ManuscriptTreeData =
  | { gate: "no_repo" }
  | { gate: "no_pat" }
  | { gate: "ok"; files: string[]; basePath: string };

/** base_path 配下の原稿ファイル一覧を取得する。前提未達（repo未設定・PAT未登録）は gate で返す */
export async function getManuscriptFiles(
  projectId: string,
): Promise<ActionResult<ManuscriptTreeData>> {
  try {
    const supabase = await createClient();

    // RLS越しの取得＝所有確認を兼ねる
    const gitCtx = await loadProjectGitOrGate(supabase, projectId);
    if (gitCtx.gate !== "ok") return { ok: true, data: { gate: gitCtx.gate } };

    const basePath = gitCtx.basePath;
    const files = await getManuscriptTree(gitCtx.token, gitCtx.repo, basePath);
    return {
      ok: true,
      data: { gate: "ok", files: files.map((f) => f.path), basePath },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export type SuggestionRecord = {
  id: string;
  original_text: string;
  suggested_text: string;
  reason: string | null;
  status: SuggestionStatus;
  committed_sha: string | null;
  created_at: string;
};

const SUGGESTION_COLUMNS =
  "id, original_text, suggested_text, reason, status, committed_sha, created_at";

export type ManuscriptFileData = {
  linkId: string;
  filePath: string;
  content: string;
  /** 空白・改行を除いた文字数 */
  charCount: number;
  latestSha: string;
  lastReviewedCommit: string | null;
  suggestions: SuggestionRecord[];
};

/**
 * 原稿ファイルを開く（SPEC-proofreading §3.2）。
 * 本文＋そのファイルの最新コミットSHAを取得し、manuscript_links を自動作成する
 * （開いた時点で管理対象になる。「リポジトリが正」の思想）
 */
export async function openManuscriptFile(
  projectId: string,
  filePath: string,
): Promise<ActionResult<ManuscriptFileData>> {
  try {
    const pid = uuidSchema.parse(projectId);
    const path = manuscriptFilePathSchema.parse(filePath);
    const supabase = await createClient();

    const project = await fetchProjectGitFields(supabase, pid);

    // base_path 外のパスは拒否（ツリー一覧と同じ範囲に限定する）
    const basePath = normalizeBasePath(project.base_path);
    if (basePath !== "" && !path.startsWith(`${basePath}/`)) {
      throw new AppError("validation", "ファイルパスが不正です");
    }

    const { repo, token } = await resolveRepoGit(supabase, project);

    const [{ content }, latestSha] = await Promise.all([
      getFileContent(token, repo, path),
      getLatestCommitSha(token, repo, path),
    ]);

    // 開いた時点でリンクを自動作成（既存ならそのまま）
    const { error: upsertError } = await supabase
      .from("manuscript_links")
      .upsert(
        { project_id: pid, file_path: path },
        { onConflict: "project_id,file_path", ignoreDuplicates: true },
      );
    if (upsertError) throw new AppError("internal", upsertError.message);

    const { data: link, error: linkError } = await supabase
      .from("manuscript_links")
      .select(
        `id, last_reviewed_commit, revision_suggestions (${SUGGESTION_COLUMNS})`,
      )
      .eq("project_id", pid)
      .eq("file_path", path)
      .maybeSingle();
    if (linkError) throw new AppError("internal", linkError.message);
    if (!link) throw new AppError("internal", "原稿リンクの作成に失敗しました");

    const suggestions = (link.revision_suggestions ?? [])
      .map((s) => ({
        ...s,
        status: parseEnum(
          suggestionStatuses,
          s.status,
          "revision_suggestions.status",
        ),
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    // 原稿読み込み時に当日の総文字数を進捗として記録する（SPEC-proofreading §3.4）。
    // 補助機能なので、失敗しても原稿の読み込み自体は成功させる
    try {
      await recordWritingProgress(supabase, {
        projectId: pid,
        repo,
        basePath,
        token,
        openedFile: { path, content },
      });
    } catch (progressError) {
      console.error("進捗の記録に失敗:", progressError);
    }

    return {
      ok: true,
      data: {
        linkId: link.id,
        filePath: path,
        content,
        charCount: countChars(content),
        latestSha,
        lastReviewedCommit: link.last_reviewed_commit,
        suggestions,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 履歴系アクションの共通前処理（SPEC-manuscript-history §4）。
 * RLS越しのリンク取得＝所有確認、DB由来 file_path の再検証、PAT取得をまとめる
 */
async function resolveLinkForHistory(manuscriptLinkId: string): Promise<{
  token: string;
  repo: string;
  filePath: string;
}> {
  const linkId = uuidSchema.parse(manuscriptLinkId);
  const supabase = await createClient();
  const { data: link, error } = await supabase
    .from("manuscript_links")
    .select("id, file_path, projects (id, repo)")
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!link || !link.projects)
    throw new AppError("not_found", "原稿リンクが見つかりません");
  const filePath = manuscriptFilePathSchema.parse(link.file_path);

  const { repo, token } = await resolveRepoGit(supabase, link.projects);
  return { token, repo, filePath };
}

/** そのファイルのコミット履歴（新しい順・最大30件。SPEC-manuscript-history §4） */
export async function getManuscriptHistory(
  manuscriptLinkId: string,
): Promise<ActionResult<{ commits: FileCommitEntry[] }>> {
  try {
    const { token, repo, filePath } =
      await resolveLinkForHistory(manuscriptLinkId);
    const commits = await listFileCommits(token, repo, filePath);
    return { ok: true, data: { commits } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * コミットでのそのファイルの変更（unified diff の patch）を取得する。
 * patch が無い場合（差分過大・バイナリ扱い）は null（表示側で「差分を表示できません」）
 */
export async function getManuscriptCommitDiff(
  manuscriptLinkId: string,
  commitSha: string,
): Promise<ActionResult<{ patch: string | null }>> {
  try {
    const sha = commitShaSchema.parse(commitSha);
    const { token, repo, filePath } =
      await resolveLinkForHistory(manuscriptLinkId);
    const patch = await getCommitFilePatch(token, repo, sha, filePath);
    return { ok: true, data: { patch } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * base_path 配下の全原稿ファイルの総文字数を集計し、当日分として upsert する
 * （SPEC-proofreading §3.4。原稿を開いたときの自動記録とダッシュボードの手動集計が共用）。
 * 開いているファイルの本文は取得済みのものを使い、再取得しない
 */
async function recordWritingProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    projectId: string;
    repo: string;
    basePath: string;
    token: string;
    openedFile?: { path: string; content: string };
  },
): Promise<number> {
  const contents = await fetchAllManuscriptContents(
    params.token,
    params.repo,
    params.basePath,
    params.openedFile,
  );
  const totalChars = contents.reduce(
    (sum, file) => sum + countChars(file.content),
    0,
  );

  const { error } = await supabase.from("writing_progress").upsert(
    {
      project_id: params.projectId,
      date: jstDateString(new Date()),
      total_chars: totalChars,
    },
    { onConflict: "project_id,date" },
  );
  if (error) throw new AppError("internal", error.message);
  return totalChars;
}

/**
 * ダッシュボードの「今すぐ集計」（SPEC-dashboard-critique-settings §3.1）。
 * repo/PAT 設定済みプロジェクトのみ。集計内容は原稿を開いたときの自動記録と同一
 */
export async function refreshWritingProgress(
  projectId: string,
): Promise<ActionResult<{ totalChars: number }>> {
  try {
    const pid = uuidSchema.parse(projectId);
    const supabase = await createClient();

    // RLS越しの取得＝所有確認を兼ねる
    const project = await fetchProjectGitFields(supabase, pid);
    const { repo, basePath, token } = await resolveRepoGit(supabase, project);

    const totalChars = await recordWritingProgress(supabase, {
      projectId: pid,
      repo,
      basePath,
      token,
    });
    return { ok: true, data: { totalChars } };
  } catch (error) {
    return toActionError(error);
  }
}

const suggestionStatusSchema = z.enum(suggestionStatuses);

/**
 * 提案の受入/拒否/保留（と未処理への戻し）。コミット済みの提案は変更できない。
 * 受入可否（原文が現在の原稿に一意に見つかるか）の判定はクライアント表示と
 * コミット時の再検証（commitAcceptedSuggestions）が担う
 */
export async function updateSuggestionStatus(
  suggestionId: string,
  status: SuggestionStatus,
): Promise<ActionResult> {
  try {
    const sid = uuidSchema.parse(suggestionId);
    const nextStatus = suggestionStatusSchema.parse(status);
    const supabase = await createClient();

    // RLS越しの更新＝所有確認を兼ねる。「未コミットのみ」を UPDATE の条件に含めて原子化する
    // （SELECT→UPDATE の分割だと、並行するコミットと交錯してコミット済み提案を書き換えうる）
    const { data: updated, error: updateError } = await supabase
      .from("revision_suggestions")
      .update({ status: nextStatus })
      .eq("id", sid)
      .is("committed_sha", null)
      .select("id");
    if (updateError) throw new AppError("internal", updateError.message);

    if (!updated || updated.length === 0) {
      // 更新0件 = 行が存在しない（他人の行含む）か、コミット済み。理由を出し分ける
      const { data: existing, error: selectError } = await supabase
        .from("revision_suggestions")
        .select("id")
        .eq("id", sid)
        .maybeSingle();
      if (selectError) throw new AppError("internal", selectError.message);
      if (!existing) throw new AppError("not_found", "提案が見つかりません");
      throw new AppError("validation", "コミット済みの提案は変更できません");
    }

    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 受け入れ済み（未コミット）の提案をまとめて適用し、1コミットでリポジトリへ書き戻す
 * （SPEC-proofreading §3.4。ネコノテからGitへの書き込みはこの操作のみ）。
 * 適用は最新原稿への一意一致を再検証し、1件でも適用できなければコミットしない（部分適用を作らない）
 */
export async function commitAcceptedSuggestions(
  manuscriptLinkId: string,
): Promise<
  ActionResult<{ commitSha: string; appliedCount: number; warning?: string }>
> {
  try {
    const linkId = uuidSchema.parse(manuscriptLinkId);
    const supabase = await createClient();

    // RLS越しの取得＝所有確認を兼ねる
    const { data: link, error: linkError } = await supabase
      .from("manuscript_links")
      .select("id, file_path, projects (id, repo, base_path)")
      .eq("id", linkId)
      .maybeSingle();
    if (linkError) throw new AppError("internal", linkError.message);
    if (!link || !link.projects)
      throw new AppError("not_found", "原稿リンクが見つかりません");
    if (!link.projects.repo)
      throw new AppError("validation", "リポジトリが設定されていません");
    // DB由来の file_path も再検証する（多層防御。/api/proofread と同じ作法）。
    // 書き込み経路なので base_path 配下であることも読み取り側と対称に確認する
    const filePath = manuscriptFilePathSchema.parse(link.file_path);
    const basePath = normalizeBasePath(link.projects.base_path);
    if (basePath !== "" && !filePath.startsWith(`${basePath}/`)) {
      throw new AppError("validation", "ファイルパスが不正です");
    }

    const patToken = await requirePatToken(
      supabase,
      "GitHub PATが未登録です。設定から登録してください",
    );

    const { data: accepted, error: acceptedError } = await supabase
      .from("revision_suggestions")
      .select("id, original_text, suggested_text")
      .eq("manuscript_link_id", linkId)
      .eq("status", "accepted")
      .is("committed_sha", null)
      .order("created_at", { ascending: true });
    if (acceptedError) throw new AppError("internal", acceptedError.message);
    if (!accepted || accepted.length === 0) {
      throw new AppError("validation", "受け入れ済みの提案がありません");
    }

    // 最新原稿を取得して適用（blob SHA 起点の楽観ロック。リモート更新が挟まると PUT が conflict になる）
    const { content, sha } = await getFileContent(
      patToken,
      link.projects.repo,
      filePath,
    );
    const applied = applySuggestions(content, accepted);
    if (!applied.ok) {
      const excerpt =
        applied.failedOriginal.length > 20
          ? `${applied.failedOriginal.slice(0, 20)}…`
          : applied.failedOriginal;
      throw new AppError(
        "validation",
        `適用できない提案があります（「${excerpt}」が現在の原稿に一意に見つかりません）。該当の提案を未処理に戻すか拒否してから、もう一度コミットしてください`,
      );
    }

    const fileName = filePath.split("/").pop() ?? filePath;
    const { commitSha } = await putFileContent(
      patToken,
      link.projects.repo,
      filePath,
      {
        content: applied.content,
        sha,
        message: `校正: ${fileName} に修正${accepted.length}件を適用（ネコノテAI）`,
      },
    );

    // コミット成立後の記録。ここで失敗してエラーにすると「未コミット扱いのまま再コミット→
    // 二重適用」の事故につながるため、リトライした上で、失敗しても成功（警告つき）として返す
    let markError: { message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase
        .from("revision_suggestions")
        .update({ committed_sha: commitSha })
        .in(
          "id",
          accepted.map((s) => s.id),
        );
      markError = error;
      if (!error) break;
    }
    let warning: string | undefined;
    if (markError) {
      console.error(
        "committed_sha の記録に失敗（コミット自体は成立）:",
        markError.message,
      );
      warning =
        "コミットは完了しましたが、提案への記録に失敗しました。そのまま再コミットすると同じ修正を二重に適用するおそれがあります。ファイルを開き直して提案の状態を確認してください";
    }

    // 自分のコミットで更新バナーを出さないよう、レビュー済みSHAを進める
    const { error: shaError } = await supabase
      .from("manuscript_links")
      .update({ last_reviewed_commit: commitSha })
      .eq("id", linkId);
    if (shaError)
      console.error("last_reviewed_commit の更新に失敗:", shaError.message);

    return {
      ok: true,
      data: { commitSha, appliedCount: accepted.length, warning },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 保留提案をファイル単位で一括、`<!-- -->` コメントとして原稿へ書き戻す＝コミットする
 * （SPEC-vertical-editor-phase4 §3.2。commitAcceptedSuggestions と対称の構造）。
 * 挿入は一意一致アンカーで再検証し、1件でも位置が決まらなければコミットしない（部分書き戻しを作らない）。
 * 書き戻した提案は on_hold のまま committed_sha に記録し、以後の操作対象から外す（消化はエディタに一本化）
 */
export async function writeBackOnHoldSuggestions(
  manuscriptLinkId: string,
): Promise<
  ActionResult<{ commitSha: string; writtenCount: number; warning?: string }>
> {
  try {
    const linkId = uuidSchema.parse(manuscriptLinkId);
    const supabase = await createClient();

    // RLS越しの取得＝所有確認を兼ねる
    const { data: link, error: linkError } = await supabase
      .from("manuscript_links")
      .select("id, file_path, projects (id, repo, base_path)")
      .eq("id", linkId)
      .maybeSingle();
    if (linkError) throw new AppError("internal", linkError.message);
    if (!link || !link.projects)
      throw new AppError("not_found", "原稿リンクが見つかりません");
    if (!link.projects.repo)
      throw new AppError("validation", "リポジトリが設定されていません");
    // DB由来の file_path も再検証する（多層防御。commitAcceptedSuggestions と同じ作法）
    const filePath = manuscriptFilePathSchema.parse(link.file_path);
    const basePath = normalizeBasePath(link.projects.base_path);
    if (basePath !== "" && !filePath.startsWith(`${basePath}/`)) {
      throw new AppError("validation", "ファイルパスが不正です");
    }

    const patToken = await requirePatToken(
      supabase,
      "GitHub PATが未登録です。設定から登録してください",
    );

    const { data: onHold, error: onHoldError } = await supabase
      .from("revision_suggestions")
      .select("id, original_text, suggested_text, reason")
      .eq("manuscript_link_id", linkId)
      .eq("status", "on_hold")
      .is("committed_sha", null)
      .order("created_at", { ascending: true });
    if (onHoldError) throw new AppError("internal", onHoldError.message);
    if (!onHold || onHold.length === 0) {
      throw new AppError(
        "validation",
        "書き戻していない保留の提案がありません",
      );
    }

    // 最新原稿を取得して挿入（blob SHA 起点の楽観ロック。リモート更新が挟まると PUT が conflict になる）
    const { content, sha } = await getFileContent(
      patToken,
      link.projects.repo,
      filePath,
    );
    const written = writeBackAsComments(content, onHold);
    if (!written.ok) {
      const excerpt =
        written.failedOriginal.length > 20
          ? `${written.failedOriginal.slice(0, 20)}…`
          : written.failedOriginal;
      throw new AppError(
        "validation",
        `書き戻せない提案があります（「${excerpt}」が現在の原稿に一意に見つかりません）。該当の提案を未処理に戻すか拒否してから、もう一度書き戻してください`,
      );
    }

    const fileName = filePath.split("/").pop() ?? filePath;
    const { commitSha } = await putFileContent(
      patToken,
      link.projects.repo,
      filePath,
      {
        content: written.content,
        sha,
        message: `校正: ${fileName} に保留${onHold.length}件をコメントで書き戻し（ネコノテAI）`,
      },
    );

    // コミット成立後の記録。失敗のままエラーにすると「未書き戻し扱いで再実行→二重挿入」に
    // つながるため、リトライした上で、失敗しても成功（警告つき）として返す（適用コミットと同じ作法）
    let markError: { message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase
        .from("revision_suggestions")
        .update({ committed_sha: commitSha })
        .in(
          "id",
          onHold.map((s) => s.id),
        );
      markError = error;
      if (!error) break;
    }
    let warning: string | undefined;
    if (markError) {
      console.error(
        "committed_sha の記録に失敗（コミット自体は成立）:",
        markError.message,
      );
      warning =
        "コミットは完了しましたが、提案への記録に失敗しました。そのまま再実行すると同じコメントを二重に挿入するおそれがあります。ファイルを開き直して提案の状態を確認してください";
    }

    // 自分のコミットで更新バナーを出さないよう、レビュー済みSHAを進める
    const { error: shaError } = await supabase
      .from("manuscript_links")
      .update({ last_reviewed_commit: commitSha })
      .eq("id", linkId);
    if (shaError)
      console.error("last_reviewed_commit の更新に失敗:", shaError.message);

    return {
      ok: true,
      data: { commitSha, writtenCount: onHold.length, warning },
    };
  } catch (error) {
    return toActionError(error);
  }
}
