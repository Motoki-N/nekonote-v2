// 縦書きエディタの共有型（SPEC-refactoring-step1 段階4 で vertical-editor.tsx から分離）。
// 本体コンポーネントと hooks/ 配下が共有する

/** 開いている章の書き込み基準。打鍵ごとに触るため state ではなく ref で持つ */
export type CurrentChapter = {
  path: string;
  /** 楽観ロックの基準 blob SHA（保存成功・マージ取り込みで前進） */
  baseSha: string;
  /** 基準SHA時点のリモート本文（未保存判定・待避クリーンアップ用） */
  remoteContent: string;
};

export type MergeState = {
  remoteContent: string;
  remoteSha: string;
  localContent: string;
};
