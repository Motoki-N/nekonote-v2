'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import type { LinkedNote } from '@/lib/actions/projects'
import {
  findTurningPointOrderViolation,
  normalizeAnchor,
  SCENE_CONTENT_TEMPLATE,
  toCanonicalOrder,
  turningPointOrderMessage,
  type SceneRecord,
} from '@/lib/board'
import { BOARD_TEMPLATES } from '@/lib/board-templates'
import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { OUTLINE_TEMPLATE, outlineTemplateKeys } from '@/lib/constants/outline-template'
import {
  CHAPTER_PART,
  scenePartsAll,
  structureTemplates,
  type ScenePartAll,
  type StructureTemplate,
} from '@/lib/schemas/enums'
import { sceneEditSchema, sceneOrderSchema, type SceneEdit, type SceneOrder } from '@/lib/schemas/projects'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()
const partSchema = z.enum(scenePartsAll)
const outlineTemplateKeySchema = z.enum(outlineTemplateKeys)
const structureTemplateSchema = z.enum(structureTemplates)

const SCENE_COLUMNS =
  'id, project_id, part, anchor, order_index, title, content, emotion_start, emotion_end, status, manuscript_path'

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

/** RLS越しのプロジェクト所有確認（他人・不存在はともに not_found に正規化）。
 * 検証に使う構成テンプレートも返す（Issue #54） */
async function getOwnedProject(
  supabase: Supabase,
  projectId: string,
): Promise<{ structureTemplate: StructureTemplate }> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, structure_template')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data) throw new AppError('not_found', 'プロジェクトが見つかりません')
  return { structureTemplate: data.structure_template as StructureTemplate }
}

/** part が「章」またはプロジェクトの現テンプレートのレーンであることの担保
 * （DB CHECK は全テンプレートの和集合のため、テンプレート整合はここで守る。SPEC-structure-templates §4） */
function assertPartInTemplate(part: ScenePartAll, template: StructureTemplate): void {
  if (part === CHAPTER_PART) return
  if (BOARD_TEMPLATES[template].lanes.some((lane) => lane.id === part)) return
  throw new AppError(
    'validation',
    'レーンが現在の構成テンプレートと一致しません。再読み込みしてください',
  )
}

/** レーン内の転換点の並び順制約の担保（SPEC-structure-templates §5。scenes は正準順序で渡す） */
function assertTurningPointOrder(scenes: SceneRecord[], template: StructureTemplate): void {
  const violation = findTurningPointOrderViolation(scenes, template)
  if (violation) throw new AppError('validation', turningPointOrderMessage(violation))
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
      prev.emotion_end !== scene.emotion_end ||
      prev.manuscript_path !== scene.manuscript_path
    )
  })
  if (changed.length === 0) return
  // status はシーン系アクションの管理外（approveBoardReview だけが更新する）。取得時点の値を
  // 書き戻して承認を巻き戻さないよう upsert ペイロードから除外する（新規行は default 'draft'）
  const payload = changed.map((scene) => ({
    id: scene.id,
    project_id: scene.project_id,
    part: scene.part,
    anchor: scene.anchor,
    order_index: scene.order_index,
    title: scene.title,
    content: scene.content,
    emotion_start: scene.emotion_start,
    emotion_end: scene.emotion_end,
    manuscript_path: scene.manuscript_path,
  }))
  const { error } = await supabase.from('scenes').upsert(payload)
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
    const { structureTemplate } = await getOwnedProject(supabase, pid)
    assertPartInTemplate(targetPart, structureTemplate)

    const scenes = await fetchProjectScenes(supabase, pid)
    const created: SceneRecord = {
      id: randomUUID(),
      project_id: pid,
      part: targetPart,
      anchor: null,
      order_index: scenes.length, // 仮値。toCanonicalOrder で確定する
      title: '',
      // 小説シーンは4観点テンプレを初期値として残す（Issue #155。章カードは対象外）
      content: targetPart === CHAPTER_PART ? '' : SCENE_CONTENT_TEMPLATE,
      emotion_start: null,
      emotion_end: null,
      status: 'draft',
      manuscript_path: null,
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
 * シーン複製（Issue #154）。元シーンの直後に複製を挿入する。
 * タイトル・本文・パート・感情はコピーし、転換点マーク（1転換点1シーンの規則）・
 * 承認ステータス・原稿/ノート紐づけ・レビュー履歴は引き継がない
 */
export async function duplicateScene(
  sceneId: string,
): Promise<ActionResult<{ scenes: SceneRecord[]; createdId: string }>> {
  try {
    const sid = uuidSchema.parse(sceneId)
    const supabase = await createClient()

    const { data: target, error: targetError } = await supabase
      .from('scenes')
      .select(SCENE_COLUMNS)
      .eq('id', sid)
      .maybeSingle()
    if (targetError) throw new AppError('internal', targetError.message)
    if (!target) throw new AppError('not_found', 'シーンが見つかりません')
    const source = target as SceneRecord

    const scenes = await fetchProjectScenes(supabase, source.project_id)
    const created: SceneRecord = {
      id: randomUUID(),
      project_id: source.project_id,
      part: source.part,
      anchor: null,
      order_index: 0, // 仮値。toCanonicalOrder で確定する
      // sceneEditSchema の max(200) を超えると複製後に保存できなくなるため付加後に切り詰める
      title: source.title === '' ? '' : `${source.title}のコピー`.slice(0, 200),
      content: source.content,
      emotion_start: source.emotion_start,
      emotion_end: source.emotion_end,
      status: 'draft',
      manuscript_path: null,
    }
    // 元シーンの直後に挿入。元が境界アンカー付き（レーン末尾固定）でも、複製にアンカーは
    // ないため正準順序で境界スロットの手前に収まる
    const index = scenes.findIndex((s) => s.id === sid)
    const next = toCanonicalOrder([
      ...scenes.slice(0, index + 1),
      created,
      ...scenes.slice(index + 1),
    ])
    await persistChanges(supabase, toMap(scenes), next)

    revalidatePath(`/projects/${source.project_id}/board`)
    return { ok: true, data: { scenes: next, createdId: created.id } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 定番構成テンプレの一括追加（Issue #96・SPEC-outline-board §3.4）。
 * 章カード（part='chapter'）N 枚を章レーン末尾に1回の upsert で追加する（原子的）
 */
export async function applyOutlineTemplate(
  projectId: string,
  templateKey: string,
): Promise<ActionResult<{ scenes: SceneRecord[] }>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const key = outlineTemplateKeySchema.parse(templateKey)
    const supabase = await createClient()
    await getOwnedProject(supabase, pid)

    const scenes = await fetchProjectScenes(supabase, pid)
    const created: SceneRecord[] = OUTLINE_TEMPLATE[key].chapters.map((title, index) => ({
      id: randomUUID(),
      project_id: pid,
      part: 'chapter',
      anchor: null,
      order_index: scenes.length + index, // 仮値。toCanonicalOrder で確定する
      title,
      content: '',
      emotion_start: null,
      emotion_end: null,
      status: 'draft',
      manuscript_path: null,
    }))
    const next = toCanonicalOrder([...scenes, ...created])
    await persistChanges(supabase, toMap(scenes), next)

    revalidatePath(`/projects/${pid}/board`)
    return { ok: true, data: { scenes: next } }
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

    const { structureTemplate } = await getOwnedProject(supabase, current.project_id)
    assertPartInTemplate(parsed.part, structureTemplate)

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
    // アンカー付与・付け替えが転換点の並び順制約に違反しないか（SPEC-structure-templates §5）
    assertTurningPointOrder(next, structureTemplate)
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
    const { structureTemplate } = await getOwnedProject(supabase, pid)
    for (const entry of parsed) assertPartInTemplate(entry.part, structureTemplate)

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
    // 転換点の並び順制約（SPEC-structure-templates §5。クライアントの事前検証をすり抜けた場合の砦）
    assertTurningPointOrder(next, structureTemplate)
    await persistChanges(supabase, byId, next)

    revalidatePath(`/projects/${pid}/board`)
    return { ok: true, data: { scenes: next } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * 構成テンプレートの切替（Issue #54・SPEC-structure-templates §2）。
 * 全小説シーンを新テンプレートの先頭レーンへ集約し、転換点マークを全解除する
 * （タイトル・本文・感情・ノート紐づけ・シーン承認状態は保全。章カードは対象外）。
 * 構成の承認状態はリセットする（構成が丸ごと変わるため）。
 * supabase-js にトランザクションがないため scenes → projects の2文で更新する。
 * scenes 側を先に更新することで、途中失敗しても再実行すれば整合が回復する
 */
export async function switchStructureTemplate(
  projectId: string,
  template: string,
): Promise<ActionResult<{ scenes: SceneRecord[] }>> {
  try {
    const pid = uuidSchema.parse(projectId)
    const nextTemplate = structureTemplateSchema.parse(template)
    const supabase = await createClient()
    const { structureTemplate } = await getOwnedProject(supabase, pid)

    const scenes = await fetchProjectScenes(supabase, pid)
    if (nextTemplate === structureTemplate) {
      return { ok: true, data: { scenes } }
    }

    const firstLane = BOARD_TEMPLATES[nextTemplate].lanes[0].id
    const moved = scenes.map(
      (scene): SceneRecord =>
        scene.part === CHAPTER_PART ? scene : { ...scene, part: firstLane, anchor: null },
    )
    const next = toCanonicalOrder(moved)
    await persistChanges(supabase, toMap(scenes), next)

    const { error } = await supabase
      .from('projects')
      .update({ structure_template: nextTemplate, structure_status: 'draft' })
      .eq('id', pid)
    if (error) throw new AppError('internal', error.message)

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

/** RLS越しのシーン取得（revalidate 用の project_id 確認を兼ねる。他人・不存在は not_found） */
async function fetchSceneRef(
  supabase: Supabase,
  sceneId: string,
): Promise<{ id: string; project_id: string }> {
  const { data, error } = await supabase
    .from('scenes')
    .select('id, project_id')
    .eq('id', sceneId)
    .maybeSingle()
  if (error) throw new AppError('internal', error.message)
  if (!data) throw new AppError('not_found', 'シーンが見つかりません')
  return data
}

/** シーンにノートを紐づける（Issue #56。attachProposalNote と同型。紐づけ済みなら成功扱い） */
export async function attachSceneNote(
  sceneId: string,
  noteId: string,
): Promise<ActionResult<LinkedNote>> {
  try {
    const sid = uuidSchema.parse(sceneId)
    const nid = uuidSchema.parse(noteId)
    const supabase = await createClient()

    const scene = await fetchSceneRef(supabase, sid)

    // RLS越しで所有確認（他人・実在しない・ごみ箱中のノートは not_found に正規化する）
    const { data: note, error: noteError } = await supabase
      .from('notes')
      .select('id, title')
      .eq('id', nid)
      .is('deleted_at', null)
      .maybeSingle()
    if (noteError) throw new AppError('internal', noteError.message)
    if (!note) throw new AppError('not_found', 'ノートが見つかりません')

    const { error } = await supabase
      .from('scene_notes')
      .upsert({ scene_id: sid, note_id: nid }, { ignoreDuplicates: true })
    if (error) throw new AppError('internal', error.message)

    revalidatePath(`/projects/${scene.project_id}/board`)
    return { ok: true, data: note }
  } catch (error) {
    return toActionError(error)
  }
}

/** シーンからノートの紐づけを解除する（Issue #56） */
export async function detachSceneNote(sceneId: string, noteId: string): Promise<ActionResult> {
  try {
    const sid = uuidSchema.parse(sceneId)
    const nid = uuidSchema.parse(noteId)
    const supabase = await createClient()

    const scene = await fetchSceneRef(supabase, sid)

    const { error } = await supabase
      .from('scene_notes')
      .delete()
      .eq('scene_id', sid)
      .eq('note_id', nid)
    if (error) throw new AppError('internal', error.message)

    revalidatePath(`/projects/${scene.project_id}/board`)
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
