"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";

import { MAX_HITS_PER_FILE, totalHitCount } from "@/lib/editor/search-replace";
import type { FileReplacePlan } from "@/lib/editor/search-replace";
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

/** 置換の対象範囲（Issue #263「現在のファイルか全ファイルかを選べる」） */
export type ReplaceScope = "current" | "all";

const fileNameOf = (path: string) => path.split("/").pop() ?? path;

type ReplaceDialogProps = {
  open: boolean;
  scope: ReplaceScope;
  /** 全ファイル選択時の対象章数（説明文に出す） */
  chaptersCount: number;
  /** 章を開いていなければ「現在のファイル」は選べない */
  hasCurrentChapter: boolean;
  currentName: string | null;
  searching: boolean;
  replacing: boolean;
  /** 検索結果。null は未検索（検索条件を変えたら親が null に戻す） */
  plans: FileReplacePlan[] | null;
  /** plans を得たときの検索語（結果表示の見出しと、条件変更の検知に使う） */
  searchedTerm: string;
  /** plans を得たときの置換語（置換語だけ変えた結果を見落とさないため検知に使う） */
  searchedReplacement: string;
  onScopeChange: (scope: ReplaceScope) => void;
  onSearch: (search: string, replacement: string) => void;
  onReplace: () => void;
  onOpenChange: (open: boolean) => void;
};

/**
 * 検索置換ダイアログ（Issue #263）。
 *
 * 置換結果は直接コミットせず、各章の未コミット待避（IndexedDB）に書く。
 * ユーザーは置換後に本文を確認し、「まとめてコミット」で自分の判断でコミットする
 * ——原稿を機械的に一括改変する操作なので、誤爆に気づく余地を残す。
 *
 * 検索は単純な文字列一致のみ（正規表現なし）。開いている章の逐次検索・
 * ハイライトは CodeMirror の検索パネル（Cmd/Ctrl+F）の担当で、ここは
 * 「該当を数えて一括で置き換える」ことに専念する。
 *
 * フォームは閉じるとアンマウントされるため、開くたびに初期状態へ戻る
 */
export function ReplaceDialog(props: ReplaceDialogProps) {
  const busy = props.searching || props.replacing;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => !busy && props.onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>検索置換</DialogTitle>
          <DialogDescription>
            置換した結果は未コミットの編集として保存されます。内容を確認してから
            「まとめてコミット」でコミットしてください
          </DialogDescription>
        </DialogHeader>
        <ReplaceForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ReplaceForm({
  scope,
  chaptersCount,
  hasCurrentChapter,
  currentName,
  searching,
  replacing,
  plans,
  searchedTerm,
  searchedReplacement,
  onScopeChange,
  onSearch,
  onReplace,
  onOpenChange,
}: ReplaceDialogProps) {
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");

  const busy = searching || replacing;
  const canSearch = search !== "" && !busy;
  // 条件を変えたら、表示中の結果（＝置換後の本文）はその条件のものではなくなる。
  // 置換語だけを変えた場合も、プランは古い置換後の本文を抱えたままなので検知する
  const stale =
    plans !== null &&
    (searchedTerm !== search || searchedReplacement !== replacement);
  const hitCount = plans === null ? 0 : totalHitCount(plans);

  return (
    <>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSearch) onSearch(search, replacement);
        }}
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm text-foreground">対象</legend>
          <div className="flex flex-wrap gap-2">
            <ScopeOption
              checked={scope === "current"}
              disabled={busy || !hasCurrentChapter}
              label="現在のファイル"
              hint={currentName ?? "章を開いていません"}
              onSelect={() => onScopeChange("current")}
            />
            <ScopeOption
              checked={scope === "all"}
              disabled={busy}
              label="全ファイル"
              hint={`章 ${chaptersCount} 件すべて`}
              onSelect={() => onScopeChange("all")}
            />
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            検索する文字列
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={busy}
              placeholder="旧表記"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            置換後の文字列
            <Input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              disabled={busy}
              placeholder="新表記（空にすると削除）"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          正規表現は使えません。入力したままの文字列で一致を探します（大文字小文字も区別します）
        </p>

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!canSearch}
          >
            {searching ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Search data-icon="inline-start" />
            )}
            該当を探す
          </Button>
          {stale && (
            <span className="text-xs text-muted-foreground">
              条件を変えました。もう一度「該当を探す」を押してください
            </span>
          )}
        </div>
      </form>

      {plans !== null && !stale && (
        <ReplaceResult
          plans={plans}
          hitCount={hitCount}
          searchedTerm={searchedTerm}
        />
      )}

      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          キャンセル
        </Button>
        <Button
          size="sm"
          disabled={busy || plans === null || stale || hitCount === 0}
          onClick={onReplace}
        >
          {replacing && (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          )}
          {hitCount > 0 ? `${hitCount}件を置換する` : "置換する"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ScopeOption({
  checked,
  disabled,
  label,
  hint,
  onSelect,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      <input
        type="radio"
        name="editor-replace-scope"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 accent-[var(--primary)]"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-foreground">{label}</span>
        <span className="truncate text-xs text-muted-foreground" title={hint}>
          {hint}
        </span>
      </span>
    </label>
  );
}

/** 置換前の確認（どのファイルに何件・どう変わるか）。押す前に誤爆に気づけるようにする */
function ReplaceResult({
  plans,
  hitCount,
  searchedTerm,
}: {
  plans: FileReplacePlan[];
  hitCount: number;
  searchedTerm: string;
}) {
  if (plans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        「{searchedTerm}」に一致する箇所はありませんでした
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-foreground">
        {plans.length}件のファイルに {hitCount}件 見つかりました
      </p>
      <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-md border border-border p-2">
        {plans.map((plan) => (
          <li key={plan.path} className="flex flex-col gap-1">
            <p className="flex items-baseline gap-2 text-sm font-medium text-foreground">
              <span className="min-w-0 truncate" title={plan.path}>
                {fileNameOf(plan.path)}
              </span>
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                {plan.count}件
              </span>
            </p>
            <ul className="flex flex-col gap-1">
              {plan.hits.map((hit) => (
                <li
                  key={hit.line}
                  className="flex gap-2 text-xs leading-relaxed"
                >
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {hit.line}
                  </span>
                  <span className="min-w-0 flex-1 break-all">
                    <s className="text-muted-foreground">{hit.before}</s>
                    <br />
                    <span className="text-foreground">{hit.after}</span>
                  </span>
                </li>
              ))}
            </ul>
            {plan.hits.length < plan.count && (
              <p className="text-xs text-muted-foreground">
                ……ほか（該当行の表示は{MAX_HITS_PER_FILE}行までです）
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
