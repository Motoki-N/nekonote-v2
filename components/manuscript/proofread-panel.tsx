"use client";

import { useState } from "react";
import { useObject } from "@ai-sdk/react";
import { CircleStop, GitCommitHorizontal, Loader2, MessageSquareText, SpellCheck, TextSelect, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  commitAcceptedSuggestions,
  writeBackOnHoldSuggestions,
  type SuggestionRecord,
} from "@/lib/actions/manuscripts";
import { isApplicable } from "@/lib/proofread-apply";
import type { SuggestionStatus } from "@/lib/schemas/enums";
import {
  PROOFREAD_SELECTION_MIN_CHARS,
  proofreadSuggestionSchema,
} from "@/lib/schemas/manuscript";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const suggestionsSchema = z.array(proofreadSuggestionSchema);

/** /api/proofread の errorResponse（JSON）からユーザー向けメッセージを取り出す */
function toDisplayError(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // JSON でなければ汎用文言にフォールバック
  }
  return "校正の実行に失敗しました。時間をおいて再試行してください";
}

const STATUS_LABEL: Record<SuggestionStatus, string> = {
  pending: "未処理",
  on_hold: "保留",
  accepted: "受入",
  rejected: "拒否",
};

const STATUS_VARIANT: Record<SuggestionStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  on_hold: "outline",
  accepted: "default",
  rejected: "destructive",
};

/**
 * 校正パネル（SPEC-proofreading §3.3）。
 * lg以上は右サイドパネル、lg未満はボトムシート（レビューパネルと同じレイアウト言語）。
 * streamObject の配列を useObject で受け、確定した提案から順にカード表示する
 */
export function ProofreadPanel({
  linkId,
  content,
  suggestions,
  selection,
  onUpdateStatus,
  onLocate,
  onCompleted,
  onClose,
}: {
  linkId: string;
  /** 表示中の原稿本文（受入可否＝原文抜粋の一意一致の判定に使う） */
  content: string;
  /**
   * エディタで選択中のテキスト（SPEC-proofread-selection §3）。
   * undefined = 選択範囲校正を提供しない画面（原稿タブ）。最小長未満はボタンを出さない
   */
  selection?: string;
  /** 保存済み提案（親が openManuscriptFile / 再読込で取得したもの） */
  suggestions: SuggestionRecord[];
  /** 受入/拒否/保留の状態変更（親が提案一覧を更新する） */
  onUpdateStatus: (id: string, status: SuggestionStatus) => Promise<void>;
  /** カードクリックで原稿の該当箇所へスクロール＆ハイライト（Issue #71） */
  onLocate: (originalText: string) => void;
  /** 校正完了・コミット完了時に親がファイル情報（本文・提案・バナー）を取り直す */
  onCompleted: () => Promise<void>;
  onClose: () => void;
}) {
  const [hasRun, setHasRun] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [writingBack, setWritingBack] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const { object, submit, isLoading, stop, error } = useObject({
    api: "/api/proofread",
    schema: suggestionsSchema,
    onError: (err) => setStreamError(toDisplayError(err)),
    onFinish: ({ object: finished, error: finishError }) => {
      // ストリームは正常終了したが最終検証に失敗（プロバイダエラー等で空のまま終了）
      if (!finished && finishError) {
        setStreamError("校正の実行に失敗しました。時間をおいて再試行してください");
      }
      // 保存済みの提案（statusつき）と最新原稿を取り直す。
      // サーバー側の保存（onFinish）はストリーム終了後に完了するため、
      // 即時の取り直しに加えて一拍おいてもう一度取り直す（レース対策）
      setRefreshing(true);
      void onCompleted()
        .then(() => new Promise((resolve) => setTimeout(resolve, 1200)))
        .then(() => onCompleted())
        .finally(() => setRefreshing(false));
    },
  });

  const busy = isLoading || refreshing || committing || writingBack || updatingId !== null;
  const streaming = isLoading ? (object ?? []) : null;
  const pendingCount = suggestions.filter((s) => s.status === "pending").length;
  const acceptedUncommitted = suggestions.filter(
    (s) => s.status === "accepted" && s.committed_sha === null,
  );
  // 受入済みに適用不能が混ざっているとコミットは必ず失敗するため、先にUIで止める
  const inapplicableAcceptedCount = acceptedUncommitted.filter(
    (s) => !isApplicable(content, s.original_text),
  ).length;
  // 保留のコメント書き戻し（SPEC-vertical-editor-phase4 §3.2）。書き戻し済み（committed_sha あり）は対象外
  const onHoldUnwritten = suggestions.filter(
    (s) => s.status === "on_hold" && s.committed_sha === null,
  );
  const inapplicableOnHoldCount = onHoldUnwritten.filter(
    (s) => !isApplicable(content, s.original_text),
  ).length;
  const displayError = error ? toDisplayError(error) : streamError;

  const handleUpdateStatus = async (id: string, status: SuggestionStatus) => {
    setUpdatingId(id);
    try {
      await onUpdateStatus(id, status);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const result = await commitAcceptedSuggestions(linkId);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "コミットに失敗しました" : result.error.message);
        return;
      }
      if (result.data.warning) {
        toast.warning(result.data.warning);
      } else {
        toast(`${result.data.appliedCount}件の修正をコミットしました`);
      }
      await onCompleted();
    } finally {
      setCommitting(false);
    }
  };

  const handleWriteBack = async () => {
    setWritingBack(true);
    try {
      const result = await writeBackOnHoldSuggestions(linkId);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "書き戻しに失敗しました" : result.error.message);
        return;
      }
      if (result.data.warning) {
        toast.warning(result.data.warning);
      } else {
        toast(`保留${result.data.writtenCount}件をコメントとして書き戻しました`);
      }
      await onCompleted();
    } finally {
      setWritingBack(false);
    }
  };

  return (
    <aside
      aria-label="校正パネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <SpellCheck className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">校正・校閲</span>
        <span className="text-xs text-muted-foreground">校正さん</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="パネルを閉じる"
            className="text-muted-foreground"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">
          {suggestions.length === 0 && streaming === null && !hasRun && (
            <p className="p-2 text-sm text-muted-foreground">
              「校正を受ける」で、校正さんが誤字脱字・表記揺れ・文法をチェックします
            </p>
          )}
          {hasRun && !busy && pendingCount === 0 && streaming === null && !displayError && (
            <p className="p-2 text-sm text-muted-foreground">指摘事項はありません</p>
          )}
          {streaming === null &&
            suggestions.map((s) => (
              <SavedSuggestionCard
                key={s.id}
                suggestion={s}
                applicable={isApplicable(content, s.original_text)}
                disabled={busy}
                updating={updatingId === s.id}
                onUpdateStatus={(status) => void handleUpdateStatus(s.id, status)}
                onLocate={() => onLocate(s.original_text)}
              />
            ))}
          {streaming !== null && (
            <>
              {/* 実行中: 確定した提案から順に表示（保存は完了時にまとめて） */}
              {streaming.map((s, i) => (
                <SuggestionCardBody
                  key={i}
                  originalText={s?.original_text ?? ""}
                  suggestedText={s?.suggested_text ?? ""}
                  reason={s?.reason ?? null}
                  header={<span className="text-xs text-muted-foreground">提案 {i + 1}</span>}
                  onLocate={() => onLocate(s?.original_text ?? "")}
                />
              ))}
              <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                校正中…
              </div>
            </>
          )}
          {displayError && <p className="text-sm text-destructive">{displayError}</p>}
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t border-border p-3">
        {isLoading ? (
          <Button variant="outline" onClick={() => stop()} aria-label="校正を停止">
            <CircleStop data-icon="inline-start" />
            停止
          </Button>
        ) : (
          <>
            {acceptedUncommitted.length > 0 && (
              <>
                {inapplicableAcceptedCount > 0 && (
                  <p className="text-xs text-destructive">
                    適用不能の受入提案が{inapplicableAcceptedCount}件あります。
                    未処理に戻すか拒否するとコミットできます
                  </p>
                )}
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="secondary"
                        disabled={busy || inapplicableAcceptedCount > 0}
                      >
                        {committing ? (
                          <Loader2 data-icon="inline-start" className="animate-spin" />
                        ) : (
                          <GitCommitHorizontal data-icon="inline-start" />
                        )}
                        確定分をコミット（{acceptedUncommitted.length}件）
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>修正をリポジトリに書き戻しますか？</AlertDialogTitle>
                      <AlertDialogDescription>
                        受け入れた{acceptedUncommitted.length}
                        件の修正をまとめて適用し、1コミットとしてGitHubへ書き戻します。
                        保留中の提案はコミット後も残ります。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleCommit()}>
                        コミットする
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            {onHoldUnwritten.length > 0 && (
              <>
                {inapplicableOnHoldCount > 0 && (
                  <p className="text-xs text-destructive">
                    適用不能の保留提案が{inapplicableOnHoldCount}件あります。
                    未処理に戻すか拒否すると書き戻せます
                  </p>
                )}
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="secondary"
                        disabled={busy || inapplicableOnHoldCount > 0}
                      >
                        {writingBack ? (
                          <Loader2 data-icon="inline-start" className="animate-spin" />
                        ) : (
                          <MessageSquareText data-icon="inline-start" />
                        )}
                        保留をコメントで書き戻す（{onHoldUnwritten.length}件）
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        保留提案をコメントとして原稿に書き戻しますか？
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        保留中の{onHoldUnwritten.length}件を、該当箇所の直前に {"<!-- -->"}{" "}
                        コメントとして挿入し、1コミットとしてGitHubへ書き戻します。
                        コメントはプレビュー・PDFには現れず、縦書きエディタのコメント一覧から確認できます。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleWriteBack()}>
                        書き戻す
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            {selection !== undefined && selection.length >= PROOFREAD_SELECTION_MIN_CHARS && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setHasRun(true);
                  setStreamError(null);
                  submit({ manuscriptLinkId: linkId, selection });
                }}
              >
                <TextSelect data-icon="inline-start" />
                選択範囲を校正（{selection.length}字）
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                setHasRun(true);
                setStreamError(null);
                submit({ manuscriptLinkId: linkId });
              }}
            >
              {suggestions.length === 0 && !hasRun ? "校正を受ける" : "再校正を受ける"}
            </Button>
          </>
        )}
      </footer>
    </aside>
  );
}

function SavedSuggestionCard({
  suggestion,
  applicable,
  disabled,
  updating,
  onUpdateStatus,
  onLocate,
}: {
  suggestion: SuggestionRecord;
  /** 原文抜粋が現在の原稿に一意に見つかるか（見つからなければ受入不可＝適用不能） */
  applicable: boolean;
  disabled: boolean;
  updating: boolean;
  onUpdateStatus: (status: SuggestionStatus) => void;
  /** カードクリックで原稿の該当箇所へジャンプ */
  onLocate: () => void;
}) {
  const committed = suggestion.committed_sha !== null;
  const { status } = suggestion;
  // committed_sha の意味は status で分岐する: accepted=適用コミット、on_hold=コメント書き戻し（SPEC-phase4 §3.2）。
  // 書き戻し済みの保留は操作対象から外す（消化はエディタのコメント一覧に一本化）
  const writtenBack = committed && status === "on_hold";
  // 適用不能の表示は「これから適用しうる」状態（未処理・保留・未コミットの受入）に限る
  const showInapplicable =
    !applicable && !committed && (status === "pending" || status === "on_hold" || status === "accepted");

  return (
    <SuggestionCardBody
      originalText={suggestion.original_text}
      suggestedText={suggestion.suggested_text}
      reason={suggestion.reason}
      onLocate={onLocate}
      header={
        <>
          <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
          {committed && (
            <Badge variant="outline">{writtenBack ? "コメント書き戻し済み" : "コミット済み"}</Badge>
          )}
          {showInapplicable && <Badge variant="destructive">適用不能</Badge>}
          {updating && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </>
      }
      footer={
        committed ? null : (
          // 操作ボタンのクリックをカードクリック（該当箇所ジャンプ）に伝播させない
          <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {(status === "pending" || status === "on_hold") && (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled || !applicable}
                  onClick={() => onUpdateStatus("accepted")}
                >
                  受入
                </Button>
                {status === "pending" && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onUpdateStatus("on_hold")}
                  >
                    保留
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive"
                  disabled={disabled}
                  onClick={() => onUpdateStatus("rejected")}
                >
                  拒否
                </Button>
              </>
            )}
            {(status === "accepted" || status === "rejected") && (
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => onUpdateStatus("pending")}
              >
                未処理に戻す
              </Button>
            )}
          </div>
        )
      }
    />
  );
}

function SuggestionCardBody({
  originalText,
  suggestedText,
  reason,
  header,
  footer,
  onLocate,
}: {
  originalText: string;
  suggestedText: string;
  reason: string | null;
  header: React.ReactNode;
  footer?: React.ReactNode;
  /** カードクリック（原稿の該当箇所へジャンプ）。ボタン類のクリックは対象外 */
  onLocate?: () => void;
}) {
  return (
    <article
      className="cursor-pointer rounded-lg border border-border bg-card p-3 transition-colors hover:border-ring"
      role="button"
      tabIndex={0}
      aria-label="原稿の該当箇所を表示"
      onClick={onLocate}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onLocate?.();
        }
      }}
    >
      <header className="mb-2 flex items-center gap-2">{header}</header>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">原文</dt>
          <dd className="whitespace-pre-wrap text-card-foreground line-through decoration-destructive/60">
            {originalText}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">修正案</dt>
          <dd className="whitespace-pre-wrap font-medium text-card-foreground">{suggestedText}</dd>
        </div>
        {reason && (
          <div>
            <dt className="text-xs text-muted-foreground">理由</dt>
            <dd className="text-muted-foreground">{reason}</dd>
          </div>
        )}
      </dl>
      {footer}
    </article>
  );
}
