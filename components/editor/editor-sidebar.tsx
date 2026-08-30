"use client";

import { FilePlus2, FileText, Trash2 } from "lucide-react";

import type { EditorChapter } from "@/lib/actions/editor";
import type { LinkedScene } from "@/lib/board";
import type { ManuscriptComment } from "@/lib/editor/comments";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LinkedSceneList } from "@/components/board/linked-scene-list";
import { BranchMenu } from "@/components/editor/branch-menu";

/**
 * 章一覧サイドバー（SPEC-vertical-editor-phase2 §3.3・phase3 §3・phase5 §3.1）。
 * ブランチセレクタ・章一覧／コメント一覧の切替タブを含む。
 * 状態はすべて親（VerticalEditor）が持ち、本コンポーネントは表示と発火のみ
 */
export function EditorSidebar({
  projectId,
  branch,
  defaultBranch,
  branchSwitching,
  selectedPath,
  chapters,
  draftPaths,
  dirty,
  comments,
  sidebarTab,
  onSidebarTabChange,
  onSwitchBranch,
  onCreateBranchRequest,
  onPrRequest,
  onSelectChapter,
  onNewChapter,
  onJumpToComment,
  onDeleteComment,
  fileName,
  linkedScenes,
}: {
  projectId: string;
  branch: string;
  defaultBranch: string;
  branchSwitching: boolean;
  selectedPath: string | null;
  chapters: EditorChapter[];
  draftPaths: ReadonlySet<string>;
  dirty: boolean;
  comments: ManuscriptComment[];
  sidebarTab: "chapters" | "comments";
  onSidebarTabChange: (tab: "chapters" | "comments") => void;
  onSwitchBranch: (name: string) => void;
  onCreateBranchRequest: () => void;
  onPrRequest: () => void;
  onSelectChapter: (path: string) => void;
  onNewChapter: () => void;
  onJumpToComment: (comment: ManuscriptComment) => void;
  onDeleteComment: (comment: ManuscriptComment) => void;
  fileName: (path: string) => string;
  /** 開いているファイルに紐づくシーン／章（逆引き。SPEC-manuscript-bridge §4.4） */
  linkedScenes: LinkedScene[];
}) {
  return (
    <nav
      aria-label="章一覧"
      className={cn(
        "flex w-full shrink-0 flex-col overflow-y-auto border-border p-2 lg:flex lg:w-60 lg:border-r",
        selectedPath !== null && "hidden",
      )}
    >
      {/* ブランチセレクタ（SPEC-phase5 §3.1。切替・作成・PRの入口） */}
      <div className="mb-1.5">
        <BranchMenu
          projectId={projectId}
          branch={branch}
          defaultBranch={defaultBranch}
          switching={branchSwitching}
          onSwitch={onSwitchBranch}
          onCreateRequest={onCreateBranchRequest}
          onPrRequest={onPrRequest}
        />
      </div>
      {/* 章一覧／コメント一覧の切替タブ（SPEC-phase3 §3。コメントは章を開いているときのみ） */}
      {selectedPath !== null && (
        <div className="mb-1.5 grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
          {(
            [
              { key: "chapters", label: "章" },
              {
                key: "comments",
                label: `コメント${comments.length > 0 ? ` ${comments.length}` : ""}`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={sidebarTab === tab.key}
              onClick={() => onSidebarTabChange(tab.key)}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                sidebarTab === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {sidebarTab === "comments" && selectedPath !== null ? (
        comments.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            この章にコメントはありません（Cmd/Ctrl+/ で挿入できます）
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="コメント一覧">
            {comments.map((comment) => (
              <li
                key={`${comment.from}:${comment.to}`}
                className="flex items-start gap-0.5"
              >
                <button
                  type="button"
                  onClick={() => onJumpToComment(comment)}
                  className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary/50"
                >
                  <span className="shrink-0 pt-px text-[10px] tabular-nums leading-4 text-muted-foreground">
                    L{comment.line}
                  </span>
                  <span className="min-w-0 break-all">{comment.summary}</span>
                </button>
                {/* 消化済みコメントのワンタッチ削除（Issue #19。Cmd/Ctrl+Z で取り消せる） */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`L${comment.line} のコメントを削除`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onDeleteComment(comment)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-xs text-muted-foreground">
              全{chapters.length}章
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="新しい章ファイルを作成"
              className="text-muted-foreground"
              onClick={onNewChapter}
            >
              <FilePlus2 />
            </Button>
          </div>
          {chapters.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              manuscripts/ 配下に章ファイル（.md）が見つかりません
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {chapters.map((chapter) => (
                <li key={chapter.path}>
                  <button
                    type="button"
                    // ブランチ切替中は無効化（切替前後の内容取り違え防止。SPEC-phase5 §3.1）
                    disabled={branchSwitching}
                    onClick={() => onSelectChapter(chapter.path)}
                    aria-current={
                      selectedPath === chapter.path ? "true" : undefined
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      selectedPath === chapter.path
                        ? "bg-secondary text-secondary-foreground"
                        : "text-foreground hover:bg-secondary/50",
                    )}
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-all">
                      {fileName(chapter.path)}
                    </span>
                    {(draftPaths.has(chapter.path) ||
                      (chapter.path === selectedPath && dirty)) && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-primary"
                        title="未保存の待避があります"
                      />
                    )}
                    {!chapter.inEntry && (
                      <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
                        entry未登録
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* 逆引き（原稿 → シーン。SPEC-manuscript-bridge §4.4）。
              ファイルを開いているときだけ、その原稿の構成メモを読めるようにする */}
          {selectedPath !== null && linkedScenes.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <LinkedSceneList projectId={projectId} scenes={linkedScenes} />
            </div>
          )}
        </>
      )}
    </nav>
  );
}
