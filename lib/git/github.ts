import "server-only";

import { AppError } from "@/lib/errors";
import { repoSchema } from "@/lib/schemas/projects";

// GitHub REST API の薄いラッパー（SPEC-proofreading §5。octokit は入れない）。
// エラーは AppError に正規化する: 401/403=PAT無効・権限不足、404=リポジトリ/ファイル不達

const API_BASE = "https://api.github.com";

/** 原稿として扱う拡張子（SPEC-proofreading §3.2） */
const MANUSCRIPT_EXTENSIONS = [".md", ".txt"];

export type ManuscriptTreeEntry = {
  /** リポジトリルートからのパス */
  path: string;
};

// DB由来の repo も使用時に再検証する（PostgREST直叩きで作られた不正な行への多層防御。
// manuscriptFilePathSchema の再検証と対称）。repo を受け取る全公開関数の入口で呼ぶ
function validRepo(repo: string): string {
  const parsed = repoSchema.safeParse(repo);
  if (!parsed.success) {
    throw new AppError(
      "validation",
      "リポジトリ名が不正です。プロジェクト設定を確認してください",
    );
  }
  return parsed.data;
}

async function githubFetch(
  token: string,
  path: string,
  accept = "application/vnd.github+json",
): Promise<Response> {
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // 原稿は常に最新を正とする（Next.js の fetch キャッシュに乗せない）
      cache: "no-store",
    });
  try {
    return await doFetch();
  } catch {
    // 長時間稼働プロセスの stale keep-alive で接続確立前に切断されることがある
    // （UND_ERR_SOCKET。回帰テスト 2026-08-12 で実測・code-review-20260812 P-4）。
    // 本関数は GET 専用（書き込み系は本関数を経由せず直接 fetch する）のため冪等で、1回だけ再試行する
    return await doFetch();
  }
}

function toGithubError(res: Response, notFoundMessage: string): AppError {
  if (res.status === 401 || res.status === 403) {
    return new AppError(
      "validation",
      "GitHubトークンが無効か、権限が不足しています。設定でPATを確認してください",
    );
  }
  if (res.status === 404) return new AppError("not_found", notFoundMessage);
  return new AppError("internal", `GitHub APIエラー（status: ${res.status}）`);
}

/** PATの疎通検証（GET /user）。成功時は GitHub の login を返す */
export async function verifyToken(token: string): Promise<{ login: string }> {
  const res = await githubFetch(token, "/user");
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AppError(
        "validation",
        "トークンが無効です。値と有効期限を確認してください",
      );
    }
    throw new AppError("internal", `GitHub APIエラー（status: ${res.status}）`);
  }
  const data = (await res.json()) as { login?: string };
  if (!data.login)
    throw new AppError("internal", "GitHubユーザー情報の取得に失敗しました");
  return { login: data.login };
}

/** 読み取り系APIの `?ref=` クエリ（省略時はデフォルトブランチ。SPEC-vertical-editor-phase5） */
function refQuery(ref?: string): string {
  return ref ? `?ref=${encodeURIComponent(ref)}` : "";
}

/** リポジトリのデフォルトブランチを取得する */
export async function getDefaultBranch(
  token: string,
  repo: string,
): Promise<string> {
  const res = await githubFetch(token, `/repos/${validRepo(repo)}`);
  if (!res.ok) {
    throw toGithubError(
      res,
      `リポジトリ ${repo} が見つかりません。リポジトリ名とPATの対象リポジトリ設定を確認してください`,
    );
  }
  const data = (await res.json()) as { default_branch?: string };
  if (!data.default_branch)
    throw new AppError("internal", "デフォルトブランチの取得に失敗しました");
  return data.default_branch;
}

/**
 * 対象ブランチ（省略時はデフォルトブランチ）のツリーから base_path 配下の
 * 原稿ファイル（.md / .txt）をパス昇順で返す。base_path が空ならリポジトリ全体
 */
export async function getManuscriptTree(
  token: string,
  repo: string,
  basePath: string,
  ref?: string,
): Promise<ManuscriptTreeEntry[]> {
  const branch = ref ?? (await getDefaultBranch(token, repo));
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (!res.ok)
    throw toGithubError(
      res,
      `リポジトリ ${repo} のファイル一覧を取得できません`,
    );
  const data = (await res.json()) as {
    tree?: { path: string; type: string }[];
    truncated?: boolean;
  };
  const prefix = basePath === "" ? "" : `${basePath.replace(/\/$/, "")}/`;
  return (data.tree ?? [])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.startsWith(prefix) &&
        MANUSCRIPT_EXTENSIONS.some((ext) => entry.path.endsWith(ext)),
    )
    .map((entry) => ({ path: entry.path }))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function contentsApiPath(repo: string, filePath: string): string {
  return `/repos/${validRepo(repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

export type ManuscriptFile = {
  content: string;
  /** ファイルの blob SHA（Contents API での書き戻し時に必要） */
  sha: string;
};

/** ファイル本文＋blob SHAを取得する（Contents API・base64復号。1MB超はAPI制約のままエラー） */
export async function getFileContent(
  token: string,
  repo: string,
  filePath: string,
  ref?: string,
): Promise<ManuscriptFile> {
  const res = await githubFetch(
    token,
    `${contentsApiPath(repo, filePath)}${refQuery(ref)}`,
  );
  if (!res.ok)
    throw toGithubError(res, `ファイル ${filePath} が見つかりません`);
  const data = (await res.json()) as {
    content?: string;
    encoding?: string;
    sha?: string;
  };
  if (data.encoding !== "base64" || data.content === undefined || !data.sha) {
    // 1MB超のファイルは content が返らない（Contents API の制約）
    throw new AppError(
      "validation",
      "このファイルは大きすぎて読み込めません（上限1MB）",
    );
  }
  return {
    content: Buffer.from(data.content, "base64").toString("utf8"),
    sha: data.sha,
  };
}

/**
 * ファイルを書き戻して1コミットを作る（Contents API PUT）。
 * sha は取得時の blob SHA。リモートが先に更新されていると 409 になる（上書き事故の防止）。
 * blobSha（新しい blob SHA）を返すので、呼び出し側は再取得なしで楽観ロックの基準を進められる
 * （SPEC-vertical-editor-phase2 §6）。branch 省略時はデフォルトブランチへコミットする
 */
export async function putFileContent(
  token: string,
  repo: string,
  filePath: string,
  params: { content: string; sha: string; message: string; branch?: string },
): Promise<{ commitSha: string; blobSha: string }> {
  const res = await fetch(`${API_BASE}${contentsApiPath(repo, filePath)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: params.message,
      content: Buffer.from(params.content, "utf8").toString("base64"),
      sha: params.sha,
      ...(params.branch ? { branch: params.branch } : {}),
    }),
  });
  // 409 = blob SHA 不一致（取得後にリモートが更新された）。422 は他のバリデーション失敗でも
  // 返るため、SHA不一致の文言（"does not match"）のときだけ conflict に正規化する
  if (res.status === 409 || res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 409 || /does not match/i.test(body.message ?? "")) {
      throw new AppError(
        "conflict",
        "原稿がリモートで更新されています。ファイルを開き直して提案を確認してから、もう一度コミットしてください",
      );
    }
    throw new AppError("internal", `GitHub APIエラー（status: ${res.status}）`);
  }
  if (!res.ok)
    throw toGithubError(res, `ファイル ${filePath} が見つかりません`);
  const data = (await res.json()) as {
    commit?: { sha?: string };
    content?: { sha?: string };
  };
  if (!data.commit?.sha || !data.content?.sha) {
    throw new AppError("internal", "コミット結果の取得に失敗しました");
  }
  return { commitSha: data.commit.sha, blobSha: data.content.sha };
}

/**
 * 新規ファイルを作成して1コミットを作る（Contents API PUT・sha なし。
 * SPEC-vertical-editor-phase2 §3.3 新規章作成）。既存ファイルと衝突したら conflict
 */
export async function createFileContent(
  token: string,
  repo: string,
  filePath: string,
  params: { content: string; message: string; branch?: string },
): Promise<{ commitSha: string; blobSha: string }> {
  const res = await fetch(`${API_BASE}${contentsApiPath(repo, filePath)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: params.message,
      content: Buffer.from(params.content, "utf8").toString("base64"),
      ...(params.branch ? { branch: params.branch } : {}),
    }),
  });
  // sha なしのPUTで既存ファイルに当たると 422（"sha" wasn't supplied）になる
  if (res.status === 409 || res.status === 422) {
    throw new AppError(
      "conflict",
      "同名のファイルが既に存在します。別のファイル名を指定してください",
    );
  }
  if (!res.ok)
    throw toGithubError(res, `リポジトリ ${repo} にファイルを作成できません`);
  const data = (await res.json()) as {
    commit?: { sha?: string };
    content?: { sha?: string };
  };
  if (!data.commit?.sha || !data.content?.sha) {
    throw new AppError("internal", "コミット結果の取得に失敗しました");
  }
  return { commitSha: data.commit.sha, blobSha: data.content.sha };
}

/**
 * バイナリファイル（画像）を新規作成して1コミットを作る（SPEC-vertical-editor-phase3 §6）。
 * content は呼び出し側で base64 済み（テキスト前提の createFileContent と区別する）。
 * 既存ファイルと衝突したら conflict（呼び出し側が連番リネームで再試行する）
 */
export async function createBinaryFileContent(
  token: string,
  repo: string,
  filePath: string,
  params: { base64Content: string; message: string; branch?: string },
): Promise<{ commitSha: string; blobSha: string }> {
  const res = await fetch(`${API_BASE}${contentsApiPath(repo, filePath)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: params.message,
      content: params.base64Content,
      ...(params.branch ? { branch: params.branch } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    throw new AppError("conflict", "同名のファイルが既に存在します");
  }
  if (!res.ok)
    throw toGithubError(res, `リポジトリ ${repo} にファイルを作成できません`);
  const data = (await res.json()) as {
    commit?: { sha?: string };
    content?: { sha?: string };
  };
  if (!data.commit?.sha || !data.content?.sha) {
    throw new AppError("internal", "コミット結果の取得に失敗しました");
  }
  return { commitSha: data.commit.sha, blobSha: data.content.sha };
}

/**
 * ファイルの生バイト列を取得する（画像プロキシ用。SPEC-vertical-editor-phase2 §5.3）。
 * Contents API の raw メディアタイプで取得するため base64 上限（1MB）より大きくても読める
 */
export async function getRawFileBytes(
  token: string,
  repo: string,
  filePath: string,
  ref?: string,
): Promise<ArrayBuffer> {
  const res = await githubFetch(
    token,
    `${contentsApiPath(repo, filePath)}${refQuery(ref)}`,
    "application/vnd.github.raw",
  );
  if (!res.ok)
    throw toGithubError(res, `ファイル ${filePath} が見つかりません`);
  return res.arrayBuffer();
}

// ---- 入稿ビルド（SPEC-vertical-editor-phase3 §8）。
// タグ作成の代行＝Git Refs API（Contents権限で可能・PATスコープ変更なし）。
// 完了検知は Releases API のポーリング（同じく Contents 権限で読める）

/** タグ一覧（名前のみ・最大100件）。入稿タグの次番号の提案に使う */
export async function listTags(token: string, repo: string): Promise<string[]> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/tags?per_page=100`,
  );
  if (!res.ok)
    throw toGithubError(res, `リポジトリ ${repo} のタグ一覧を取得できません`);
  const data = (await res.json()) as { name?: string }[];
  return data.flatMap((tag) => (tag.name ? [tag.name] : []));
}

/** ブランチHEADのコミットSHAを取得する */
export async function getBranchHeadSha(
  token: string,
  repo: string,
  branch: string,
): Promise<string> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/git/ref/${encodeURIComponent(`heads/${branch}`)}`,
  );
  if (!res.ok) throw toGithubError(res, `ブランチ ${branch} が見つかりません`);
  const data = (await res.json()) as { object?: { sha?: string } };
  if (!data.object?.sha)
    throw new AppError("internal", "ブランチHEADの取得に失敗しました");
  return data.object.sha;
}

/** 軽量タグを作成する（Git Refs API）。同名タグが既にあると conflict */
export async function createTagRef(
  token: string,
  repo: string,
  tag: string,
  sha: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${validRepo(repo)}/git/refs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
  });
  if (res.status === 422) {
    throw new AppError(
      "conflict",
      `タグ ${tag} は既に存在します。別のタグ名を指定してください`,
    );
  }
  if (!res.ok)
    throw toGithubError(res, `リポジトリ ${repo} にタグを作成できません`);
}

export type ReleaseAsset = {
  id: number;
  name: string;
  sizeBytes: number;
};

/** タグに紐づく Release を取得する。まだ無ければ null（ビルド進行中） */
export async function getReleaseByTag(
  token: string,
  repo: string,
  tag: string,
): Promise<{ assets: ReleaseAsset[] } | null> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/releases/tags/${encodeURIComponent(tag)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw toGithubError(res, `リポジトリ ${repo} の Release を取得できません`);
  const data = (await res.json()) as {
    assets?: { id?: number; name?: string; size?: number }[];
  };
  return {
    assets: (data.assets ?? []).flatMap((asset) =>
      asset.id && asset.name
        ? [{ id: asset.id, name: asset.name, sizeBytes: asset.size ?? 0 }]
        : [],
    ),
  };
}

/**
 * Release アセットのダウンロード先（S3の署名付きURL）を取得する。
 * octet-stream 要求への 302 の Location を返す（本体はプロキシせずリダイレクトで届ける——
 * Vercel のレスポンスサイズ制限を避ける。SPEC-phase3 §9）
 */
export async function getReleaseAssetLocation(
  token: string,
  repo: string,
  assetId: number,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/repos/${validRepo(repo)}/releases/assets/${assetId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      cache: "no-store",
    },
  );
  const location = res.headers.get("location");
  if ((res.status === 302 || res.status === 307) && location) return location;
  throw toGithubError(res, "Release アセットが見つかりません");
}

// ---- ブランチ・PR連携（SPEC-vertical-editor-phase5） ----

/** ブランチ一覧（名前のみ・最大100件）。エディタのブランチセレクタに使う */
export async function listBranches(
  token: string,
  repo: string,
): Promise<string[]> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/branches?per_page=100`,
  );
  if (!res.ok)
    throw toGithubError(
      res,
      `リポジトリ ${repo} のブランチ一覧を取得できません`,
    );
  const data = (await res.json()) as { name?: string }[];
  return data.flatMap((branch) => (branch.name ? [branch.name] : []));
}

/** ブランチを作成する（Git Refs API。sha は起点コミット）。同名ブランチが既にあると conflict */
export async function createBranchRef(
  token: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${validRepo(repo)}/git/refs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  // 422 は「既存」以外にも git の ref 規則違反（"Reference name is not well formed"）で返る。
  // ボディの message で区別する（自己レビュー指摘の反映）
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (/already exists/i.test(body.message ?? "")) {
      throw new AppError(
        "conflict",
        `ブランチ ${branch} は既に存在します。別の名前を指定してください`,
      );
    }
    throw new AppError(
      "validation",
      `ブランチ名 ${branch} はGitHubに受け付けられませんでした。別の名前を指定してください`,
    );
  }
  if (!res.ok)
    throw toGithubError(res, `リポジトリ ${repo} にブランチを作成できません`);
}

/**
 * Pull Request を作成する（head→base）。差分ゼロ・既存PRありは 422 で返るため
 * 日本語メッセージに正規化する（SPEC-phase5 §3.3）
 */
export async function createPullRequest(
  token: string,
  repo: string,
  params: { title: string; body: string; head: string; base: string },
): Promise<{ number: number; htmlUrl: string }> {
  const res = await fetch(`${API_BASE}/repos/${validRepo(repo)}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as {
      errors?: { message?: string }[];
      message?: string;
    };
    const detail = [
      body.message ?? "",
      ...(body.errors ?? []).map((e) => e.message ?? ""),
    ].join(" ");
    if (/no commits between/i.test(detail)) {
      throw new AppError(
        "validation",
        "デフォルトブランチとの差分がありません。先に変更を保存（コミット）してください",
      );
    }
    if (/pull request already exists/i.test(detail)) {
      throw new AppError(
        "conflict",
        "このブランチのPull Requestは既に作成されています",
      );
    }
    throw new AppError("internal", `GitHub APIエラー（status: ${res.status}）`);
  }
  if (!res.ok)
    throw toGithubError(
      res,
      `リポジトリ ${repo} にPull Requestを作成できません`,
    );
  const data = (await res.json()) as { number?: number; html_url?: string };
  if (!data.number || !data.html_url) {
    throw new AppError("internal", "Pull Request 結果の取得に失敗しました");
  }
  return { number: data.number, htmlUrl: data.html_url };
}

// ---- 原稿リポジトリの初期セットアップ（SPEC-repo-setup §4.3）。
// 退避＋テンプレート展開を Git Data API の1コミットで行う（blob→tree→commit→ref）。
// Contents API と違い、既存 blob の SHA 張り直しで内容の再アップロードなしにファイルを移動できる

/**
 * ブランチHEADのコミットSHA。ブランチ（ref）が無い＝空リポジトリなら null を返す
 * （getBranchHeadSha は 404 を throw するため、空リポジトリ判定用に別関数）
 */
export async function getBranchHeadShaOrNull(
  token: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/git/ref/${encodeURIComponent(`heads/${branch}`)}`,
  );
  // 404 = ref なし。409 = "Git Repository is empty"（初期化直後のリポジトリで返る）
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw toGithubError(res, `ブランチ ${branch} が見つかりません`);
  const data = (await res.json()) as { object?: { sha?: string } };
  if (!data.object?.sha)
    throw new AppError("internal", "ブランチHEADの取得に失敗しました");
  return data.object.sha;
}

export type RepoTreeFile = {
  path: string;
  /** blob SHA（退避時に新パスへ張り直す） */
  sha: string;
  /** ファイルモード（100644/100755/120000）。退避時に元のモードを保つ */
  mode: string;
};

/**
 * コミット配下の全ファイル（blob）の path・SHA・mode と、ツリー自体のSHAを返す。
 * getManuscriptTree は .md/.txt に絞るため、全ファイル退避用に別関数
 */
export async function getFullTree(
  token: string,
  repo: string,
  commitSha: string,
): Promise<{ treeSha: string; files: RepoTreeFile[] }> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
  );
  if (!res.ok)
    throw toGithubError(
      res,
      `リポジトリ ${repo} のファイル一覧を取得できません`,
    );
  const data = (await res.json()) as {
    sha?: string;
    tree?: { path?: string; type?: string; sha?: string; mode?: string }[];
    truncated?: boolean;
  };
  if (!data.sha) throw new AppError("internal", "ツリーの取得に失敗しました");
  if (data.truncated) {
    throw new AppError(
      "validation",
      "リポジトリのファイル数が多すぎて退避できません。空のリポジトリでやり直してください",
    );
  }
  return {
    treeSha: data.sha,
    files: (data.tree ?? []).flatMap((entry) =>
      entry.type === "blob" && entry.path && entry.sha && entry.mode
        ? [{ path: entry.path, sha: entry.sha, mode: entry.mode }]
        : [],
    ),
  };
}

export type SetupTreeEntry = {
  path: string;
  mode: string;
  type: "blob";
} & (
  | {
      /** UTF-8テキスト。API側で blob 化される */
      content: string;
    }
  | {
      /** 既存 blob の張り直し。null は削除 */
      sha: string | null;
    }
);

// Workflows 権限のない Fine-grained PAT で .github/workflows/ を書くと
// "refusing to allow a Personal Access Token to create or update workflow" が返る（403/422）
async function throwSetupError(
  res: Response,
  fallbackMessage: string,
): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (/refusing to allow.*workflow/i.test(body.message ?? "")) {
    throw new AppError(
      "validation",
      "PATに Workflows: Read and write 権限がないため、ビルド用ワークフローを書き込めませんでした。設定を確認してください",
    );
  }
  throw toGithubError(res, fallbackMessage);
}

/** ツリーを作成してSHAを返す。baseTreeSha 省略時はゼロから（空リポジトリ用） */
export async function createTree(
  token: string,
  repo: string,
  entries: SetupTreeEntry[],
  baseTreeSha?: string,
): Promise<string> {
  const res = await fetch(`${API_BASE}/repos/${validRepo(repo)}/git/trees`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tree: entries,
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    }),
  });
  if (!res.ok)
    await throwSetupError(res, `リポジトリ ${repo} にツリーを作成できません`);
  const data = (await res.json()) as { sha?: string };
  if (!data.sha)
    throw new AppError("internal", "ツリー作成結果の取得に失敗しました");
  return data.sha;
}

/** コミットを作成してSHAを返す。parentSha 省略時は親なし（空リポジトリの初回コミット） */
export async function createCommit(
  token: string,
  repo: string,
  params: { message: string; treeSha: string; parentSha?: string },
): Promise<string> {
  const res = await fetch(`${API_BASE}/repos/${validRepo(repo)}/git/commits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: params.message,
      tree: params.treeSha,
      parents: params.parentSha ? [params.parentSha] : [],
    }),
  });
  if (!res.ok)
    await throwSetupError(res, `リポジトリ ${repo} にコミットを作成できません`);
  const data = (await res.json()) as { sha?: string };
  if (!data.sha)
    throw new AppError("internal", "コミット作成結果の取得に失敗しました");
  return data.sha;
}

/**
 * ブランチrefを新しいコミットへ進める（fast-forward。force はしない）。
 * HEAD取得後に他所からpushがあった場合は 422 になり conflict へ正規化する
 */
export async function updateBranchRef(
  token: string,
  repo: string,
  branch: string,
  commitSha: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/repos/${validRepo(repo)}/git/refs/${encodeURIComponent(`heads/${branch}`)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: commitSha }),
    },
  );
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (/refusing to allow.*workflow/i.test(body.message ?? "")) {
      throw new AppError(
        "validation",
        "PATに Workflows: Read and write 権限がないため、ビルド用ワークフローを書き込めませんでした。設定を確認してください",
      );
    }
    throw new AppError(
      "conflict",
      "リポジトリがセットアップ中に更新されました。もう一度実行してください",
    );
  }
  if (!res.ok)
    await throwSetupError(res, `ブランチ ${branch} を更新できません`);
}

/**
 * そのファイルに触れた最新コミットのSHAを返す（ファイル単位。リポジトリHEADではない）。
 * モノレポで他作品へのコミットに更新バナーを反応させないための要（SPEC-proofreading §4）
 */
export async function getLatestCommitSha(
  token: string,
  repo: string,
  filePath: string,
): Promise<string> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/commits?path=${encodeURIComponent(filePath)}&per_page=1`,
  );
  if (!res.ok)
    throw toGithubError(
      res,
      `ファイル ${filePath} のコミット履歴を取得できません`,
    );
  const data = (await res.json()) as { sha?: string }[];
  const sha = data[0]?.sha;
  if (!sha)
    throw new AppError(
      "not_found",
      `ファイル ${filePath} のコミットが見つかりません`,
    );
  return sha;
}

// ---- コミット履歴・差分（SPEC-manuscript-history）。読み取りのみ・デフォルトブランチ固定 ----

export type FileCommitEntry = {
  sha: string;
  /** コミットメッセージ全文（表示側で1行目を使う） */
  message: string;
  /** コミット日時（ISO 8601）。API欠損時は null */
  date: string | null;
};

/**
 * そのファイルに触れたコミットの一覧（新しい順・最大30件）。
 * getLatestCommitSha と同じファイル単位の思想（モノレポで他作品のコミットを混ぜない）
 */
export async function listFileCommits(
  token: string,
  repo: string,
  filePath: string,
): Promise<FileCommitEntry[]> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/commits?path=${encodeURIComponent(filePath)}&per_page=30`,
  );
  if (!res.ok)
    throw toGithubError(
      res,
      `ファイル ${filePath} のコミット履歴を取得できません`,
    );
  const data = (await res.json()) as {
    sha?: string;
    commit?: {
      message?: string;
      committer?: { date?: string };
      author?: { date?: string };
    };
  }[];
  return data.flatMap((entry) =>
    entry.sha
      ? [
          {
            sha: entry.sha,
            message: entry.commit?.message ?? "",
            date:
              entry.commit?.committer?.date ??
              entry.commit?.author?.date ??
              null,
          },
        ]
      : [],
  );
}

/**
 * コミットでのそのファイルの変更（unified diff の patch）を返す。
 * patch が無い場合（差分過大・バイナリ扱い）は null。リネームは previous_filename も突き合わせる
 */
export async function getCommitFilePatch(
  token: string,
  repo: string,
  commitSha: string,
  filePath: string,
): Promise<string | null> {
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/commits/${encodeURIComponent(commitSha)}`,
  );
  if (!res.ok)
    throw toGithubError(
      res,
      `コミット ${commitSha.slice(0, 7)} が見つかりません`,
    );
  const data = (await res.json()) as {
    files?: { filename?: string; previous_filename?: string; patch?: string }[];
  };
  const file = (data.files ?? []).find(
    (f) => f.filename === filePath || f.previous_filename === filePath,
  );
  return file?.patch ?? null;
}
