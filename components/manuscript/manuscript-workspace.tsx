"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpenText, FileText, Info, Loader2, PenLine, Settings, SpellCheck } from "lucide-react";
import { toast } from "sonner";

import {
  openManuscriptFile,
  updateSuggestionStatus,
  type ManuscriptFileData,
  type ManuscriptTreeData,
} from "@/lib/actions/manuscripts";
import type { SuggestionStatus } from "@/lib/schemas/enums";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CritiquePanel } from "@/components/manuscript/critique-panel";
import { ProofreadPanel } from "@/components/manuscript/proofread-panel";

/**
 * 原稿タブのワークスペース（SPEC-proofreading §3.2）。
 * デスクトップ=左ファイル一覧＋本文（＋右に校正パネル）、モバイル=一覧⇔本文の切替。
 * 原稿は読み込み専用（エディタではない）
 */
export function ManuscriptWorkspace({
  projectId,
  tree,
  treeError,
  initialFile,
}: {
  projectId: string;
  tree: ManuscriptTreeData | null;
  /** ツリー取得のエラー（PAT失効・リポジトリ不達等。画面は落とさず表示する） */
  treeError: string | null;
  /** ?file= での初期表示（エディタからの相互リンク。一覧に無いパスは無視する。SPEC-phase4 §3.1） */
  initialFile: string | null;
}) {
  // ?file= の初期表示（エディタからの相互リンク。一覧との一致でのみ採用する多層防御。SPEC-phase4 §3.1）
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    initialFile && tree?.gate === "ok" && tree.files.includes(initialFile) ? initialFile : null,
  );
  const [file, setFile] = useState<ManuscriptFileData | null>(null);
  const [loading, setLoading] = useState(selectedPath !== null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // 講評パネル（作品全体対象。ファイルを開いていなくても使える）。校正パネルと排他表示
  const [critiqueOpen, setCritiqueOpen] = useState(false);
  // 提案カードクリックによる該当箇所ハイライト。nonce は同じカードの再クリックでも再スクロールさせるため
  const [highlight, setHighlight] = useState<{ text: string; nonce: number } | null>(null);

  // 本文の取得のみ（先頭 await まで同期 setState なし＝初期表示の effect からも呼べる）
  const loadFile = useCallback(
    async (path: string) => {
      try {
        const result = await openManuscriptFile(projectId, path);
        if (!result.ok || !result.data) {
          setFile(null);
          setFileError(result.ok ? "ファイルの読み込みに失敗しました" : result.error.message);
          return;
        }
        setFile(result.data);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  const openFile = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      setLoading(true);
      setFileError(null);
      setHighlight(null);
      await loadFile(path);
    },
    [loadFile],
  );

  // 校正完了後にファイル情報（最新本文・提案・バナー）を取り直す
  const refreshFile = useCallback(async () => {
    if (selectedPath) await openFile(selectedPath);
  }, [selectedPath, openFile]);

  // ?file= の初期ロード（初回のみ。選択・ローディング表示は state 初期化子で設定済み）
  const initialLoadRef = useRef(selectedPath);
  useEffect(() => {
    const path = initialLoadRef.current;
    if (path === null) return;
    initialLoadRef.current = null;
    void loadFile(path);
  }, [loadFile]);

  // 受入/拒否/保留はGitHub再取得を伴わないため、成功時はローカルの提案一覧だけ差し替える
  const handleUpdateSuggestion = useCallback(
    async (id: string, status: SuggestionStatus) => {
      const result = await updateSuggestionStatus(id, status);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setFile((prev) =>
        prev
          ? {
              ...prev,
              suggestions: prev.suggestions.map((s) => (s.id === id ? { ...s, status } : s)),
            }
          : prev,
      );
    },
    [],
  );

  // 提案カードクリック → 該当箇所へスクロール＆ハイライト（Issue #71）。
  // 原文抜粋が本文に見つからない提案（適用不能）はジャンプできない旨を通知する
  const handleLocate = useCallback(
    (originalText: string) => {
      if (!file) return;
      if (originalText === "" || !file.content.includes(originalText)) {
        toast.error("該当箇所が原稿内に見つかりません（原稿が更新された可能性があります）");
        return;
      }
      setHighlight((prev) => ({ text: originalText, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [file],
  );

  if (treeError) {
    return (
      <GuidanceCard>
        <p className="text-sm text-destructive">{treeError}</p>
        <p className="text-sm text-muted-foreground">
          PATの有効期限・対象リポジトリ設定と、プロジェクトのリポジトリ名を確認してください。
        </p>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings">設定をひらく</Link>}
        />
      </GuidanceCard>
    );
  }

  if (!tree || tree.gate === "no_pat") {
    return (
      <GuidanceCard>
        <p className="text-sm text-foreground">
          原稿リポジトリの読み込みには GitHub PAT の登録が必要です。
        </p>
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link href="/settings">
              <Settings data-icon="inline-start" />
              設定でPATを登録する
            </Link>
          }
        />
      </GuidanceCard>
    );
  }

  if (tree.gate === "no_repo") {
    return (
      <GuidanceCard>
        <p className="text-sm text-foreground">原稿リポジトリが設定されていません。</p>
        <p className="text-sm text-muted-foreground">
          ヘッダーの編集ボタン（鉛筆アイコン）から「原稿リポジトリ（owner/repo）」を設定してください。
        </p>
      </GuidanceCard>
    );
  }

  const relativeLabel = (path: string) =>
    tree.basePath === "" ? path : path.slice(tree.basePath.replace(/\/$/, "").length + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 原稿タブのツールバー（講評はファイルを開いていなくても実行できる。SPEC-dashboard-critique-settings §3.3） */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground">原稿 全{tree.files.length}ファイル</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={tree.files.length === 0}
          onClick={() => {
            setPanelOpen(false);
            setCritiqueOpen(true);
          }}
        >
          <BookOpenText data-icon="inline-start" />
          講評
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
      {/* ファイル一覧（モバイルはファイル未選択時のみ表示） */}
      <nav
        aria-label="原稿ファイル一覧"
        className={cn(
          "w-full shrink-0 overflow-y-auto border-border p-2 lg:block lg:w-64 lg:border-r",
          selectedPath !== null && "hidden",
        )}
      >
        {tree.files.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            原稿ファイル（.md / .txt）が見つかりません
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {tree.files.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => void openFile(path)}
                  aria-current={selectedPath === path ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    selectedPath === path
                      ? "bg-secondary text-secondary-foreground"
                      : "text-foreground hover:bg-secondary/50",
                  )}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-all">{relativeLabel(path)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* 原稿ビュー（読み込み専用） */}
      <main
        className={cn(
          "min-w-0 flex-1 flex-col overflow-y-auto",
          selectedPath === null ? "hidden lg:flex" : "flex",
        )}
      >
        {selectedPath === null ? (
          <p className="p-6 text-sm text-muted-foreground">
            左の一覧からファイルを選ぶと本文が表示されます
          </p>
        ) : (
          <>
            <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="ファイル一覧へ戻る"
                className="text-muted-foreground lg:hidden"
                onClick={() => {
                  setSelectedPath(null);
                  setFile(null);
                  setPanelOpen(false);
                }}
              >
                <ArrowLeft />
              </Button>
              <span className="min-w-0 break-all text-sm font-medium text-foreground">
                {relativeLabel(selectedPath)}
              </span>
              {file && (
                <span className="text-xs text-muted-foreground">{file.charCount}字</span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {/* 縦書きエディタへの相互リンク（同じ章を開いたまま遷移。SPEC-phase4 §3.1） */}
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <Link
                      href={`/projects/${projectId}/editor?file=${encodeURIComponent(selectedPath)}`}
                    >
                      <PenLine data-icon="inline-start" />
                      エディタで開く
                    </Link>
                  }
                />
                <Button
                  size="sm"
                  disabled={!file}
                  onClick={() => {
                    setCritiqueOpen(false);
                    setPanelOpen(true);
                  }}
                >
                  <SpellCheck data-icon="inline-start" />
                  校正を受ける
                </Button>
              </div>
            </header>

            {file &&
              file.lastReviewedCommit !== null &&
              file.lastReviewedCommit !== file.latestSha && (
                <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground">
                  <Info className="size-4 shrink-0" />
                  前回の校正以降に原稿が更新されています
                </div>
              )}

            {loading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2
                  className="size-5 animate-spin text-muted-foreground"
                  aria-label="読み込み中"
                />
              </div>
            ) : fileError ? (
              <p className="p-4 text-sm text-destructive">{fileError}</p>
            ) : (
              file && (
                <div className="mx-auto w-full max-w-2xl flex-1 whitespace-pre-wrap p-4 text-[15px] leading-7 text-foreground sm:p-6">
                  <ManuscriptBody content={file.content} highlight={highlight} />
                </div>
              )
            )}
          </>
        )}
      </main>

      {panelOpen && !critiqueOpen && file && (
        <ProofreadPanel
          key={file.linkId}
          linkId={file.linkId}
          content={file.content}
          suggestions={file.suggestions}
          onUpdateStatus={handleUpdateSuggestion}
          onLocate={handleLocate}
          onCompleted={refreshFile}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {critiqueOpen && <CritiquePanel projectId={projectId} onClose={() => setCritiqueOpen(false)} />}
      </div>
    </div>
  );
}

/**
 * 原稿本文の表示。ハイライト指定があれば該当箇所（最初の出現）を <mark> で挟み、
 * スクロールして見せる（Issue #71）。見つからない場合は本文をそのまま表示する
 */
function ManuscriptBody({
  content,
  highlight,
}: {
  content: string;
  highlight: { text: string; nonce: number } | null;
}) {
  const markRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // highlight（nonce）が変わるたびに該当箇所へスクロールする。
    // block: "start" ＋ scroll-mt で、モバイルのボトムシート（下65dvh）に隠れない位置に出す
    markRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight]);

  const idx = highlight === null ? -1 : content.indexOf(highlight.text);
  if (highlight === null || idx === -1) return <>{content}</>;
  return (
    <>
      {content.slice(0, idx)}
      <mark ref={markRef} className="scroll-mt-24 rounded-sm bg-primary/20 text-foreground">
        {highlight.text}
      </mark>
      {content.slice(idx + highlight.text.length)}
    </>
  );
}

function GuidanceCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-start gap-3 rounded-lg border border-border bg-card p-4">
        {children}
      </div>
    </div>
  );
}
