"use client";

import { useEffect, useState } from "react";
import { BookOpen, FileText, Loader2 } from "lucide-react";

import {
  generateManuscriptsForBoard,
  getManuscriptPlan,
  type GenerateManuscriptsResult,
  type ManuscriptPlanData,
  type PlannedManuscript,
} from "@/lib/actions/manuscript-generate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** 一覧の1行分の編集状態（チェック＋ファイル名） */
type Row = PlannedManuscript & { selected: boolean };

/**
 * 原稿ファイルの生成ダイアログ（SPEC-manuscript-bridge §4.2）。
 * 単体作成（`targetIds` に1件）と一括生成（`targetIds` が空＝未紐づけ全件）で共用する。
 * 追加のみの操作なので AlertDialog ではなく本ダイアログの主ボタンで確定する
 * （AlertDialog は削除・テンプレ切替など既存の破壊的操作専用のまま）
 */
export function GenerateManuscriptsDialog({
  projectId,
  targetIds,
  onGenerated,
  onClose,
}: {
  projectId: string;
  /** 対象のシーンID。空配列 = 未紐づけの全件（一括生成） */
  targetIds: string[];
  /** 生成成功時。ボードの state 更新とトーストは親が担う */
  onGenerated: (result: GenerateManuscriptsResult) => void;
  onClose: () => void;
}) {
  // null = 読み込み中（プレビューの取得はマウント後。ボードの初期表示をGitHubのレイテンシから切り離す）
  const [plan, setPlan] = useState<ManuscriptPlanData | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [appendToEntry, setAppendToEntry] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // プレビューの取得自体が失敗したときのメッセージ（gate の誘導文と取り違えない）
  const [loadError, setLoadError] = useState<string | null>(null);

  const single = targetIds.length === 1;
  // 親は呼び出しごとに新しい配列を渡すため、依存には値の列を使う
  // （配列そのものを入れると毎レンダーで再取得してチェック状態が飛ぶ）
  const targetKey = targetIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = targetKey === "" ? [] : targetKey.split(",");
    void getManuscriptPlan(projectId, ids).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        // 前提未達（gate）と取得失敗は別物。GitHub 障害・PAT 失効を
        // 「リポジトリ未設定」と誤案内しないよう、サーバーの文言をそのまま出す
        setLoadError(result.error.message);
        return;
      }
      if (!result.data) {
        setLoadError("対象の取得に失敗しました");
        return;
      }
      setPlan(result.data);
      if (result.data.gate === "ok") {
        setRows(result.data.targets.map((t) => ({ ...t, selected: true })));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, targetKey]);

  const selected = rows.filter((row) => row.selected);
  const invalid = selected.some((row) => row.fileName.trim() === "");

  async function handleGenerate() {
    if (busy || selected.length === 0 || invalid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await generateManuscriptsForBoard(projectId, {
        targets: selected.map((row) => ({
          id: row.id,
          fileName: row.fileName.trim(),
        })),
        appendToEntry,
      });
      if (!result.ok || !result.data) {
        setError(
          result.ok ? "原稿ファイルの作成に失敗しました" : result.error.message,
        );
        return;
      }
      onGenerated(result.data);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      {/* 低い画面でもフッターの操作に届くよう、ダイアログ全体を画面内に収めてスクロール */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {single ? "原稿ファイルを新規作成" : "原稿ファイルをまとめて作成"}
          </DialogTitle>
          <DialogDescription>
            雛形入りのファイルを作成し、原稿リポジトリに1コミットします。並び順は書籍設定の
            entry で調整できます
          </DialogDescription>
        </DialogHeader>

        {loadError !== null ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : plan === null ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : plan.gate !== "ok" ? (
          <p className="text-sm text-muted-foreground">
            {plan.gate === "no_repo"
              ? "原稿ファイルの作成にはリポジトリの設定が必要です（プロジェクト設定）"
              : "原稿ファイルの作成にはGitHub PATの登録が必要です（設定画面）"}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            作成できる対象がありません。すべての章・シーンに原稿ファイルが紐づいています
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <li key={row.id} className="flex items-center gap-2">
                  {/* 1件モードでは対象が1つに決まっているためチェックボックスを出さない */}
                  {!single && (
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-primary"
                      checked={row.selected}
                      disabled={busy}
                      aria-label={`${row.title || "（無題）"}を作成する`}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) =>
                            i === index
                              ? { ...r, selected: e.target.checked }
                              : r,
                          ),
                        )
                      }
                    />
                  )}
                  <span
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground"
                    title={row.title || "（無題）"}
                  >
                    {row.kind === "chapter" ? (
                      <BookOpen
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <FileText
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span className="truncate">
                      {row.kind === "chapter"
                        ? `第${row.number}章`
                        : `${row.number}.`}{" "}
                      {row.title || "（無題）"}
                    </span>
                  </span>
                  <Input
                    value={row.fileName}
                    disabled={busy || !row.selected}
                    maxLength={100}
                    aria-label={`${row.title || "（無題）"}のファイル名`}
                    className="h-8 w-48 shrink-0 text-xs"
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === index ? { ...r, fileName: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </li>
              ))}
            </ul>

            {plan.gate === "ok" && plan.truncated && (
              <p className="text-xs text-muted-foreground">
                未作成が多いため先頭 {rows.length}{" "}
                件だけ出しています。残りは作成後にもう一度実行してください
              </p>
            )}

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 accent-primary"
                checked={appendToEntry}
                disabled={busy}
                onChange={(e) => setAppendToEntry(e.target.checked)}
              />
              book.config.js の entry にも追記する
            </label>

            {error !== null && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            キャンセル
          </Button>
          <Button
            size="sm"
            disabled={
              busy ||
              loadError !== null ||
              plan === null ||
              plan.gate !== "ok" ||
              selected.length === 0 ||
              invalid
            }
            onClick={() => void handleGenerate()}
          >
            {busy && (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            )}
            {single ? "作成してコミット" : `${selected.length}件を作成`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
