// 縦書きエディタの Server Actions（SPEC-vertical-editor-phase2〜5）。
// 実装は lib/actions/editor/ 配下へ責務別に分割（SPEC-refactoring-step1 段階1・R-2）。
// 既存の呼び出し側の import パスを維持するための再エクスポートファサード。
// 原稿の実体は常にGitHub（読み書きとも Contents API 経由・DBには置かない）

export { getEditorWorkspace } from "./editor/workspace";
export type { EditorWorkspaceData } from "./editor/workspace";

export {
  openChapter,
  saveChapter,
  createChapter,
  getAllChapterContents,
} from "./editor/chapters";
export type { ChapterData } from "./editor/chapters";

export {
  getBookSettings,
  saveBookConfig,
  saveThemeVars,
  saveNombreVars,
  saveOkuzuke,
} from "./editor/book-settings";
export type { ThemeSettings, BookSettingsData } from "./editor/book-settings";

export { uploadImage } from "./editor/assets";

export {
  getBuildTagInfo,
  createBuildTag,
  getBuildStatus,
} from "./editor/build";
export type { BuildKind, BuildTagInfo, BuildStatus } from "./editor/build";

export {
  listEditorBranches,
  createEditorBranch,
  createEditorPullRequest,
} from "./editor/branch";
export type { EditorBranches } from "./editor/branch";

export type { EditorChapter } from "./editor/context";
