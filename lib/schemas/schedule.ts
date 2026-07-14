import { z } from 'zod'

/**
 * 執筆スケジュール（SPEC-schedule-and-memo-tools §4.2）。
 * projects.schedule（jsonb・1プロジェクト1本・丸ごと上書き）の構造検証。
 * DB側は器のみ持つため、読み書きの両側で必ずこのスキーマを通す
 */

/** ツール入力に共通のマイルストーン項目（id・done はサーバー側で付与） */
const milestoneInputFields = {
  label: z.string().trim().min(1).max(100),
  dueDate: z.iso.date(),
  /** 目標総文字数（任意。あれば writing_progress の最新値と比較して自動達成判定） */
  targetChars: z.number().int().positive().nullable(),
}

export const milestoneSchema = z.object({
  id: z.uuid(), // サーバー採番（crypto.randomUUID()）
  ...milestoneInputFields,
  /** 手動チェック（上書き保存時は false 初期化） */
  done: z.boolean(),
})

export const scheduleSchema = z.object({
  /** 1日あたり文字数目標（任意） */
  dailyTargetChars: z.number().int().positive().nullable(),
  /** 期日昇順・最大20件 */
  milestones: z.array(milestoneSchema).max(20),
  /**
   * サーバーで付与する最終書き込みISO日時。楽観ロックのリビジョンを兼ねるため、
   * すべての書き込み経路（saveSchedule ツール・toggleMilestone）で必ず更新する
   */
  savedAt: z.iso.datetime(),
})

export type Milestone = z.infer<typeof milestoneSchema>
export type Schedule = z.infer<typeof scheduleSchema>

/** saveSchedule ツールの入力（AI由来。id・done・savedAt は受け取らずサーバーで付与する） */
export const saveScheduleInputSchema = z
  .object({
    dailyTargetChars: milestoneInputFields.targetChars.describe(
      '1日あたりの目標文字数（決めない場合は null）',
    ),
    milestones: z
      .array(z.object(milestoneInputFields))
      .max(20)
      .describe('マイルストーンの一覧（期日 dueDate は YYYY-MM-DD。targetChars は目標総文字数で任意）'),
  })
  .refine((input) => input.dailyTargetChars !== null || input.milestones.length > 0, {
    message: '日次目標かマイルストーンのどちらかは必要です',
  })

export type SaveScheduleInput = z.infer<typeof saveScheduleInputSchema>

/** saveMemoNote ツールの入力 */
export const saveMemoNoteInputSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(10_000)
    .describe('ノートに保存するメモ本文（Markdown。1行目が実質のタイトルになる）'),
})

export type SaveMemoNoteInput = z.infer<typeof saveMemoNoteInputSchema>

/**
 * ツール execute の戻り値の共有契約。
 * サーバー（app/api/chat/route.ts の execute 戻り値注釈）とクライアント
 * （consult-panel.tsx の結果カード）の両方でこれを参照し、二重定義のずれを型で検知する
 */
export type ToolFailureOutput = { ok: false; message: string }
export type SaveMemoNoteOutput = { ok: true; noteId: string; title: string } | ToolFailureOutput
export type SaveScheduleOutput = { ok: true; milestoneCount: number } | ToolFailureOutput

/**
 * マイルストーンの達成表示（SPEC §3）:
 * 手動チェック済み、または目標総文字数があり最新の総文字数が到達していれば達成
 */
export function isMilestoneAchieved(milestone: Milestone, latestTotalChars: number | null): boolean {
  if (milestone.done) return true
  return (
    milestone.targetChars !== null &&
    latestTotalChars !== null &&
    latestTotalChars >= milestone.targetChars
  )
}
