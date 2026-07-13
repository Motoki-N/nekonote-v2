import 'server-only'

import { AppError } from '@/lib/errors'

// GitHub REST API の薄いラッパー（SPEC-proofreading §5。octokit は入れない）。
// エラーは AppError に正規化する: 401/403=PAT無効・権限不足、404=リポジトリ/ファイル不達

const API_BASE = 'https://api.github.com'

/** 原稿として扱う拡張子（SPEC-proofreading §3.2） */
const MANUSCRIPT_EXTENSIONS = ['.md', '.txt']

export type ManuscriptTreeEntry = {
  /** リポジトリルートからのパス */
  path: string
}

async function githubFetch(token: string, path: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
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
  const res = await githubFetch(token, `/repos/${repo}`)
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
    `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
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

/** ファイル本文を取得する（Contents API・base64復号。1MB超はAPI制約のままエラー） */
export async function getFileContent(
  token: string,
  repo: string,
  filePath: string,
): Promise<string> {
  const res = await githubFetch(
    token,
    `/repos/${repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`,
  )
  if (!res.ok) throw toGithubError(res, `ファイル ${filePath} が見つかりません`)
  const data = (await res.json()) as { content?: string; encoding?: string }
  if (data.encoding !== 'base64' || data.content === undefined) {
    // 1MB超のファイルは content が返らない（Contents API の制約）
    throw new AppError('validation', 'このファイルは大きすぎて読み込めません（上限1MB）')
  }
  return Buffer.from(data.content, 'base64').toString('utf8')
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
    `/repos/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=1`,
  )
  if (!res.ok) throw toGithubError(res, `ファイル ${filePath} のコミット履歴を取得できません`)
  const data = (await res.json()) as { sha?: string }[]
  const sha = data[0]?.sha
  if (!sha) throw new AppError('not_found', `ファイル ${filePath} のコミットが見つかりません`)
  return sha
}
