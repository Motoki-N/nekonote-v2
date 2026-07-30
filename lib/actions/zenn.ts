'use server'

import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { patCredentialProvider } from '@/lib/git/credentials'
import {
  createBinaryFileContent,
  createFileContent,
  getDefaultBranch,
  putFileContent,
} from '@/lib/git/github'
import { enforceRateLimit } from '@/lib/rate-limit'
import { repoSchema } from '@/lib/schemas/projects'
import {
  ZENN_MAX_IMAGE_BYTES,
  zennArticleInputSchema,
  zennImageBase64Schema,
  zennImageFileNameSchema,
  zennSlugSchema,
} from '@/lib/schemas/zenn'
import type { ZennArticleInput } from '@/lib/schemas/zenn'
import { createClient } from '@/lib/supabase/server'
import { buildZennArticleFile } from '@/lib/zenn/frontmatter'

// Zenn連携の Server Actions（SPEC-zenn-integration §4）。
// 記事の実体は常にZenn連携リポジトリ（読み書きとも Contents API 経由・DBには置かない）

const blobShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'SHAが不正です')

/** DB由来 zenn_repo の使用時再検証（ZodError を internal にしないため AppError に変換する） */
function validZennRepo(repo: string): string {
  const parsed = repoSchema.safeParse(repo)
  if (!parsed.success) {
    throw new AppError('validation', 'Zenn連携リポジトリ名が不正です。設定を確認してください')
  }
  return parsed.data
}

type ZennContext = {
  userId: string
  repo: string
  token: string
}

/** 認証＋zenn_repo取得（RLS越し）＋PAT取得。前提未達は AppError */
async function loadZennContext(): Promise<ZennContext> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new AppError('unauthorized', 'ログインが必要です')

  const { data, error } = await supabase.from('user_settings').select('zenn_repo').maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data?.zenn_repo) {
    throw new AppError('validation', 'Zenn連携リポジトリが未登録です。設定から登録してください')
  }
  // DB由来値の使用時再検証（github.ts の validRepo と同じ多層防御の作法）
  const repo = validZennRepo(data.zenn_repo)

  const credential = await patCredentialProvider.getCredential(supabase)
  if (!credential) {
    throw new AppError('validation', 'GitHub PATが未登録です。設定から登録してください')
  }

  return { userId: user.id, repo, token: credential.token }
}

export type ZennWorkspaceData =
  | { gate: 'no_pat' }
  | { gate: 'no_zenn_repo' }
  | { gate: 'ok'; repo: string; defaultBranch: string }

/**
 * 投稿画面の初期データ。前提未達（PAT/zenn_repo）は gate で返す
 * （getEditorWorkspace と同型）。defaultBranch の取得が疎通確認を兼ねる
 */
export async function getZennWorkspace(): Promise<ActionResult<ZennWorkspaceData>> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    const credential = await patCredentialProvider.getCredential(supabase)
    if (!credential) return { ok: true, data: { gate: 'no_pat' } }

    const { data, error } = await supabase.from('user_settings').select('zenn_repo').maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!data?.zenn_repo) return { ok: true, data: { gate: 'no_zenn_repo' } }
    const repo = validZennRepo(data.zenn_repo)

    const defaultBranch = await getDefaultBranch(credential.token, repo)
    return { ok: true, data: { gate: 'ok', repo, defaultBranch } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 新規記事の投稿＝コミット（SPEC §4）。パスはサーバーで articles/<slug>.md を合成する。
 * slug衝突は事前GETせず、sha なしPUTの conflict 正規化（createFileContent）をそのまま使う
 * （TOCTOU回避・1往復で原子的）
 */
export async function publishZennArticle(
  input: ZennArticleInput,
): Promise<ActionResult<{ path: string; commitSha: string; blobSha: string }>> {
  try {
    const ctx = await loadZennContext()
    enforceRateLimit(ctx.userId, 'zenn-save', { perMinute: 12, perDay: 600 })
    const article = zennArticleInputSchema.parse(input)
    const path = `articles/${article.slug}.md`
    const { commitSha, blobSha } = await createFileContent(ctx.token, ctx.repo, path, {
      content: buildZennArticleFile(article),
      message: `Zenn: ${path} を新規作成（ネコノテAI）`,
      // branch 省略＝デフォルトブランチへ直接コミット（SPEC §2）
    })
    return { ok: true, data: { path, commitSha, blobSha } }
  } catch (error) {
    // 共通の conflict 文言はファイル名文脈のため、slug の言葉に置き換える（SPEC §4）
    if (error instanceof AppError && error.code === 'conflict') {
      return toActionError(
        new AppError('conflict', 'このslugの記事が既に存在します。slugを変更してください'),
      )
    }
    return toActionError(error)
  }
}

/**
 * 投稿済み記事の再保存＝再コミット（同一執筆画面内のみ。SPEC §2 スコープ）。
 * baseSha による楽観ロック（saveChapter と同一作法）。リモート先行更新は conflict
 */
export async function saveZennArticle(
  input: ZennArticleInput & { baseSha: string },
): Promise<ActionResult<{ commitSha: string; blobSha: string }>> {
  try {
    const ctx = await loadZennContext()
    enforceRateLimit(ctx.userId, 'zenn-save', { perMinute: 12, perDay: 600 })
    const article = zennArticleInputSchema.parse(input)
    const baseSha = blobShaSchema.parse(input.baseSha)
    const path = `articles/${article.slug}.md`
    const result = await putFileContent(ctx.token, ctx.repo, path, {
      content: buildZennArticleFile(article),
      sha: baseSha,
      message: `Zenn: ${path} を更新（ネコノテAI）`,
    })
    return { ok: true, data: result }
  } catch (error) {
    // 共通の conflict 文言は校正フロー文脈のため、Zenn の言葉に置き換える（SPEC §4）
    if (error instanceof AppError && error.code === 'conflict') {
      return toActionError(
        new AppError(
          'conflict',
          '記事がリモートで更新されています。上書きを防ぐためコミットを中止しました。以降の編集はZenn/GitHub側で行ってください',
        ),
      )
    }
    return toActionError(error)
  }
}

/**
 * 画像を `images/<slug>/` へ即コミットする（SPEC §11・縦書きエディタ phase3 §6 と同方式）。
 * 同名ファイルがある場合は `-2` からの連番でリネームして再試行する。
 * 挿入記法の追記・プレビュー用Blob URLの管理はクライアントの責務
 */
export async function uploadZennImage(
  slug: string,
  fileName: string,
  base64Content: string,
): Promise<ActionResult<{ path: string; fileName: string }>> {
  try {
    const ctx = await loadZennContext()
    enforceRateLimit(ctx.userId, 'zenn-upload', { perMinute: 6, perDay: 100 })
    const safeSlug = zennSlugSchema.parse(slug)
    const name = zennImageFileNameSchema.parse(fileName)
    const content = zennImageBase64Schema.parse(base64Content)
    // 粗い長さ検査（スキーマ）に加え、デコード後バイト数でZenn上限を再検査（二段）
    if (Buffer.from(content, 'base64').length > ZENN_MAX_IMAGE_BYTES) {
      throw new AppError('validation', '画像が大きすぎます（Zennの上限3MB）')
    }

    const dot = name.lastIndexOf('.')
    const stem = name.slice(0, dot)
    const ext = name.slice(dot)
    // 同名衝突は連番リネームで自動回避（最大5回。使い勝手優先で聞き返さない）
    for (let attempt = 1; attempt <= 5; attempt++) {
      const candidate = attempt === 1 ? name : `${stem}-${attempt}${ext}`
      // slug は [a-z0-9_-]・ファイル名は英数始まり＋allowlist のみ＝パストラバーサル不能
      const path = `images/${safeSlug}/${candidate}`
      try {
        await createBinaryFileContent(ctx.token, ctx.repo, path, {
          base64Content: content,
          message: `Zenn: ${path} を追加（ネコノテAI）`,
          // branch 省略＝デフォルトブランチへ直接コミット（SPEC §2）
        })
        return { ok: true, data: { path, fileName: candidate } }
      } catch (error) {
        if (error instanceof AppError && error.code === 'conflict') continue
        throw error
      }
    }
    throw new AppError('conflict', '同名の画像が既に多数あります。ファイル名を変えてください')
  } catch (error) {
    return toActionError(error)
  }
}
