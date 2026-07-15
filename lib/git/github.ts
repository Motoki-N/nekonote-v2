import 'server-only'

import { AppError } from '@/lib/errors'
import { repoSchema } from '@/lib/schemas/projects'

// GitHub REST API の薄いラッパー（SPEC-proofreading §5。octokit は入れない）。
// エラーは AppError に正規化する: 401/403=PAT無効・権限不足、404=リポジトリ/ファイル不達

const API_BASE = 'https://api.github.com'

/** 原稿として扱う拡張子（SPEC-proofreading §3.2） */
const MANUSCRIPT_EXTENSIONS = ['.md', '.txt']

export type ManuscriptTreeEntry = {
  /** リポジトリルートからのパス */
  path: string
}

// DB由来の repo も使用時に再検証する（PostgREST直叩きで作られた不正な行への多層防御。
// manuscriptFilePathSchema の再検証と対称）。repo を受け取る全公開関数の入口で呼ぶ
function validRepo(repo: string): string {
  const parsed = repoSchema.safeParse(repo)
  if (!parsed.success) {
    throw new AppError('validation', 'リポジトリ名が不正です。プロジェクト設定を確認してください')
  }
  return parsed.data
}

async function githubFetch(
  token: string,
  path: string,
  accept = 'application/vnd.github+json',
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    // 原稿は常に最新を正とする（Next.js の fetch キャッシュに乗せない）
    cache: 'no-store',
  })
  return res
}

function toGithubError(res: Response, notFoundMessage: string): AppError {
  if (res.status === 401 || res.status === 403) {
    return new AppError(
      'validation',
      'GitHubトークンが無効か、権限が不足しています。設定でPATを確認してください',
    )
  }
  if (res.status === 404) return new AppError('not_found', notFoundMessage)
  return new AppError('internal', `GitHub APIエラー（status: ${res.status}）`)
}

/** PATの疎通検証（GET /user）。成功時は GitHub の login を返す */
export async function verifyToken(token: string): Promise<{ login: string }> {
  const res = await githubFetch(token, '/user')
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AppError('validation', 'トークンが無効です。値と有効期限を確認してください')
    }
    throw new AppError('internal', `GitHub APIエラー（status: ${res.status}）`)
  }
  const data = (await res.json()) as { login?: string }
  if (!data.login) throw new AppError('internal', 'GitHubユーザー情報の取得に失敗しました')
  return { login: data.login }
}

/** リポジトリのデフォルトブランチを取得する */
export async function getDefaultBranch(token: string, repo: string): Promise<string> {
  const res = await githubFetch(token, `/repos/${validRepo(repo)}`)
  if (!res.ok) {
    throw toGithubError(
      res,
      `リポジトリ ${repo} が見つかりません。リポジトリ名とPATの対象リポジトリ設定を確認してください`,
    )
  }
  const data = (await res.json()) as { default_branch?: string }
  if (!data.default_branch) throw new AppError('internal', 'デフォルトブランチの取得に失敗しました')
  return data.default_branch
}

/**
 * デフォルトブランチのツリーから base_path 配下の原稿ファイル（.md / .txt）をパス昇順で返す。
 * base_path が空ならリポジトリ全体
 */
export async function getManuscriptTree(
  token: string,
  repo: string,
  basePath: string,
): Promise<ManuscriptTreeEntry[]> {
  const branch = await getDefaultBranch(token, repo)
  const res = await githubFetch(
    token,
    `/repos/${validRepo(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )
  if (!res.ok) throw toGithubError(res, `リポジトリ ${repo} のファイル一覧を取得できません`)
  const data = (await res.json()) as {
    tree?: { path: string; type: string }[]
    truncated?: boolean
  }
  const prefix = basePath === '' ? '' : `${basePath.replace(/\/$/, '')}/`
  return (data.tree ?? [])
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        entry.path.startsWith(prefix) &&
        MANUSCRIPT_EXTENSIONS.some((ext) => entry.path.endsWith(ext)),
    )
    .map((entry) => ({ path: entry.path }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
}

function contentsApiPath(repo: string, filePath: string): string {
  return `/repos/${validRepo(repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`
}

export type ManuscriptFile = {
  content: string
  /** ファイルの blob SHA（Contents API での書き戻し時に必要） */
  sha: string
}

/** ファイル本文＋blob SHAを取得する（Contents API・base64復号。1MB超はAPI制約のままエラー） */
export async function getFileContent(
  token: string,
  repo: string,
  filePath: string,
): Promise<ManuscriptFile> {
  const res = await githubFetch(token, contentsApiPath(repo, filePath))
  if (!res.ok) throw toGithubError(res, `ファイル ${filePath} が見つかりません`)
  const data = (await res.json()) as { content?: string; encoding?: string; sha?: string }
  if (data.encoding !== 'base64' || data.content === undefined || !data.sha) {
    // 1MB超のファイルは content が返らない（Contents API の制約）
    throw new AppError('validation', 'このファイルは大きすぎて読み込めません（上限1MB）')
  }
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha }
}

/**
 * ファイルを書き戻して1コミットを作る（Contents API PUT）。
 * sha は取得時の blob SHA。リモートが先に更新されていると 409 になる（上書き事故の防止）。
 * blobSha（新しい blob SHA）を返すので、呼び出し側は再取得なしで楽観ロックの基準を進められる
 * （SPEC-vertical-editor-phase2 §6）
 */
export async function putFileContent(
  token: string,
  repo: string,
  filePath: string,
  params: { content: string; sha: string; message: string },
): Promise<{ commitSha: string; blobSha: string }> {
  const res = await fetch(`${API_BASE}${contentsApiPath(repo, filePath)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: params.message,
      content: Buffer.from(params.content, 'utf8').toString('base64'),
      sha: params.sha,
    }),
  })
  // 409 = blob SHA 不一致（取得後にリモートが更新された）。422 は他のバリデーション失敗でも
  // 返るため、SHA不一致の文言（"does not match"）のときだけ conflict に正規化する
  if (res.status === 409 || res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    if (res.status === 409 || /does not match/i.test(body.message ?? '')) {
      throw new AppError(
        'conflict',
        '原稿がリモートで更新されています。ファイルを開き直して提案を確認してから、もう一度コミットしてください',
      )
    }
    throw new AppError('internal', `GitHub APIエラー（status: ${res.status}）`)
  }
  if (!res.ok) throw toGithubError(res, `ファイル ${filePath} が見つかりません`)
  const data = (await res.json()) as { commit?: { sha?: string }; content?: { sha?: string } }
  if (!data.commit?.sha || !data.content?.sha) {
    throw new AppError('internal', 'コミット結果の取得に失敗しました')
  }
  return { commitSha: data.commit.sha, blobSha: data.content.sha }
}

/**
 * 新規ファイルを作成して1コミットを作る（Contents API PUT・sha なし。
 * SPEC-vertical-editor-phase2 §3.3 新規章作成）。既存ファイルと衝突したら conflict
 */
export async function createFileContent(
  token: string,
  repo: string,
  filePath: string,
  params: { content: string; message: string },
): Promise<{ commitSha: string; blobSha: string }> {
  const res = await fetch(`${API_BASE}${contentsApiPath(repo, filePath)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: params.message,
      content: Buffer.from(params.content, 'utf8').toString('base64'),
    }),
  })
  // sha なしのPUTで既存ファイルに当たると 422（"sha" wasn't supplied）になる
  if (res.status === 409 || res.status === 422) {
    throw new AppError(
      'conflict',
      '同名のファイルが既に存在します。別のファイル名を指定してください',
    )
  }
  if (!res.ok) throw toGithubError(res, `リポジトリ ${repo} にファイルを作成できません`)
  const data = (await res.json()) as { commit?: { sha?: string }; content?: { sha?: string } }
  if (!data.commit?.sha || !data.content?.sha) {
    throw new AppError('internal', 'コミット結果の取得に失敗しました')
  }
  return { commitSha: data.commit.sha, blobSha: data.content.sha }
}

/**
 * ファイルの生バイト列を取得する（画像プロキシ用。SPEC-vertical-editor-phase2 §5.3）。
 * Contents API の raw メディアタイプで取得するため base64 上限（1MB）より大きくても読める
 */
export async function getRawFileBytes(
  token: string,
  repo: string,
  filePath: string,
): Promise<ArrayBuffer> {
  const res = await githubFetch(token, contentsApiPath(repo, filePath), 'application/vnd.github.raw')
  if (!res.ok) throw toGithubError(res, `ファイル ${filePath} が見つかりません`)
  return res.arrayBuffer()
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
  )
  if (!res.ok) throw toGithubError(res, `ファイル ${filePath} のコミット履歴を取得できません`)
  const data = (await res.json()) as { sha?: string }[]
  const sha = data[0]?.sha
  if (!sha) throw new AppError('not_found', `ファイル ${filePath} のコミットが見つかりません`)
  return sha
}
