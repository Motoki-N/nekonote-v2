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
 * 企画書レビューの system プロンプト。
 * ペルソナの口調（personas.description）＋レビュープロファイルの観点（prompt_template）を組み立てる
 */
export function buildProposalReviewSystemPrompt({
  personaDescription,
  promptTemplate,
}: {
  personaDescription: string
  promptTemplate: string
}): string {
  return [personaDescription, '', promptTemplate].join('\n')
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
  const lines: string[] = [
    '# 企画書',
    `ジャンル: ${proposal.genre || '（未記入）'}`,
    `ターゲット層: ${proposal.targetAudience || '（未記入）'}`,
    '本文:',
    '"""',
    proposal.content || '（まだ何も書かれていない）',
    '"""',
    '',
    '# 紐づけノート（設定資料）',
  ]

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

  if (history.length > 0) {
    lines.push('', '# このセッションの過去レビュー（古い順）')
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
