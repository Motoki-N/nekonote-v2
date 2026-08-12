"use client";

import Link from "next/link";
import {
  BookOpen,
  BookOpenText,
  ExternalLink,
  FileDown,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelRight,
  PictureInPicture2,
  Save,
  Settings,
  SpellCheck,
} from "lucide-react";

import { estimatePages } from "@/lib/editor/word-count";
import type { KumiSettings } from "@/lib/editor/word-count";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * エディタ上部のクローム（SPEC-vertical-editor-phase2 §3）。
 * 集中モード中のフローティング操作＋通常時のツールバー行。
 * 状態はすべて親（VerticalEditor）が持ち、本コンポーネントは表示と発火のみ
 */
export function EditorTopBar({
  focusMode,
  sidebarOpen,
  selectedName,
  selectedPath,
  dirty,
  saving,
  merging,
  chapterLoading,
  charCount,
  actualPages,
  kumi,
  chaptersCount,
  projectId,
  fullPreviewLoading,
  detached,
  previewOpen,
  onToggleSidebar,
  onRequestSave,
  onOpenProofread,
  onOpenCritique,
  onOpenSettings,
  onExportAozora,
  onOpenBuild,
  onStartFullPreview,
  onToggleDetached,
  onTogglePreview,
  onEnterFocus,
  onExitFocus,
}: {
  focusMode: boolean;
  sidebarOpen: boolean;
  selectedName: string | null;
  selectedPath: string | null;
  dirty: boolean;
  saving: boolean;
  /** マージ支援中（保存・校正を無効化） */
  merging: boolean;
  chapterLoading: boolean;
  charCount: number | null;
  actualPages: number | null;
  kumi: KumiSettings | null;
  chaptersCount: number;
  projectId: string;
  fullPreviewLoading: boolean;
  detached: boolean;
  previewOpen: boolean;
  onToggleSidebar: () => void;
  onRequestSave: () => void;
  onOpenProofread: () => void;
  onOpenCritique: () => void;
  onOpenSettings: () => void;
  onExportAozora: () => void;
  onOpenBuild: () => void;
  onStartFullPreview: () => void;
  onToggleDetached: () => void;
  onTogglePreview: () => void;
  onEnterFocus: () => void;
  onExitFocus: () => void;
}) {
  return (
    <>
      {/* 集中モード中のフローティング操作（半透明。Escでも解除できる） */}
      {focusMode && (
        <div className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded-md border border-border bg-background/80 p-1 shadow-sm backdrop-blur">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedPath || saving || merging}
              onClick={onRequestSave}
            >
              <Save data-icon="inline-start" />
              保存
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="集中モードを終了（Esc）"
            title="集中モードを終了（Esc）"
            className="text-muted-foreground"
            onClick={onExitFocus}
          >
            <Minimize2 />
          </Button>
        </div>
      )}
      {/* エディタツールバー */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5",
          focusMode && "hidden",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={sidebarOpen ? "章一覧を隠す" : "章一覧を表示"}
          className="text-muted-foreground"
          onClick={onToggleSidebar}
        >
          <PanelLeft />
        </Button>
        {selectedName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="min-w-0 break-all">{selectedName}</span>
            {dirty && (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                role="status"
                aria-label="未保存の編集があります"
                title="未保存の編集があります"
              />
            )}
            {charCount !== null && (
              <span
                className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground"
                title={
                  actualPages !== null
                    ? "ページ数はプレビューの組版結果（実測）です"
                    : "ページ数は版面（行数×字詰め）からの概算です。プレビュー完了で実測値に置き換わります"
                }
              >
                {charCount.toLocaleString("ja-JP")}字・
                {actualPages !== null
                  ? `${actualPages}ページ`
                  : `約${estimatePages(charCount, kumi)}ページ`}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            章を選んで執筆をはじめてください（保存するとコミットされます）
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* エディタ内から校正・講評を直接起動（Issue #18。校正は開いている章が対象） */}
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedPath || chapterLoading || merging}
            onClick={onOpenProofread}
          >
            <SpellCheck data-icon="inline-start" />
            校正
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={chaptersCount === 0}
            onClick={onOpenCritique}
          >
            <BookOpenText data-icon="inline-start" />
            講評
          </Button>
          {/* 原稿タブ（校正・講評）への相互リンク（編集中の章を開いたまま遷移。SPEC-phase4 §3.1） */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="原稿レビュー画面をひらく"
            title="原稿レビュー画面をひらく（編集中の章を開いたまま遷移）"
            className="text-muted-foreground"
            nativeButton={false}
            render={
              <Link
                href={`/projects/${projectId}/manuscript${
                  selectedPath
                    ? `?file=${encodeURIComponent(selectedPath)}`
                    : ""
                }`}
              >
                <ExternalLink />
              </Link>
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="書籍設定"
            title="書籍設定（書誌・章構成・組み設定・奥付）"
            className="text-muted-foreground"
            onClick={onOpenSettings}
          >
            <Settings />
          </Button>
          {/* 投稿サイト用の書き出し（SPEC-aozora-export。開いている章の編集中の内容が対象） */}
          <Button
            size="sm"
            variant="outline"
            title="投稿サイト用に書き出し（青空文庫・カクヨム・なろう）"
            disabled={!selectedPath || chapterLoading}
            onClick={onExportAozora}
          >
            <FileDown data-icon="inline-start" />
            書き出し
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenBuild}>
            ビルド
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={fullPreviewLoading || chaptersCount === 0}
            onClick={onStartFullPreview}
          >
            {fullPreviewLoading ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <BookOpen data-icon="inline-start" />
            )}
            全体プレビュー
          </Button>
          {/* プレビューの別ウィンドウ分離（Issue #72）。狭い画面＋外部ディスプレイの
              使い方が主目的なので、インラインプレビューと違い lg 未満でも出す */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              detached
                ? "プレビューをこのウィンドウに戻す"
                : "プレビューを別ウィンドウで開く"
            }
            title={
              detached
                ? "プレビューをこのウィンドウに戻す"
                : "プレビューを別ウィンドウで開く"
            }
            className={cn("text-muted-foreground", detached && "text-primary")}
            onClick={onToggleDetached}
          >
            <PictureInPicture2 />
          </Button>
          {!detached && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={previewOpen ? "プレビューを隠す" : "プレビューを表示"}
              className="hidden text-muted-foreground lg:inline-flex"
              onClick={onTogglePreview}
            >
              <PanelRight />
            </Button>
          )}
          {/* 集中モード: ナビ・ヘッダー・章一覧・ツールバーを隠して執筆に専念する */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="集中モード（入力ペインのみを表示）"
            title="集中モード（Escで解除）"
            className="text-muted-foreground"
            disabled={selectedPath === null}
            onClick={onEnterFocus}
          >
            <Maximize2 />
          </Button>
          <Button
            size="sm"
            disabled={!selectedPath || !dirty || saving || merging}
            onClick={onRequestSave}
          >
            <Save data-icon="inline-start" />
            保存
          </Button>
        </div>
      </div>
    </>
  );
}
