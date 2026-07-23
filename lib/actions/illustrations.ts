'use server'

import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { enforceRateLimit } from '@/lib/rate-limit'
import type { StoredIllustrationKind } from '@/lib/schemas/enums'
import {
  ILLUSTRATION_EXTENSION_BY_MIME,
  ILLUSTRATION_KIND_LABEL,
  illustrationTitleSchema,
  REFERENCE_UPLOAD_MAX_BYTES,
  type IllustrationItem,
} from '@/lib/schemas/illustration'
import { createClient } from '@/lib/supabase/server'

// ギャラリーの取得・タイトル編集・削除（SPEC-illustrator §5.4）＋参照画像のアップロード（Issue #104）。
// 生成は /api/illustration/*（レートリミット・長時間実行のためAPI Route側）

const uuidSchema = z.uuid()

/** 署名URLの寿命（SPEC §6: 短寿命） */
const SIGNED_URL_TTL_SECONDS = 3600

/** 選択中プロジェクトのイラスト一覧（新しい順）＋署名URL＋被参照数（削除警告用） */
export async function listIllustrations(
  projectId: string,
): Promise<ActionResult<IllustrationItem[]>> {
  try {
    const parsedId = uuidSchema.parse(projectId)
    const supabase = await createClient()

    // RLS越し＝自分のイラストのみ。被参照数も自分の行の範囲で数える（それ以外は存在しない前提）
    const { data: rows, error } = await supabase
      .from('illustrations')
      .select('id, project_id, kind, title, prompt, reference_illustration_id, storage_path, created_at')
      .eq('project_id', parsedId)
      .order('created_at', { ascending: false })
    if (error) throw new AppError('internal', error.message)
    if (!rows || rows.length === 0) return { ok: true, data: [] }

    // 被参照数はプロジェクト横断で数える（他プロジェクトのイラストから参照されうる）
    const { data: refRows, error: refError } = await supabase
      .from('illustrations')
      .select('reference_illustration_id')
      .not('reference_illustration_id', 'is', null)
    if (refError) throw new AppError('internal', refError.message)
    const referencedCount = new Map<string, number>()
    for (const row of refRows ?? []) {
      const id = row.reference_illustration_id
      if (id) referencedCount.set(id, (referencedCount.get(id) ?? 0) + 1)
    }

    const { data: signed, error: signError } = await supabase.storage
      .from('illustrations')
      .createSignedUrls(
        rows.map((row) => row.storage_path),
        SIGNED_URL_TTL_SECONDS,
      )
    if (signError || !signed) {
      throw new AppError('internal', `画像URLの発行に失敗しました: ${signError?.message}`)
    }
    const urlByPath = new Map(signed.map((entry) => [entry.path, entry.signedUrl]))

    // 実体を失った行（削除の途中失敗等）はスキップし、一覧全体は生かす。
    // 該当行は削除のリトライ（remove は存在しないパスを許容）で消せる
    const items: IllustrationItem[] = rows.flatMap((row) => {
      const signedUrl = urlByPath.get(row.storage_path)
      if (!signedUrl) return []
      return {
        id: row.id,
        projectId: row.project_id,
        kind: row.kind as StoredIllustrationKind,
        title: row.title,
        prompt: row.prompt,
        referenceIllustrationId: row.reference_illustration_id,
        createdAt: row.created_at,
        signedUrl,
        referencedCount: referencedCount.get(row.id) ?? 0,
      }
    })
    return { ok: true, data: items }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 参照画像のアップロード（Issue #104）。
 * 外部画像を kind 'reference' の illustrations 行として保存し、ギャラリーと
 * 既存の参照フロー（reference_illustration_id）にそのまま乗せる。
 * 生成の依頼種別には 'reference' を追加しない（propose/generate の zod が遮断する）
 */
export async function uploadReferenceImage(
  projectId: string,
  formData: FormData,
): Promise<ActionResult<IllustrationItem>> {
  try {
    const parsedProjectId = uuidSchema.parse(projectId)
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new AppError('validation', '画像ファイルを選択してください')
    }
    // バケットの制限（allowed_mime_types・file_size_limit）と同値の事前検証。
    // MIME は申告値ベース（Storage 側の検証も同様）。バケットは非公開＋署名URLの
    // Content-Type は保存時の値に固定されるため、偽装ファイルが混じっても配信経路で実行されない
    const extension = ILLUSTRATION_EXTENSION_BY_MIME[file.type]
    if (!extension) {
      throw new AppError('validation', '対応している形式は PNG / JPEG / WebP です')
    }
    if (file.size === 0) {
      throw new AppError('validation', 'ファイルが空です')
    }
    if (file.size > REFERENCE_UPLOAD_MAX_BYTES) {
      throw new AppError('validation', 'ファイルサイズは10MB以下にしてください')
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new AppError('unauthorized', 'ログインが必要です')

    // AI呼び出しではないがストレージ書き込みの暴走は防ぐ（生成より緩め）
    enforceRateLimit(user.id, 'illustration-upload', { perMinute: 10, perDay: 100 })

    // RLS越しの取得＝所有確認。title は初期タイトルのフォールバックに使う
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, title')
      .eq('id', parsedProjectId)
      .maybeSingle()
    if (projectError) throw new AppError('internal', projectError.message)
    if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')

    // パスは生成画像と同じ {user_id}/{illustration_id}.{拡張子}（SPEC §5.1）
    const illustrationId = crypto.randomUUID()
    const storagePath = `${user.id}/${illustrationId}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from('illustrations')
      .upload(storagePath, file, { contentType: file.type })
    if (uploadError) {
      throw new AppError('internal', `画像の保存に失敗しました: ${uploadError.message}`)
    }

    // 初期タイトルはファイル名（拡張子抜き）。空になる場合は「プロジェクト名＋種別」の流儀に合わせる
    const fileBase = file.name.replace(/\.[^.]+$/, '').trim()
    const title = (
      fileBase !== '' ? fileBase : `${project.title} ${ILLUSTRATION_KIND_LABEL.reference}`
    ).slice(0, 100)

    const { data: row, error: insertError } = await supabase
      .from('illustrations')
      .insert({
        id: illustrationId,
        project_id: project.id,
        kind: 'reference',
        title,
        // 依頼由来ではないため request は出所の記録のみ。prompt は空（ギャラリーでは非表示）。
        // multipart の filename は任意長になりうるため上限を切って保存する
        request: { source: 'upload', fileName: file.name.slice(0, 255) },
        prompt: '',
        storage_path: storagePath,
      })
      .select('id, project_id, kind, title, prompt, reference_illustration_id, created_at')
      .single()
    if (insertError || !row) {
      // 行のないオブジェクトを残さない（ベストエフォート。失敗してもRLSで本人以外は見えない）
      await supabase.storage.from('illustrations').remove([storagePath])
      throw new AppError('internal', `参照画像の保存に失敗しました: ${insertError?.message}`)
    }

    const { data: signed, error: signError } = await supabase.storage
      .from('illustrations')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
    if (signError || !signed) {
      throw new AppError('internal', `画像URLの発行に失敗しました: ${signError?.message}`)
    }

    const item: IllustrationItem = {
      id: row.id,
      projectId: row.project_id,
      kind: row.kind as StoredIllustrationKind,
      title: row.title,
      prompt: row.prompt,
      referenceIllustrationId: row.reference_illustration_id,
      createdAt: row.created_at,
      signedUrl: signed.signedUrl,
      referencedCount: 0, // アップロード直後を参照するイラストはまだ存在しない
    }
    return { ok: true, data: item }
  } catch (error) {
    return toActionError(error)
  }
}

/** タイトルのインライン編集（空文字不可・重複は許容。SPEC §5.4） */
export async function updateIllustrationTitle(
  illustrationId: string,
  title: string,
): Promise<ActionResult> {
  try {
    const parsedId = uuidSchema.parse(illustrationId)
    const parsedTitle = illustrationTitleSchema.parse(title)
    const supabase = await createClient()

    // RLSが所有確認を担う。0件更新＝存在しないか他人の行
    const { data: updated, error } = await supabase
      .from('illustrations')
      .update({ title: parsedTitle })
      .eq('id', parsedId)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!updated || updated.length === 0) {
      throw new AppError('not_found', 'イラストが見つかりません')
    }
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * イラストの削除（確認ダイアログ＋物理削除。SPEC §2）。
 * Storage実体→行の順で消す。被参照の警告は一覧の referencedCount でクライアントが出す
 */
export async function deleteIllustration(illustrationId: string): Promise<ActionResult> {
  try {
    const parsedId = uuidSchema.parse(illustrationId)
    const supabase = await createClient()

    // RLS越しの取得＝所有確認（storage_path をクライアントから受け取らない）
    const { data: row, error } = await supabase
      .from('illustrations')
      .select('id, storage_path')
      .eq('id', parsedId)
      .maybeSingle()
    if (error) throw new AppError('internal', error.message)
    if (!row) throw new AppError('not_found', 'イラストが見つかりません')

    // 実体の削除に失敗したら行は残す（リトライ可能。行なしオブジェクトの孤児を作らない）
    const { error: removeError } = await supabase.storage
      .from('illustrations')
      .remove([row.storage_path])
    if (removeError) {
      throw new AppError('internal', `画像の削除に失敗しました: ${removeError.message}`)
    }

    const { error: deleteError } = await supabase.from('illustrations').delete().eq('id', row.id)
    if (deleteError) throw new AppError('internal', deleteError.message)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
