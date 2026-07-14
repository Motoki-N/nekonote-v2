'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { AppError, toActionError } from '@/lib/errors'
import type { ActionResult } from '@/lib/errors'
import { scheduleSchema } from '@/lib/schemas/schedule'
import { createClient } from '@/lib/supabase/server'

const uuidSchema = z.uuid()

/** 不正なidは validation として返す（parse の throw だと internal に化けるため） */
function parseUuid(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new AppError('validation', `${label}が不正です`)
  return parsed.data
}

/**
 * マイルストーンの手動チェックを切り替える（SPEC-schedule-and-memo-tools §5.4）。
 * RLS 越しの取得・更新＝他人の projectId は 0件で not_found（所有境界）
 */
export async function toggleMilestone(
  projectId: string,
  milestoneId: string,
  done: boolean,
): Promise<ActionResult> {
  try {
    const id = parseUuid(projectId, 'プロジェクトid')
    const targetId = parseUuid(milestoneId, 'マイルストーンid')
    const supabase = await createClient()

    const { data: project, error: selectError } = await supabase
      .from('projects')
      .select('schedule')
      .eq('id', id)
      .maybeSingle()
    if (selectError) throw new AppError('internal', selectError.message)
    if (!project) throw new AppError('not_found', 'プロジェクトが見つかりません')

    // jsonb は器のみ＝読み出し時に必ずスキーマを通す（不正データは validation）
    const parsed = scheduleSchema.safeParse(project.schedule)
    if (!parsed.success) throw new AppError('validation', 'スケジュールが保存されていません')
    if (!parsed.data.milestones.some((milestone) => milestone.id === targetId)) {
      throw new AppError('not_found', 'マイルストーンが見つかりません')
    }

    const schedule = {
      ...parsed.data,
      milestones: parsed.data.milestones.map((milestone) =>
        milestone.id === targetId ? { ...milestone, done: Boolean(done) } : milestone,
      ),
    }
    // savedAt の楽観比較: select→update の間にチャット確定（上書き保存）が走った場合に
    // 古い schedule で巻き戻さない（0件更新 = 別の保存が先行 → conflict）
    const { data: updated, error: updateError } = await supabase
      .from('projects')
      .update({ schedule })
      .eq('id', id)
      .eq('schedule->>savedAt', parsed.data.savedAt)
      .select('id')
    if (updateError) throw new AppError('internal', updateError.message)
    if (!updated || updated.length === 0) {
      throw new AppError('conflict', 'スケジュールが更新されています。画面を再読み込みしてください')
    }

    revalidatePath('/')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * スケジュールの削除（概況カードの確認ダイアログから。SPEC §5.4）。
 * schedule = null に更新する。RLS 越し＝他人の projectId は 0件で not_found
 */
export async function deleteSchedule(projectId: string): Promise<ActionResult> {
  try {
    const id = parseUuid(projectId, 'プロジェクトid')
    const supabase = await createClient()

    const { data: updated, error } = await supabase
      .from('projects')
      .update({ schedule: null })
      .eq('id', id)
      .select('id')
    if (error) throw new AppError('internal', error.message)
    if (!updated || updated.length === 0) {
      throw new AppError('not_found', 'プロジェクトが見つかりません')
    }

    revalidatePath('/')
    return { ok: true }
  } catch (error) {
    return toActionError(error)
  }
}
