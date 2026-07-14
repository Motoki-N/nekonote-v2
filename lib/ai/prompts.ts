import { ANCHOR_LABEL, EMOTION_LABEL, PART_LABEL, type SceneRecord } from '@/lib/board'
import type { Emotion, ProjectStatus, SceneAnchor } from '@/lib/schemas/enums'
import { isMilestoneAchieved, type Schedule } from '@/lib/schemas/schedule'

export type NoteContext = {
  title: string
  content: string
  tags: string[]
}

export type ProposalContext = {
  genre: string | null
  targetAudience: string | null
  content: string // 保存済みDB値のMarkdown
}

export type FeedbackHistoryItem = {
  content: string
  userResponse: string | null
}

/**
 * レビュー（企画書・構成・シーン共通）の system プロンプト。
 * ペルソナの口調（personas.description）＋レビュープロファイルの観点（prompt_template）を組み立てる
 */
export function buildReviewSystemPrompt({
  personaDescription,
  promptTemplate,
}: {
  personaDescription: string
  promptTemplate: string
}): string {
  return [personaDescription, '', promptTemplate].join('\n')
}

/** 企画書セクションの整形（企画書・構成・シーンレビューで共用） */
function proposalSection(proposal: ProposalContext): string[] {
  return [
    '# 企画書',
    `ジャンル: ${proposal.genre || '（未記入）'}`,
    `ターゲット層: ${proposal.targetAudience || '（未記入）'}`,
    '本文:',
    '"""',
    proposal.content || '（まだ何も書かれていない）',
    '"""',
  ]
}

/** 同一セッションの過去フィードバック・返答メモの整形（反復の文脈。全レビュー共用） */
function historySection(history: FeedbackHistoryItem[]): string[] {
  if (history.length === 0) return []
  const lines: string[] = ['', '# このセッションの過去レビュー（古い順）']
  history.forEach((item, index) => {
    lines.push(
      `## 第${index + 1}回フィードバック`,
      '"""',
      item.content,
      '"""',
      `作者の返答メモ: ${item.userResponse || '（なし）'}`,
      '',
    )
  })
  lines.push('上記をふまえ、前回の指摘が改善されたかの確認から始めること。')
  return lines
}

function emotionArc(start: Emotion | null, end: Emotion | null): string {
  if (start === null && end === null) return '（未設定）'
  const label = (e: Emotion | null) => (e === null ? '未設定' : EMOTION_LABEL[e])
  return `${label(start)} → ${label(end)}`
}

function anchorLabel(anchor: SceneAnchor | null): string {
  return anchor === null ? '' : `【${ANCHOR_LABEL[anchor]}】`
}

/**
 * 企画書レビューの user 入力（SPEC-proposal-review §3.3）。
 * 企画書（表紙）＋紐づけノート全文（本文）＋同一セッションの過去フィードバック・返答メモ全件
 */
export function buildProposalReviewInput({
  proposal,
  notes,
  history,
}: {
  proposal: ProposalContext
  notes: NoteContext[]
  history: FeedbackHistoryItem[]
}): string {
  const lines: string[] = [...proposalSection(proposal), '', '# 紐づけノート（設定資料）']

  if (notes.length === 0) {
    lines.push('（紐づけノートなし）')
  } else {
    for (const note of notes) {
      lines.push(
        `## ${note.title || '（無題）'}`,
        `タグ: ${note.tags.length > 0 ? note.tags.join('、') : '（なし）'}`,
        '"""',
        note.content || '（本文なし）',
        '"""',
        '',
      )
    }
  }

  lines.push(...historySection(history))
  return lines.join('\n')
}

/**
 * 構成レビューの user 入力（SPEC-beat-board §3.5）。
 * 企画書＋全シーンを構成順に整形（パート・アンカー・タイトル・本文・感情の起点→終点）
 */
export function buildStructureReviewInput({
  proposal,
  scenes,
  history,
}: {
  proposal: ProposalContext
  scenes: SceneRecord[]
  history: FeedbackHistoryItem[]
}): string {
  const lines: string[] = [...proposalSection(proposal), '', '# 構成（4部構成・構成順）']

  if (scenes.length === 0) {
    lines.push('（シーンはまだない）')
  } else {
    scenes.forEach((scene, index) => {
      lines.push(
        `## ${index + 1}. [${PART_LABEL[scene.part]}]${anchorLabel(scene.anchor)} ${scene.title || '（無題）'}`,
        `感情の起伏: ${emotionArc(scene.emotion_start, scene.emotion_end)}`,
        '"""',
        scene.content || '（本文なし）',
        '"""',
        '',
      )
    })
  }

  lines.push(...historySection(history))
  return lines.join('\n')
}

/**
 * シーンレビューの user 入力（SPEC-beat-board §3.5）。
 * 企画書＋対象シーン全文＋前後の流れが分かる全シーンのタイトル・アンカー・感情の一覧
 */
export function buildSceneReviewInput({
  proposal,
  scene,
  scenes,
  history,
}: {
  proposal: ProposalContext
  scene: SceneRecord
  scenes: SceneRecord[]
  history: FeedbackHistoryItem[]
}): string {
  const lines: string[] = [
    ...proposalSection(proposal),
    '',
    '# 対象シーン',
    `パート: ${PART_LABEL[scene.part]}${scene.anchor ? ` ${anchorLabel(scene.anchor)}` : ''}`,
    `タイトル: ${scene.title || '（無題）'}`,
    `感情の起伏: ${emotionArc(scene.emotion_start, scene.emotion_end)}`,
    '本文:',
    '"""',
    scene.content || '（本文なし）',
    '"""',
    '',
    '# 全シーン一覧（構成順。→ が対象シーン）',
  ]

  scenes.forEach((item, index) => {
    const marker = item.id === scene.id ? '→ ' : ''
    lines.push(
      `${index + 1}. ${marker}[${PART_LABEL[item.part]}]${anchorLabel(item.anchor)} ${item.title || '（無題）'}（感情: ${emotionArc(item.emotion_start, item.emotion_end)}）`,
    )
  })

  lines.push(...historySection(history))
  return lines.join('\n')
}

/** 講評の入力に含める企画書情報の範囲（ペルソナの reference_scope から決まる） */
export type CritiqueProposalScope = 'none' | 'target_only' | 'full'

/**
 * 講評（作品全体）の user 入力（SPEC-dashboard-critique-settings §3.3）。
 * base_path 配下の全原稿ファイルをパス辞書順に見出し付きで結合する。
 * 企画書情報はペルソナの reference_scope で出し分ける:
 * manuscript_only = none / manuscript_plus_target = target_only / all = full
 */
export function buildManuscriptCritiqueInput({
  files,
  proposalScope,
  proposal,
}: {
  /** path は表示用の相対パス */
  files: { path: string; content: string }[]
  proposalScope: CritiqueProposalScope
  proposal: ProposalContext | null
}): string {
  const lines: string[] = []

  if (proposalScope === 'full' && proposal) {
    lines.push(...proposalSection(proposal), '')
  } else if (proposalScope === 'target_only' && proposal) {
    lines.push(
      '# 企画情報',
      `ジャンル: ${proposal.genre || '（未記入）'}`,
      `ターゲット層: ${proposal.targetAudience || '（未記入）'}`,
      '',
    )
  }

  lines.push('# 原稿（作品全体・構成順）')
  for (const file of files) {
    lines.push(`## ${file.path}`, '"""', file.content, '"""', '')
  }

  return lines.join('\n')
}

/** 増分の実測値。記録が疎な場合に備え、ペース計算は固定の7/30日でなく実スパンで行う */
export type ProgressDelta = {
  chars: number
  /** 基準の記録→最新の記録の実日数 */
  days: number
}

/** スケジュールコンテキスト（サーバー集計。SPEC-conversational-personas §5.2） */
export type ScheduleContext = {
  projectTitle: string
  status: ProjectStatus
  eventName: string | null
  deadline: string | null
  /** 締切までの残日数（JST基準。締切なしは null。負数=超過） */
  daysRemaining: number | null
  targetPages: number | null
  latest: { date: string; totalChars: number } | null
  /** 直近N日境界を跨いだ増分（基準になる過去の記録がなければ null） */
  delta7: ProgressDelta | null
  delta30: ProgressDelta | null
  /** 保存済みの執筆スケジュール（SPEC-schedule-and-memo-tools §5.5。未保存・不正データは null） */
  savedSchedule: Schedule | null
}

// プロンプト内で使うプロジェクトステータスの日本語ラベル
// （components/projects/status-badges.tsx はクライアント用のため持ち込まない）
const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: '企画中',
  writing: '執筆中',
  editing: '推敲中',
  completed: '完成',
}

function deltaLine(label: string, delta: ProgressDelta | null): string {
  if (delta === null) return `${label}: （比較できる過去の記録なし）`
  const sign = delta.chars >= 0 ? '+' : ''
  const pace = Math.round(delta.chars / delta.days).toLocaleString('ja-JP')
  return `${label}: ${sign}${delta.chars.toLocaleString('ja-JP')}字（実際の記録間隔${delta.days}日・約${pace}字/日）`
}

/** 保存済みスケジュールのプロンプト整形（SPEC-schedule-and-memo-tools §5.5） */
function savedScheduleLines(schedule: Schedule | null, latestTotalChars: number | null): string[] {
  const lines = ['', '# 保存済みの執筆スケジュール']
  if (!schedule) {
    lines.push('（未保存）')
    return lines
  }
  lines.push(
    `1日あたり目標: ${schedule.dailyTargetChars !== null ? `${schedule.dailyTargetChars.toLocaleString('ja-JP')}字` : '（未設定）'}`,
  )
  if (schedule.milestones.length === 0) {
    lines.push('マイルストーン: （なし）')
  } else {
    lines.push('マイルストーン:')
    for (const milestone of schedule.milestones) {
      const target =
        milestone.targetChars !== null
          ? `目標${milestone.targetChars.toLocaleString('ja-JP')}字`
          : '目標字数なし'
      const achieved = isMilestoneAchieved(milestone, latestTotalChars) ? '達成済み' : '未達成'
      lines.push(`- ${milestone.dueDate}までに「${milestone.label}」（${target}・${achieved}）`)
    }
  }
  return lines
}

/**
 * ダッシュボード相談の system プロンプト（SPEC-conversational-personas §5.2）。
 * ペルソナの口調（personas.description）＋共通の役割指示＋スケジュールブロック（あれば）
 */
export function buildDashboardChatPrompt({
  personaDescription,
  schedule,
}: {
  personaDescription: string
  schedule?: ScheduleContext | null
}): string {
  const lines: string[] = [
    personaDescription,
    '',
    '# 今回の仕事: 執筆の相談相手',
    '作者（ユーザー）との会話の場。執筆にまつわる相談ごとに付き合う。',
    '- 日本語で応答する',
    '- 応答は簡潔に（目安200〜400字）。モバイルでも読める分量にする',
    '- 地の文と箇条書きのみで書き、見出しは使わない',
    '',
    '# ツールの使い方（SPEC-schedule-and-memo-tools §5.1）',
    '- ツールは作者が「確定して」「保存して」「メモにまとめて」のように保存を明確に頼んだときだけ使う。勝手に保存しない',
    '- 「提案して」「考えて」「相談したい」は提案止まり。まずテキストで提案を示し、作者の確定の言葉を待つ',
    '- saveMemoNote はメモ化を頼まれたときだけ使う。スケジュールの確定を頼まれたのに saveSchedule ツールが使えない状況（対象プロジェクト未選択など）では、代わりにメモ保存せず、対象プロジェクトを選んでもらうよう促す',
    '- 保存に成功したら、必ず短い締めの文で保存した内容を要約して返す',
    '- 保存に失敗したら、失敗したことと理由を正直に伝える',
  ]

  if (schedule) {
    lines.push(
      '',
      '# 対象プロジェクトの進捗データ（サーバー集計の実データ・現在値）',
      `プロジェクト: ${schedule.projectTitle}（${STATUS_LABEL[schedule.status]}）`,
      `イベント: ${schedule.eventName || '（未設定）'}`,
      schedule.deadline === null
        ? '締切: （未設定）'
        : `締切: ${schedule.deadline}（${
            schedule.daysRemaining !== null && schedule.daysRemaining < 0
              ? `${-schedule.daysRemaining}日超過`
              : `残り${schedule.daysRemaining}日`
          }）`,
      `目標ページ数: ${schedule.targetPages !== null ? `${schedule.targetPages}ページ` : '（未設定）'}`,
      schedule.latest === null
        ? '総文字数: （まだ記録がない）'
        : `最新の総文字数: ${schedule.latest.totalChars.toLocaleString('ja-JP')}字（${schedule.latest.date}時点）`,
      deltaLine('直近7日境界からの増分', schedule.delta7),
      deltaLine('直近30日境界からの増分', schedule.delta30),
      ...savedScheduleLines(schedule.savedSchedule, schedule.latest?.totalChars ?? null),
      '',
      'スケジュールやペース配分の相談には、上記の実データ（残日数・現在ペース・残り目標）を使って具体的な数字で助言すること。データが欠けている項目は正直に「記録がない」と伝え、推測で数字を作らない。',
      'スケジュール提案はマイルストーン（期日・目標）と1日あたり文字数で具体的に示し、作者が確定を求めたら saveSchedule ツールで保存する（保存済みスケジュールがある場合は丸ごと上書きされる）。',
    )
  }

  return lines.join('\n')
}

/**
 * 掘り下げ支援の system プロンプト。
 * ペルソナの口調（personas.description）＋役割指示＋対象ノートのコンテキストを組み立てる
 */
export function buildDeepDivePrompt({
  personaDescription,
  note,
}: {
  personaDescription: string
  note: NoteContext
}): string {
  return [
    personaDescription,
    '',
    '# 今回の仕事: ネタの掘り下げ支援',
    '作者が書き留めたノート（下記）の内容を膨らませる手伝いをする。',
    '- 相手の発言やノートの要点を短く受け止めたうえで、発想が広がる深掘り質問を1〜2個返す',
    '- 答えや設定を勝手に確定させない。決めるのは作者',
    '- 応答は簡潔に（目安200〜400字）。地の文と箇条書きのみで書き、見出しは使わない',
    '- ノート本文をそのまま長く引用しない',
    '',
    '# 対象ノート',
    `タイトル: ${note.title || '（無題）'}`,
    `タグ: ${note.tags.length > 0 ? note.tags.join('、') : '（なし）'}`,
    '本文:',
    '"""',
    note.content || '（まだ何も書かれていない）',
    '"""',
  ].join('\n')
}
