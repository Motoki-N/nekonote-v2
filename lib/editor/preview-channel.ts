// エディタ本体と分離プレビューウィンドウの通信（Issue #72）。
// 組版済みHTMLを BroadcastChannel（同一オリジンのウィンドウ間通信）で送り、
// 受信側で Blob URL 化して Viewer に読ませる。ウィンドウをまたいだ Blob URL の
// 寿命管理を避けるため、URLではなくHTML文字列を渡す

export type PreviewChannelMessage =
  /** エディタ → プレビュー窓: 組版対象の完成HTML */
  | {
      type: 'document'
      html: string
      /** 全体プレビューか（実ページ数を編集章へ反映してよいかの判定に使う） */
      full: boolean
      /** ウィンドウタイトル用の表示名（章ファイル名 or 全体プレビュー） */
      title: string
    }
  /** エディタ → プレビュー窓: エディタ起動通知。開いたままの窓は ready を返して再接続する */
  | { type: 'hello' }
  /** プレビュー窓 → エディタ: 受信準備完了。現在のHTMLの送信を求める（初回表示・リロード） */
  | { type: 'ready' }
  /** プレビュー窓 → エディタ: 組版完了時の実ページ数 */
  | { type: 'pages'; total: number; full: boolean }
  /** プレビュー窓 → エディタ: ウィンドウが閉じられた */
  | { type: 'closed' }

/** プロジェクトごとに独立したチャンネル名（複数プロジェクト同時編集での混線防止） */
export function previewChannelName(projectId: string): string {
  return `nekonote-editor-preview:${projectId}`
}

/** 分離プレビューウィンドウのURL（プロジェクトレイアウトのヘッダーを継承しない専用ルート） */
export function detachedPreviewUrl(projectId: string): string {
  return `/editor-preview/${projectId}`
}
