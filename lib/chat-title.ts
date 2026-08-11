/**
 * チャット本文の最初の非空行からタイトルを作る（先頭のMarkdown記号を除去して最大50字）。
 * ノート保存時のタイトル（lib/actions/chat.ts）とスレッドの自動タイトル
 * （app/api/chat/route.ts）で共用する（SPEC-chat-thread-list §5.2）
 */
export function chatTitleFrom(content: string): string {
  const firstLine =
    content.split("\n").find((line) => line.trim() !== "") ?? "";
  return firstLine
    .replace(/^[#>\-*+\s]+/, "")
    .trim()
    .slice(0, 50);
}
