"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpenText,
  CircleStop,
  Loader2,
  MessageSquareText,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  createCritiqueSession,
  getCritiqueBootstrap,
  listCritiqueSessions,
  writeBackCritique,
  type CritiqueBootstrap,
  type CritiqueRecord,
} from "@/lib/actions/critique";
import {
  CRITIQUE_CONFIRM_CHARS,
  CRITIQUE_MAX_CHARS,
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** /api/review の errorResponse（JSON）からユーザー向けメッセージを取り出す */
async function toDisplayError(res: Response): Promise<string> {
  try {
    const parsed = (await res.json()) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // JSON でなければ汎用文言にフォールバック
  }
  return "講評の実行に失敗しました。時間をおいて再試行してください";
}

/**
 * 講評パネル（SPEC-dashboard-critique-settings §3.3）。
 * 作品全体（base_path 配下の全原稿）への読み切り型レビュー。
 * 毎回独立実行し、履歴一覧として残す（反復・返答メモなし）。
 * lg以上は右サイドパネル、lg未満はボトムシート
 */
export function CritiquePanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [bootstrap, setBootstrap] = useState<CritiqueBootstrap | null>(null);
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  // プロファイル別のユーザー選択（未選択時は default_persona にフォールバック）
  const [personaChoice, setPersonaChoice] = useState<Record<string, string>>(
    {},
  );
  const [critiques, setCritiques] = useState<CritiqueRecord[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 講評のレビューメモ書き戻し（SPEC-vertical-editor-phase4 §3.3）。
  // 恒久的な重複記録は持たないため、この表示中に書き戻したものだけ無効化する
  const [writingBackId, setWritingBackId] = useState<string | null>(null);
  const [writtenBackIds, setWrittenBackIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const busy = streamingText !== null;

  useEffect(() => {
    let cancelled = false;
    void getCritiqueBootstrap(projectId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        setBootstrap(result.data);
        setCritiques(result.data.critiques);
        setSelectedProfileId(result.data.profiles[0]?.id ?? null);
      } else {
        setError(
          result.ok ? "講評設定の取得に失敗しました" : result.error.message,
        );
      }
      setBootstrapDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ストリーミング中は追記に合わせて先頭（実行中ブロック）に追従
  useEffect(() => {
    const el = scrollRef.current;
    if (el && streamingText !== null) el.scrollTop = 0;
  }, [streamingText]);

  const profile =
    bootstrap?.profiles.find((p) => p.id === selectedProfileId) ?? null;
  const effectivePersonaId =
    selectedProfileId !== null
      ? (personaChoice[selectedProfileId] ?? profile?.defaultPersonaId ?? null)
      : null;
  const selectedPersona =
    bootstrap?.personas.find((p) => p.id === effectivePersonaId) ?? null;

  // 読者系（なりきり先が必要）はジャンル・ターゲット層の未設定で実行不可（フェイルクローズ）
  const targetMissing =
    selectedPersona?.referenceScope === "manuscript_plus_target" &&
    !(bootstrap?.genreSet && bootstrap?.targetAudienceSet);
  const overMax =
    bootstrap?.totalChars != null && bootstrap.totalChars > CRITIQUE_MAX_CHARS;
  const needsConfirm =
    bootstrap?.totalChars != null &&
    bootstrap.totalChars > CRITIQUE_CONFIRM_CHARS &&
    !overMax;

  const runCritique = useCallback(
    async (confirmLong: boolean) => {
      if (busy || selectedProfileId === null || effectivePersonaId === null)
        return;
      setError(null);

      const session = await createCritiqueSession(
        projectId,
        selectedProfileId,
        effectivePersonaId,
      );
      if (!session.ok || !session.data) {
        setError(
          session.ok ? "セッションの作成に失敗しました" : session.error.message,
        );
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setStreamingText("");
      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.data.sessionId,
            confirmLong,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          setError(await toDisplayError(res));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setStreamingText((prev) => (prev ?? "") + chunk);
        }
        // 完了: 保存済みの講評一覧を取り直す（onFinish のDB保存とレースするため念のため二段）
        const refreshed = await listCritiqueSessions(projectId);
        if (refreshed.ok && refreshed.data) setCritiques(refreshed.data);
        setTimeout(() => {
          void listCritiqueSessions(projectId).then((late) => {
            if (late.ok && late.data) setCritiques(late.data);
          });
        }, 1200);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // stop ボタンによる中断。未完の講評は保存されない
        } else {
          setError("講評の実行に失敗しました。時間をおいて再試行してください");
        }
      } finally {
        abortRef.current = null;
        setStreamingText(null);
      }
    },
    [busy, selectedProfileId, effectivePersonaId, projectId],
  );

  const handleWriteBack = useCallback(async (sessionId: string) => {
    setWritingBackId(sessionId);
    try {
      const result = await writeBackCritique(sessionId);
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "書き戻しに失敗しました" : result.error.message,
        );
        return;
      }
      toast("講評をレビューメモ（00-review-notes.md）へ書き戻しました");
      setWrittenBackIds((prev) => new Set(prev).add(sessionId));
    } finally {
      setWritingBackId(null);
    }
  }, []);

  const runDisabled =
    !bootstrapDone ||
    selectedProfileId === null ||
    effectivePersonaId === null ||
    targetMissing ||
    overMax;

  return (
    <aside
      aria-label="講評パネル"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[65dvh] flex-col border-t border-border bg-background lg:static lg:z-auto lg:h-full lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0"
    >
      <header className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <BookOpenText className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">講評</span>
          {bootstrap?.totalChars != null && (
            <span className="text-xs text-muted-foreground">
              作品全体 約{bootstrap.totalChars.toLocaleString("ja-JP")}字
            </span>
          )}
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
        </div>
        {bootstrap && bootstrap.profiles.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              aria-label="講評プロファイル"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={selectedProfileId ?? ""}
              disabled={busy}
              onChange={(e) => {
                setError(null);
                setSelectedProfileId(e.target.value);
              }}
            >
              {bootstrap.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="担当ペルソナ"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={effectivePersonaId ?? ""}
              disabled={busy}
              onChange={(e) => {
                const profileId = selectedProfileId;
                const value = e.target.value;
                if (profileId === null || value === "") return;
                setPersonaChoice((prev) => ({ ...prev, [profileId]: value }));
              }}
            >
              {effectivePersonaId === null && (
                <option value="">担当を選択…</option>
              )}
              {bootstrap.personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {!bootstrapDone ? (
          <div className="flex h-full items-center justify-center">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="読み込み中"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {targetMissing && (
              <p className="rounded-lg border border-border bg-card p-3 text-sm text-card-foreground">
                この講評は、企画書のジャンル・ターゲット層になりきって読むため、両方の設定が必要です。
                <Link
                  href={`/projects/${projectId}`}
                  className="text-primary underline"
                >
                  企画書タブ
                </Link>
                で設定してください。
              </p>
            )}
            {overMax && bootstrap?.totalChars != null && (
              <p className="text-sm text-destructive">
                原稿が約{bootstrap.totalChars.toLocaleString("ja-JP")}
                字あり、講評の上限（
                {CRITIQUE_MAX_CHARS.toLocaleString("ja-JP")}
                字）を超えているため実行できません。
              </p>
            )}
            {streamingText !== null && (
              <article className="rounded-lg border border-border bg-card p-3">
                <header className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  講評中…
                </header>
                <div className="text-sm whitespace-pre-wrap text-card-foreground">
                  {streamingText}
                </div>
              </article>
            )}
            {critiques.length === 0 &&
              streamingText === null &&
              !targetMissing && (
                <p className="p-2 text-sm text-muted-foreground">
                  作品全体を読んだ講評を受けられます。読者講評はターゲット層になりきった賛否両論の感想を、
                  売り込み分析は書店員目線の売り込み提案を返します。あらすじ・キャッチコピーの作成も頼めます。
                </p>
              )}
            {critiques.map((critique) => (
              <details
                key={critique.sessionId}
                className="group rounded-lg border border-border bg-card"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 p-3 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-card-foreground">
                    {critique.profileName}
                  </span>
                  {critique.personaName && <span>{critique.personaName}</span>}
                  <span className="ml-auto">
                    {dateTimeFormat.format(new Date(critique.createdAt))}
                  </span>
                </summary>
                <div className="border-t border-border p-3 text-sm whitespace-pre-wrap text-card-foreground">
                  {critique.content}
                </div>
                {/* レビューメモ（manuscripts/00-review-notes.md）への書き戻し（SPEC-phase4 §3.3） */}
                <div className="flex justify-end border-t border-border px-3 py-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={
                      busy ||
                      writingBackId !== null ||
                      writtenBackIds.has(critique.sessionId)
                    }
                    onClick={() => void handleWriteBack(critique.sessionId)}
                  >
                    {writingBackId === critique.sessionId ? (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <MessageSquareText data-icon="inline-start" />
                    )}
                    {writtenBackIds.has(critique.sessionId)
                      ? "書き戻し済み"
                      : "レビューメモへ書き戻す"}
                  </Button>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-border p-3">
        {busy ? (
          <Button
            variant="outline"
            onClick={() => abortRef.current?.abort()}
            aria-label="講評を停止"
          >
            <CircleStop data-icon="inline-start" />
            停止
          </Button>
        ) : (
          <Button
            onClick={() => {
              if (needsConfirm) setConfirmOpen(true);
              else void runCritique(false);
            }}
            disabled={runDisabled}
          >
            講評を受ける
          </Button>
        )}
      </footer>

      {/* 15万字超の事前確認（SPEC §3.3。30万字超は実行不可なのでここには来ない） */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>長い原稿の講評を実行しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              原稿全体が約{(bootstrap?.totalChars ?? 0).toLocaleString("ja-JP")}
              字あり、長編小説の上限相当（
              {CRITIQUE_CONFIRM_CHARS.toLocaleString("ja-JP")}
              字）を超えています。そのまま実行しますか？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runCritique(true)}>
              実行する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
