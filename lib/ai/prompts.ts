export type NoteContext = {
  title: string
  content: string
  tags: string[]
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
