"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import { patCredentialProvider } from "@/lib/git/credentials";
import {
  createCommit,
  createFileContent,
  createTree,
  getBranchHeadShaOrNull,
  getDefaultBranch,
  getFullTree,
  updateBranchRef,
  type SetupTreeEntry,
} from "@/lib/git/github";
import { loadManuscriptTemplate } from "@/lib/git/template";
import { repoSetupInputSchema } from "@/lib/schemas/projects";
import type { RepoSetupInput } from "@/lib/schemas/projects";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.uuid();

const COMMIT_MESSAGE = "原稿リポジトリを初期セットアップ（ネコノテAI）";

// 退避フォルダ名の日時（JST固定。サーバーはUTCのため+9時間して読みやすくする）
function backupStamp(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
  return `${jst.slice(0, 10).replaceAll("-", "")}-${jst.slice(11, 19).replaceAll(":", "")}`;
}

export type RepoSetupResult = {
  /** 既存ファイルを退避した場合、その退避フォルダ名 */
  backupDir: string | null;
};

/**
 * 原稿リポジトリの初期セットアップ（SPEC-repo-setup §4）。
 * テンプレート（docs/templates/manuscript-repo/）を作品情報に置換して展開し、
 * 既存ファイルは全件 backup-<日時>/ へ退避。全変更を Git Data API の1コミットで反映し、
 * 成功後に base_path を空（リポジトリルート）へ自動設定する
 */
export async function setupManuscriptRepo(
  projectId: string,
  input: RepoSetupInput,
): Promise<ActionResult<RepoSetupResult>> {
  try {
    const pid = uuidSchema.parse(projectId);
    // ZodError は toActionError で internal（固定文言）になるため、検証メッセージを validation で届ける
    const inputResult = repoSetupInputSchema.safeParse(input);
    if (!inputResult.success) {
      throw new AppError(
        "validation",
        inputResult.error.issues[0]?.message ?? "入力が不正です",
      );
    }
    const parsed = inputResult.data;
    const supabase = await createClient();

    // RLS越しに取得（他人のプロジェクトは not_found になる）
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, repo")
      .eq("id", pid)
      .maybeSingle();
    if (projectError) throw new AppError("internal", projectError.message);
    if (!project)
      throw new AppError("not_found", "プロジェクトが見つかりません");
    if (!project.repo) {
      throw new AppError("validation", "原稿リポジトリが設定されていません");
    }

    const credential = await patCredentialProvider.getCredential(supabase);
    if (!credential) {
      throw new AppError(
        "validation",
        "GitHubのPATが未登録です。設定画面で登録してください",
      );
    }
    const { token } = credential;
    const repo = project.repo;

    const templateFiles = await loadManuscriptTemplate(parsed);

    const branch = await getDefaultBranch(token, repo);
    let headSha = await getBranchHeadShaOrNull(token, repo, branch);

    const entries: SetupTreeEntry[] = [];
    let filesToCommit = templateFiles;
    let baseTreeSha: string;
    let backupDir: string | null = null;

    if (headSha === null) {
      // コミットが1つもない空リポジトリには Git Data API（trees/commits）自体が
      // 409 を返すため、まず Contents API で1ファイル書いて初回コミットを作る
      const bootstrap =
        templateFiles.find((f) => f.path === "README.md") ?? templateFiles[0];
      const { commitSha: bootstrapSha } = await createFileContent(
        token,
        repo,
        bootstrap.path,
        {
          content: bootstrap.content,
          message: COMMIT_MESSAGE,
        },
      );
      headSha = bootstrapSha;
      const { treeSha } = await getFullTree(token, repo, headSha);
      baseTreeSha = treeSha;
      filesToCommit = templateFiles.filter((f) => f.path !== bootstrap.path);
    } else {
      const { treeSha, files: existing } = await getFullTree(
        token,
        repo,
        headSha,
      );
      baseTreeSha = treeSha;
      if (existing.length > 0) {
        // 全ファイルを退避（既存 blob SHA の張り直し＝内容の再アップロードなしで移動）。
        // テンプレートが同じパスを書く場合は、同一ツリー内での削除＋追加の衝突を避けるため
        // 削除エントリを出さない（テンプレート側の追加が上書きする）
        const templatePaths = new Set(templateFiles.map((f) => f.path));
        backupDir = `backup-${backupStamp()}`;
        for (const file of existing) {
          entries.push({
            path: `${backupDir}/${file.path}`,
            mode: file.mode,
            type: "blob",
            sha: file.sha,
          });
          if (!templatePaths.has(file.path)) {
            entries.push({
              path: file.path,
              mode: file.mode,
              type: "blob",
              sha: null,
            });
          }
        }
      }
    }

    for (const file of filesToCommit) {
      entries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        content: file.content,
      });
    }

    const treeSha = await createTree(token, repo, entries, baseTreeSha);
    const commitSha = await createCommit(token, repo, {
      message: COMMIT_MESSAGE,
      treeSha,
      parentSha: headSha,
    });
    await updateBranchRef(token, repo, branch, commitSha);

    // base_path はプロジェクトルート（book.config.js のある階層）を指す規約
    // （SPEC-vertical-editor-phase2 §7）。テンプレートはリポジトリルートに展開する
    // ため空（ルート）を設定する。'manuscripts' を設定するとエディタが章を
    // `manuscripts/manuscripts/` に探して章一覧が空になる（Issue #176）
    const { error: updateError } = await supabase
      .from("projects")
      .update({ base_path: "" })
      .eq("id", pid);
    if (updateError) throw new AppError("internal", updateError.message);

    revalidatePath("/projects");
    revalidatePath(`/projects/${pid}`);
    return { ok: true, data: { backupDir } };
  } catch (error) {
    return toActionError(error);
  }
}
