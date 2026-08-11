import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import { patCredentialProvider } from "@/lib/git/credentials";
import { createClient } from "@/lib/supabase/server";

// プロジェクト起点の Git コンテキスト解決の共通化（SPEC-refactoring-step1 段階2・D-1/D-2）。
// 「projects を RLS 越しに取得（＝所有確認）→ repo ゲート → PAT 復号 → base_path 正規化」
// の同型ブロックが lib/actions / app/api の11ファイルに散在していたものを一元化する。
// 認証（auth.getUser）の有無は呼び出し側の既存挙動を変えないため本モジュールでは行わず、
// 認証込みの合成は loadProjectGitContext だけが担う（従来 loadEditorContext だった形）。

type Supabase = Awaited<ReturnType<typeof createClient>>;

const uuidSchema = z.uuid();

/** repo 未設定・PAT 未登録時のエラーメッセージ（既存呼び出し側の文言を維持するための上書き口） */
export type RepoGitMessages = {
  repoMessage?: string;
  patMessage?: string;
};

const DEFAULT_REPO_MESSAGE = "リポジトリが設定されていません";
const DEFAULT_PAT_MESSAGE = "GitHub PATが未登録です";

/**
 * base_path の正規化（null→空文字・末尾スラッシュ除去）。
 * 空文字＝リポジトリルート（lib/schemas/projects.ts の規約）。
 * 保存時スキーマが先頭・末尾スラッシュを拒否するため、除去は防御的正規化であり挙動を変えない。
 * 注意: スキーマ外の異常値 "/"（PostgREST 直叩きの自己行でのみ作れる）はルート扱いへ縮退する
 * （security-review 2026-08-12 L-1。RLS/PAT 境界は越えないため許容と判断）
 */
export function normalizeBasePath(basePath: string | null | undefined): string {
  return (basePath ?? "").replace(/\/$/, "");
}

/** PAT を復号して返す。未登録は validation エラー（文言は呼び出し側の既存表示を維持） */
export async function requirePatToken(
  supabase: Supabase,
  message: string = DEFAULT_PAT_MESSAGE,
): Promise<string> {
  const credential = await patCredentialProvider.getCredential(supabase);
  if (!credential) throw new AppError("validation", message);
  return credential.token;
}

export type ProjectGitFields = {
  id: string;
  repo: string | null;
  base_path: string | null;
};

/**
 * projects を RLS 越しに取得する（＝所有確認を兼ねる。他人のプロジェクトは not_found）。
 * projectId は uuid として検証する
 */
export async function fetchProjectGitFields(
  supabase: Supabase,
  projectId: string,
): Promise<ProjectGitFields> {
  const pid = uuidSchema.parse(projectId);
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, repo, base_path")
    .eq("id", pid)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!project) throw new AppError("not_found", "プロジェクトが見つかりません");
  return project;
}

export type RepoGitContext = {
  repo: string;
  basePath: string;
  token: string;
};

/**
 * repo ゲート＋PAT 復号＋base_path 正規化の尾部処理。
 * projects 本体を別クエリ（join 等）で取得済みのサイトもこの尾部だけを共有する。
 * 注意: base_path はオプショナルのため select し忘れても型エラーにならず basePath が
 * 空文字（ルート扱い）になる。戻り値の basePath を使うサイトは select 漏れに注意
 */
export async function resolveRepoGit(
  supabase: Supabase,
  project: { repo: string | null; base_path?: string | null },
  messages?: RepoGitMessages,
): Promise<RepoGitContext> {
  if (!project.repo)
    throw new AppError(
      "validation",
      messages?.repoMessage ?? DEFAULT_REPO_MESSAGE,
    );
  const token = await requirePatToken(
    supabase,
    messages?.patMessage ?? DEFAULT_PAT_MESSAGE,
  );
  return {
    repo: project.repo,
    basePath: normalizeBasePath(project.base_path),
    token,
  };
}

export type ProjectGitGate =
  | { gate: "no_repo" }
  | { gate: "no_pat" }
  | ({ gate: "ok" } & RepoGitContext & { projectId: string });

/**
 * gate 型の解決（getEditorWorkspace / getManuscriptTree の形）。
 * repo 未設定・PAT 未登録はエラーにせず gate で返し、UI 側が誘導表示に使う。
 * 認証チェックは行わない（必要なサイトは従来どおり呼び出し側で行う）
 */
export async function loadProjectGitOrGate(
  supabase: Supabase,
  projectId: string,
): Promise<ProjectGitGate> {
  const project = await fetchProjectGitFields(supabase, projectId);
  if (!project.repo) return { gate: "no_repo" };
  const credential = await patCredentialProvider.getCredential(supabase);
  if (!credential) return { gate: "no_pat" };
  return {
    gate: "ok",
    projectId: project.id,
    repo: project.repo,
    basePath: normalizeBasePath(project.base_path),
    token: credential.token,
  };
}

export type ProjectGitContext = RepoGitContext & {
  userId: string;
  projectId: string;
};

/**
 * 認証＋プロジェクト所有確認＋PAT 取得の合成（従来の loadEditorContext と同挙動）。
 * 前提未達は AppError（unauthorized / not_found / validation）
 */
export async function loadProjectGitContext(
  projectId: string,
  messages?: RepoGitMessages,
): Promise<ProjectGitContext & { supabase: Supabase }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("unauthorized", "ログインが必要です");

  const project = await fetchProjectGitFields(supabase, projectId);
  const resolved = await resolveRepoGit(supabase, project, messages);
  return { userId: user.id, projectId: project.id, ...resolved, supabase };
}
