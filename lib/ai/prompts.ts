import { ANCHOR_LABEL, EMOTION_LABEL, PART_LABEL, type SceneRecord } from '@/lib/board'
import type { Emotion, SceneAnchor } from '@/lib/schemas/enums'

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
