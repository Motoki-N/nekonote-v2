"use client";

import { useState } from "react";
import { useObject } from "@ai-sdk/react";
import { CircleStop, Loader2, SpellCheck, X } from "lucide-react";
import { z } from "zod";

import type { SuggestionRecord } from "@/lib/actions/manuscripts";
import type { SuggestionStatus } from "@/lib/schemas/enums";
import { proofreadSuggestionSchema } from "@/lib/schemas/manuscript";
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
  suggestions,
  onCompleted,
  onClose,
}: {
  linkId: string;
  /** 保存済み提案（親が openManuscriptFile / 再読込で取得したもの） */
  suggestions: SuggestionRecord[];
  /** 校正完了時に親がファイル情報（本文・提案・バナー）を取り直す */
  onCompleted: () => Promise<void>;
  onClose: () => void;
}) {
  const [hasRun, setHasRun] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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

  const busy = isLoading || refreshing;
  const streaming = isLoading ? (object ?? []) : null;
  const pendingCount = suggestions.filter((s) => s.status === "pending").length;
  const displayError = error ? toDisplayError(error) : streamError;

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
              <SavedSuggestionCard key={s.id} suggestion={s} />
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
          <Button
            disabled={refreshing}
            onClick={() => {
              setHasRun(true);
              setStreamError(null);
              submit({ manuscriptLinkId: linkId });
            }}
          >
            {suggestions.length === 0 && !hasRun ? "校正を受ける" : "再校正を受ける"}
          </Button>
        )}
      </footer>
    </aside>
  );
}

function SavedSuggestionCard({ suggestion }: { suggestion: SuggestionRecord }) {
  return (
    <SuggestionCardBody
      originalText={suggestion.original_text}
      suggestedText={suggestion.suggested_text}
      reason={suggestion.reason}
      header={
        <Badge variant={STATUS_VARIANT[suggestion.status]}>
          {STATUS_LABEL[suggestion.status]}
        </Badge>
      }
    />
  );
}

function SuggestionCardBody({
  originalText,
  suggestedText,
  reason,
  header,
}: {
  originalText: string;
  suggestedText: string;
  reason: string | null;
  header: React.ReactNode;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-3">
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
    </article>
  );
}
