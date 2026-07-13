'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { normalizeAnchor, toCanonicalOrder, type SceneRecord } from '@/lib/board'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { sceneParts } from '@/lib/schemas/enums'
import { sceneEditSchema, sceneOrderSchema, type SceneEdit, type SceneOrder } from '@/lib/schemas/projects'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()
const partSchema = z.enum(sceneParts)

const SCENE_COLUMNS =
  'id, project_id, part, anchor, order_index, title, content, emotion_start, emotion_end'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** プロジェクトの全シーンを構成順（order_index 昇順）で取得。RLS越し＝所有分のみ */
async function fetchProjectScenes(supabase: Supabase, projectId: string): Promise<SceneRecord[]> {
  const { data, error } = await supabase
    .from('scenes')
    .select(SCENE_COLUMNS)
    .eq('project_id', projectId)
    .order('order_index')
  if (error) throw new AppError('internal', error.message)
  return (data ?? []) as SceneRecord[]
}

/** RLS越しのプロジェクト所有確認（他人・不存在はともに not_found に正規化） */
async function assertProjectOwned(supabase: Supabase, projectId: string): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data) throw new AppError('not_found', 'プロジェクトが見つかりません')
}

/**
 * 変更のあった行だけを1回の upsert で保存する。
 * supabase-js にトランザクションがないため、単一ステートメント＝原子的な一括更新で整合を保つ
 */
async function persistChanges(
  supabase: Supabase,
  before: Map<string, SceneRecord>,
  after: SceneRecord[],
): Promise<void> {
  const changed = after.filter((scene) => {
    const prev = before.get(scene.id)
    if (!prev) return true // 新規行
    return (
      prev.part !== scene.part ||
      prev.anchor !== scene.anchor ||
      prev.order_index !== scene.order_index ||
      prev.title !== scene.title ||
      prev.content !== scene.content ||
      prev.emotion_start !== scene.emotion_start ||
      prev.emotion_end !== scene.emotion_end
    )
  })
  if (changed.length === 0) return
  const { error } = await supabase.from('scenes').upsert(changed)
  if (error) throw new AppError('internal', error.message)
}

function toMap(scenes: SceneRecord[]): Map<string, SceneRecord> {
  return new Map(scenes.map((s) => [s.id, s]))
}

/** シーン作成。レーン末尾（境界アンカースロットの手前）に置き、全体を正準順序で再採番する */
export async function createScene(
  projectId: string,
  part: string,
): Promise<ActionResult<{ scenes: SceneRecord[]; createdId: string }>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const targetPart = partSchema.parse(part)
    const supabase = await createClient()
    await assertProjectOwned(supabase, pid)

    const scenes = await fetchProjectScenes(supabase, pid)
    const created: SceneRecord = {
      id: randomUUID(),
      project_id: pid,
      part: targetPart,
      anchor: null,
      order_index: scenes.length, // 仮値。toCanonicalOrder で確定する
      title: '',
      content: '',
      emotion_start: null,
      emotion_end: null,
    }
    // 配列末尾に足すと、正準順序では該当レーンの通常カード末尾（境界スロット手前）に入る
    const next = toCanonicalOrder([...scenes, created])
    await persistChanges(supabase, toMap(scenes), next)

    revalidatePath(`/projects/${pid}/board`)
    return { ok: true, data: { scenes: next, createdId: created.id } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * シーン更新（編集ダイアログの保存）。アプリロジックの担保（SPEC-beat-board §4）:
 * - part↔anchor の不整合はアンカー解除に正規化（パート変更時の自動解除を含む）
 * - 1転換点1シーン: 同じアンカーを持つ別シーンからはアンカーを外す（同一 upsert で原子化）
 * - パート変更したシーンは移動先レーンの末尾へ。境界アンカーは正準順序がレーン末尾に固定する
 */
export async function updateScene(
  sceneId: string,
  input: SceneEdit,
): Promise<ActionResult<{ scenes: SceneRecord[] }>> {
  try {
    const sid = uuidSchema.parse(sceneId)
    const parsed = sceneEditSchema.parse(input)
    const supabase = await createClient()

    const { data: target, error: targetError } = await supabase
      .from('scenes')
      .select(SCENE_COLUMNS)
      .eq('id', sid)
      .maybeSingle()
    if (targetError) throw new AppError('internal', targetError.message)
    if (!target) throw new AppError('not_found', 'シーンが見つかりません')
    const current = target as SceneRecord

    const scenes = await fetchProjectScenes(supabase, current.project_id)
    const anchor = normalizeAnchor(parsed.anchor, parsed.part)

    let updatedScenes = scenes.map((scene): SceneRecord => {
      if (scene.id === sid) return { ...scene, ...parsed, anchor }
      // 1転換点1シーン: 付け替え時は元のシーンから自動で外す
      if (anchor !== null && scene.anchor === anchor) return { ...scene, anchor: null }
      return scene
    })
    if (parsed.part !== current.part) {
      // レーン移動は移動先レーンの末尾へ（配列末尾に回すと正準順序でレーン末尾になる）
      const moved = updatedScenes.find((s) => s.id === sid)
      if (moved) updatedScenes = [...updatedScenes.filter((s) => s.id !== sid), moved]
    }
    const next = toCanonicalOrder(updatedScenes)
    await persistChanges(supabase, toMap(scenes), next)

    revalidatePath(`/projects/${current.project_id}/board`)
    return { ok: true, data: { scenes: next } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * D&D確定時の並び替え一括保存。クライアントの最終順序（全シーンの id と part）を受け取り、
 * サーバー側で検証・正規化して 0..N-1 に再採番する（1リクエスト=1 upsert）
 */
export async function reorderScenes(
  projectId: string,
  order: SceneOrder,
): Promise<ActionResult<{ scenes: SceneRecord[] }>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const parsed = sceneOrderSchema.parse(order)
    const supabase = await createClient()
    await assertProjectOwned(supabase, pid)

    const scenes = await fetchProjectScenes(supabase, pid)
    const byId = toMap(scenes)

    // id 集合の完全一致（重複や欠落、並び替え中の別経路での増減はやり直してもらう）
    if (
      parsed.length !== scenes.length ||
      new Set(parsed.map((entry) => entry.id)).size !== scenes.length ||
      parsed.some((entry) => !byId.has(entry.id))
    ) {
      throw new AppError('conflict', 'ボードの内容が変わっています。再読み込みしてください')
    }

    const submitted = parsed.map((entry): SceneRecord => {
      const scene = byId.get(entry.id) as SceneRecord
      // レーン間移動で part が変わったピンチ等のアンカーは自動解除（part↔anchor 整合の正規化）
      return { ...scene, part: entry.part, anchor: normalizeAnchor(scene.anchor, entry.part) }
    })
    const next = toCanonicalOrder(submitted)
    await persistChanges(supabase, byId, next)

    revalidatePath(`/projects/${pid}/board`)
    return { ok: true, data: { scenes: next } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * シーン削除（確認ダイアログ後の物理削除）。
 * そのシーンのレビューセッションは履歴ごと道連れにする（target_ref は text 参照で
 * cascade が効かないため明示削除。feedbacks はセッションから cascade）
 */
export async function deleteScene(sceneId: string): Promise<ActionResult> {
  try {
    const sid = uuidSchema.parse(sceneId)
    const supabase = await createClient()

    const { data: target, error: targetError } = await supabase
      .from('scenes')
      .select('id, project_id')
      .eq('id', sid)
      .maybeSingle()
    if (targetError) throw new AppError('internal', targetError.message)
    if (!target) throw new AppError('not_found', 'シーンが見つかりません')

    // 「シーンなきセッション」を残さないため、セッション → シーンの順で消す
    const { error: sessionError } = await supabase
      .from('review_sessions')
      .delete()
      .eq('project_id', target.project_id)
      .eq('target_ref', sid)
    if (sessionError) throw new AppError('internal', sessionError.message)

    const { error: deleteError } = await supabase.from('scenes').delete().eq('id', sid)
    if (deleteError) throw new AppError('internal', deleteError.message)

    revalidatePath(`/projects/${target.project_id}/board`)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
