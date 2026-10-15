"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  getBookSettings,
  saveBookConfig,
  saveNombreVars,
  saveOkuzuke,
  saveThemeVars,
  saveTocSettings,
} from "@/lib/actions/editor";
import type {
  BookSettingsData,
  ThemeSettings,
  TocSettingsData,
} from "@/lib/actions/editor";
import { NOMBRE_SLOTS, NOMBRE_SLOT_LABELS } from "@/lib/editor/book-config";
import type { EntryItem, NombreSlot } from "@/lib/editor/book-config";
import {
  DEFAULT_TOC_TITLE,
  TOC_DEPTH_OPTIONS,
  TOC_LEADER_OPTIONS,
  TOC_PAGE_NUMBER_OPTIONS,
  isValidTocTitle,
} from "@/lib/editor/toc";
import type { TocLeader, TocPageNumber } from "@/lib/editor/toc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * 設定フォーム（SPEC-vertical-editor-phase3 §7）。区画（書誌・章構成・目次・組み設定・奥付）を
 * それぞれ独立に保存＝コミットする。書き換えは正規表現置換＋置換後検証（サーバー側）。
 * 対応できない構造のセクションは読み取り専用の案内になる（フェイルソフト）
 */
export function SettingsDialog({
  projectId,
  branch,
  open,
  onOpenChange,
  onSaved,
  onOpenChapter,
}: {
  projectId: string;
  /** 読み書き対象のブランチ（SPEC-vertical-editor-phase5 §3.4。設定フォームも現在ブランチへ） */
  branch: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** いずれかのセクションのコミット成功後（章一覧・テーマの再取得は親の責務） */
  onSaved: () => void;
  /** 奥付を章として直接編集する導線（ダイアログは閉じる） */
  onOpenChapter: (path: string) => void;
}) {
  const [data, setData] = useState<BookSettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 読み込み中は導出状態（setState は .then コールバック内のみ＝コードベースの定石）
  const loading = data === null && loadError === null;

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof getBookSettings>>) => {
      if (!result.ok || !result.data) {
        setData(null);
        setLoadError(
          result.ok ? "設定の取得に失敗しました" : result.error.message,
        );
        return;
      }
      setLoadError(null);
      setData(result.data);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getBookSettings(projectId, branch).then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, branch, applyResult]);

  /** 保存成功の共通後処理: 設定を取り直し（新SHA）、親へ通知（章一覧・プレビュー更新） */
  const handleSaved = useCallback(() => {
    void getBookSettings(projectId, branch).then(applyResult);
    onSaved();
  }, [projectId, branch, applyResult, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>書籍設定</DialogTitle>
          <DialogDescription>
            保存すると設定ファイル（book.config.js・テーマCSS・奥付）へコミットされます
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2
                className="size-5 animate-spin text-muted-foreground"
                aria-label="読み込み中"
              />
            </div>
          ) : loadError ? (
            <p className="p-2 text-sm text-destructive">{loadError}</p>
          ) : data ? (
            <div className="flex flex-col gap-6 pb-2">
              {data.config ? (
                <>
                  <BiblioSection
                    projectId={projectId}
                    branch={branch}
                    config={data.config}
                    onSaved={handleSaved}
                  />
                  {/* 目次の保存でも entry が変わるため、設定ファイルの版ごとに作り直して
                      古い並び（目次要素の有無）のまま上書きコミットしないようにする（Issue #307） */}
                  <EntrySection
                    key={data.config.sha}
                    projectId={projectId}
                    branch={branch}
                    config={data.config}
                    candidates={data.entryCandidates}
                    onSaved={handleSaved}
                  />
                  {data.toc && (
                    <TocSection
                      key={Object.values(data.toc.baseShas).join(",")}
                      projectId={projectId}
                      branch={branch}
                      toc={data.toc}
                      onSaved={handleSaved}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  book.config.js
                  が見つかりません。書誌情報・章構成のフォームを使うには、
                  原稿リポジトリテンプレートの構成にしてください。
                </p>
              )}
              {data.themes.map((theme) => {
                // どの区画がプレビューか特定できたときだけ印を出す（Issue #242）
                const usage: ThemeUsage = data.themes.some(
                  (candidate) => candidate.usedInPreview,
                )
                  ? theme.usedInPreview
                    ? "preview"
                    : "build-only"
                  : undefined;
                return (
                  <Fragment key={theme.cssPath}>
                    <KumiSection
                      projectId={projectId}
                      branch={branch}
                      theme={theme}
                      themeUsage={usage}
                      onSaved={handleSaved}
                    />
                    <NombreSection
                      projectId={projectId}
                      branch={branch}
                      theme={theme}
                      themeUsage={usage}
                      onSaved={handleSaved}
                    />
                  </Fragment>
                );
              })}
              <OkuzukeSection
                projectId={projectId}
                branch={branch}
                okuzuke={data.okuzuke}
                onSaved={handleSaved}
                onOpenChapter={(path) => {
                  onOpenChange(false);
                  onOpenChapter(path);
                }}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- 共通パーツ ----

/**
 * テーマ区画がプレビューに使われるか（Issue #242）。
 * undefined = 判定できない（book.config.js が読めない等）＝印を出さない
 */
type ThemeUsage = "preview" | "build-only" | undefined;

function SectionFrame({
  title,
  themeUsage,
  children,
}: {
  title: string;
  themeUsage?: ThemeUsage;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        {title}
        {themeUsage === "preview" ? (
          <Badge variant="secondary">プレビューに使用中</Badge>
        ) : null}
        {themeUsage === "build-only" ? (
          <Badge variant="outline">入稿ビルド専用</Badge>
        ) : null}
      </h3>
      {themeUsage === "build-only" ? (
        <p className="text-xs text-muted-foreground">
          この判型のテーマはエディタのプレビューには読み込まれません。ここを変更しても
          プレビューの見た目は変わらず、この判型の入稿ビルドにのみ反映されます。
        </p>
      ) : null}
      {children}
    </section>
  );
}

/** コミット前の差分プレビュー（SPEC-phase3 §7。変更点の 旧 → 新 を確認してから実行） */
function ConfirmDiff({
  changes,
  saving,
  onCommit,
  onBack,
}: {
  changes: { label: string; before: string; after: string }[];
  saving: boolean;
  onCommit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/30 p-3">
      <p className="text-xs text-muted-foreground">この内容でコミットします:</p>
      <ul className="flex flex-col gap-1 text-sm">
        {changes.map((change) => (
          <li key={change.label} className="min-w-0">
            <span className="text-muted-foreground">{change.label}: </span>
            <span className="break-all line-through opacity-60">
              {change.before}
            </span>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className="break-all text-foreground">{change.after}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="outline" disabled={saving} onClick={onBack}>
          戻る
        </Button>
        <Button size="sm" disabled={saving} onClick={onCommit}>
          {saving && (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          )}
          コミットする
        </Button>
      </div>
    </div>
  );
}

type SectionConfig = NonNullable<BookSettingsData["config"]>;

// ---- 1. 書誌情報 ----

function BiblioSection({
  projectId,
  branch,
  config,
  onSaved,
}: {
  projectId: string;
  branch: string;
  config: SectionConfig;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(config.title ?? "");
  const [author, setAuthor] = useState(config.author ?? "");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const titleChanged = config.title !== null && title.trim() !== config.title;
  const authorChanged =
    config.author !== null && author.trim() !== config.author;
  const dirty = titleChanged || authorChanged;

  const commit = async () => {
    setSaving(true);
    try {
      const result = await saveBookConfig(projectId, {
        baseSha: config.sha,
        title: titleChanged ? title.trim() : null,
        author: authorChanged ? author.trim() : null,
        entryRawItems: null,
        branch,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("書誌情報をコミットしました");
      setConfirming(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionFrame title="書誌情報">
      {config.title === null && config.author === null ? (
        <p className="text-sm text-muted-foreground">
          title / author を抽出できない構造です。VS
          Code等で直接編集してください。
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {config.title !== null && (
            <label className="flex flex-col gap-1 text-sm">
              書名（title）
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          )}
          {config.author !== null && (
            <label className="flex flex-col gap-1 text-sm">
              著者（author）
              <Input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              />
            </label>
          )}
          {confirming ? (
            <ConfirmDiff
              changes={[
                ...(titleChanged
                  ? [
                      {
                        label: "書名",
                        before: config.title ?? "",
                        after: title.trim(),
                      },
                    ]
                  : []),
                ...(authorChanged
                  ? [
                      {
                        label: "著者",
                        before: config.author ?? "",
                        after: author.trim(),
                      },
                    ]
                  : []),
              ]}
              saving={saving}
              onCommit={() => void commit()}
              onBack={() => setConfirming(false)}
            />
          ) : (
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!dirty || title.trim() === "" || author.trim() === ""}
                onClick={() => setConfirming(true)}
              >
                変更を確認
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionFrame>
  );
}

// ---- 2. 章構成（entry） ----

function EntrySection({
  projectId,
  branch,
  config,
  candidates,
  onSaved,
}: {
  projectId: string;
  branch: string;
  config: SectionConfig;
  candidates: string[];
  onSaved: () => void;
}) {
  const [items, setItems] = useState<EntryItem[]>(config.entryItems ?? []);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (config.entryItems === null) {
    return (
      <SectionFrame title="章構成（entry）">
        <p className="text-sm text-muted-foreground">
          entry を解析できない構造です（変数参照・スプレッド等）。VS
          Code等で直接編集してください。
        </p>
      </SectionFrame>
    );
  }

  const original = config.entryItems;
  const dirty =
    items.length !== original.length ||
    items.some((item, index) => item.raw !== original[index].raw);
  const remainingCandidates = candidates.filter(
    (candidate) => !items.some((item) => item.path === candidate),
  );

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const commit = async () => {
    setSaving(true);
    try {
      const result = await saveBookConfig(projectId, {
        baseSha: config.sha,
        title: null,
        author: null,
        entryRawItems: items.map((item) => item.raw),
        branch,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("章構成をコミットしました");
      setConfirming(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const displayName = (item: EntryItem) =>
    item.path ? (item.path.split("/").pop() ?? item.path) : item.raw;

  return (
    <SectionFrame title="章構成（entry）">
      <ul className="flex flex-col gap-0.5">
        {items.map((item, index) => (
          <li
            key={`${item.raw}:${index}`}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm"
          >
            <span className="min-w-0 flex-1 break-all">
              {displayName(item)}
              {item.path === null && (
                <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  特殊要素（目次など）
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="上へ"
              className="text-muted-foreground"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下へ"
              className="text-muted-foreground"
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown />
            </Button>
            {item.path !== null && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="entryから除外"
                className="text-muted-foreground"
                onClick={() =>
                  setItems((prev) => prev.filter((_, i) => i !== index))
                }
              >
                <X />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {remainingCandidates.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">entry 未登録の章:</p>
          <ul className="flex flex-col gap-0.5">
            {remainingCandidates.map((candidate) => (
              <li key={candidate} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-all text-muted-foreground">
                  {candidate.split("/").pop()}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { raw: `'${candidate}'`, path: candidate },
                    ])
                  }
                >
                  追加
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirming ? (
        <ConfirmDiff
          changes={[
            {
              label: "章構成",
              before: original.map(displayName).join(" / "),
              after: items.map(displayName).join(" / "),
            },
          ]}
          saving={saving}
          onCommit={() => void commit()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => setConfirming(true)}
          >
            変更を確認
          </Button>
        </div>
      )}
    </SectionFrame>
  );
}

// ---- 2-2. 目次（SPEC-toc-settings。Issue #307） ----

const onOffLabel = (value: boolean, on: string, off: string) =>
  value ? on : off;

function depthLabel(depth: number): string {
  return (
    TOC_DEPTH_OPTIONS.find((option) => option.value === depth)?.label ??
    `その他（${depth}）`
  );
}

function optionLabel<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * 目次の有無・見出し・深さ（book.config.js と EPUB 設定）と、外す章・見た目（判型テーマCSSの
 * 目次ブロック）を1区画で扱い、変わったファイルだけを1コミットで保存する（SPEC §6）
 */
function TocSection({
  projectId,
  branch,
  toc,
  onSaved,
}: {
  projectId: string;
  branch: string;
  toc: TocSettingsData;
  onSaved: () => void;
}) {
  const initialConfig = toc.config;
  // 外す章は entry にあるものだけを扱う（ファイル名を変えた章の古い指定は保存で落ちる）
  const initialStyle = toc.style
    ? {
        ...toc.style,
        excludedPaths: toc.chapters.filter((path) =>
          toc.style?.excludedPaths.includes(path),
        ),
      }
    : null;

  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? false);
  const [title, setTitle] = useState(initialConfig?.title ?? DEFAULT_TOC_TITLE);
  const [depth, setDepth] = useState(initialConfig?.depth ?? 0);
  const [excluded, setExcluded] = useState<string[]>(
    initialStyle?.excludedPaths ?? [],
  );
  const [showBookTitle, setShowBookTitle] = useState(
    initialStyle?.showBookTitle ?? true,
  );
  const [pageNumber, setPageNumber] = useState<TocPageNumber>(
    initialStyle?.pageNumber ?? "arabic",
  );
  const [leader, setLeader] = useState<TocLeader>(
    initialStyle?.leader ?? "dots",
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (initialConfig === null && initialStyle === null) {
    return (
      <SectionFrame title="目次">
        <p className="text-sm text-muted-foreground">
          book.config.js
          の目次設定（toc）とテーマCSSの目次ブロックを、フォームで扱えない形です。
          VS Code等で直接編集してください。
        </p>
      </SectionFrame>
    );
  }

  const trimmedTitle = title.trim();
  const configChanges = initialConfig
    ? [
        ...(enabled !== initialConfig.enabled
          ? [
              {
                label: "目次",
                before: onOffLabel(initialConfig.enabled, "入れる", "入れない"),
                after: onOffLabel(enabled, "入れる", "入れない"),
              },
            ]
          : []),
        ...(enabled && trimmedTitle !== initialConfig.title
          ? [
              {
                label: "見出し",
                before: initialConfig.title,
                after: trimmedTitle,
              },
            ]
          : []),
        ...(enabled && depth !== initialConfig.depth
          ? [
              {
                label: "載せる見出し",
                before: depthLabel(initialConfig.depth),
                after: depthLabel(depth),
              },
            ]
          : []),
      ]
    : [];
  const fileName = (path: string) => path.split("/").pop() ?? path;
  const excludedText = (paths: string[]) =>
    paths.length === 0 ? "なし" : paths.map(fileName).join("・");
  const styleChanges = initialStyle
    ? [
        ...(excluded.join("\n") !== initialStyle.excludedPaths.join("\n")
          ? [
              {
                label: "目次から外す章",
                before: excludedText(initialStyle.excludedPaths),
                after: excludedText(excluded),
              },
            ]
          : []),
        ...(showBookTitle !== initialStyle.showBookTitle
          ? [
              {
                label: "書名",
                before: onOffLabel(
                  initialStyle.showBookTitle,
                  "出す",
                  "出さない",
                ),
                after: onOffLabel(showBookTitle, "出す", "出さない"),
              },
            ]
          : []),
        ...(pageNumber !== initialStyle.pageNumber
          ? [
              {
                label: "ページ番号",
                before: optionLabel(
                  TOC_PAGE_NUMBER_OPTIONS,
                  initialStyle.pageNumber,
                ),
                after: optionLabel(TOC_PAGE_NUMBER_OPTIONS, pageNumber),
              },
            ]
          : []),
        ...(leader !== initialStyle.leader
          ? [
              {
                label: "リーダー",
                before: optionLabel(TOC_LEADER_OPTIONS, initialStyle.leader),
                after: optionLabel(TOC_LEADER_OPTIONS, leader),
              },
            ]
          : []),
      ]
    : [];
  // 判型テーマ間の食い違いは、見た目を変えていなくても保存で揃える（SPEC §5）
  const sendStyle =
    initialStyle !== null && (styleChanges.length > 0 || toc.stylesDiffer);
  const sendConfig = initialConfig !== null && configChanges.length > 0;
  const titleInvalid = enabled && !isValidTocTitle(trimmedTitle);

  const toggleExcluded = (path: string, checked: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      // entry の順を保つ（差分表示・書き込みの順序を安定させる）
      return toc.chapters.filter((chapter) => next.has(chapter));
    });
  };

  const commit = async () => {
    setSaving(true);
    try {
      const result = await saveTocSettings(projectId, {
        config: sendConfig ? { enabled, title: trimmedTitle, depth } : null,
        style: sendStyle
          ? { showBookTitle, pageNumber, leader, excludedPaths: excluded }
          : null,
        baseShas: toc.baseShas,
        branch,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("目次の設定をコミットしました");
      if (result.data?.epubSkipped) {
        toast.warning(
          "EPUB設定（book.config.epub.js）は書き換えられない構造のため、印刷用だけを更新しました。EPUB設定は直接編集してください",
        );
      }
      setConfirming(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const styleDisabled = initialStyle === null || !enabled;

  return (
    <SectionFrame title="目次">
      <p className="text-xs text-muted-foreground">
        目次ページは入稿ビルドで自動生成されます。項目は章の見出しから作られ、ページ番号も組版時に入ります。
        差し込み位置は「章構成（entry）」の上下ボタンで調整してください。
      </p>
      {initialConfig === null ? (
        <p className="text-sm text-muted-foreground">
          book.config.js
          の目次設定（toc・entry）がフォームで扱えない形のため、目次の有無・見出し・
          載せる見出しは直接編集してください。
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-3.5 shrink-0 accent-primary"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            目次を入れる
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              見出し
              <Input
                value={title}
                disabled={!enabled}
                maxLength={30}
                aria-invalid={titleInvalid}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              載せる見出し
              <select
                className={selectClass}
                value={depth}
                disabled={!enabled}
                onChange={(event) => setDepth(Number(event.target.value))}
              >
                {TOC_DEPTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                {TOC_DEPTH_OPTIONS.every(
                  (option) => option.value !== initialConfig.depth,
                ) && (
                  <option value={initialConfig.depth}>
                    {depthLabel(initialConfig.depth)}
                  </option>
                )}
              </select>
            </label>
          </div>
          {titleInvalid && (
            <p className="text-xs text-destructive">
              見出しは30字以内で、引用符・改行を含めずに入力してください
            </p>
          )}
        </div>
      )}
      {initialStyle === null ? (
        <p className="text-sm text-muted-foreground">
          テーマCSSの目次ブロックが手で編集されているため、外す章と見た目はフォームで扱えません。
          CSSを直接編集してください。
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <p className="text-sm">目次から外す章</p>
            <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-2">
              {toc.chapters.map((path) => (
                <li key={path}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-primary"
                      checked={excluded.includes(path)}
                      disabled={styleDisabled}
                      onChange={(event) =>
                        toggleExcluded(path, event.target.checked)
                      }
                    />
                    <span className="min-w-0 flex-1 break-all">
                      {fileName(path)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              扉・奥付など、目次に載せたくない章にチェックを入れます。「載せる見出し」を節以上にすると、
              HTMLで直接書いた見出し（id
              のないもの）はページ番号が付かないため自動で外れます。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-3.5 shrink-0 accent-primary"
              checked={showBookTitle}
              disabled={styleDisabled}
              onChange={(event) => setShowBookTitle(event.target.checked)}
            />
            目次ページに書名を出す
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              ページ番号
              <select
                className={selectClass}
                value={pageNumber}
                disabled={styleDisabled}
                onChange={(event) =>
                  setPageNumber(event.target.value as TocPageNumber)
                }
              >
                {TOC_PAGE_NUMBER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              リーダー
              <select
                className={selectClass}
                value={leader}
                disabled={styleDisabled || pageNumber === "none"}
                onChange={(event) => setLeader(event.target.value as TocLeader)}
              >
                {TOC_LEADER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {toc.styleAbsent && (
            <p className="text-xs text-muted-foreground">
              テーマCSSに目次の設定がまだないため、今の見た目を表示しています。保存するとテーマCSSの末尾に目次ブロックを追記します。
            </p>
          )}
          {toc.stylesDiffer && (
            <p className="text-xs text-muted-foreground">
              判型（A6・B6）のテーマで目次の設定が食い違っています。ここに表示しているのはプレビューに使うテーマの設定で、保存すると両方がこの内容に揃います。
            </p>
          )}
        </div>
      )}
      {toc.epub === "present" && (
        <p className="text-xs text-muted-foreground">
          目次の有無・見出し・載せる見出しは EPUB
          設定（book.config.epub.js）にも同時に反映します。外す章と見た目は印刷用（PDF）だけに効きます。
        </p>
      )}
      {toc.epub === "unsupported" && (
        <p className="text-xs text-muted-foreground">
          EPUB
          設定（book.config.epub.js）はフォームで扱えない形のため、印刷用だけを書き換えます。EPUB
          の目次は直接編集してください。
        </p>
      )}
      {confirming ? (
        <ConfirmDiff
          changes={[
            ...configChanges,
            ...styleChanges,
            ...(sendStyle && styleChanges.length === 0
              ? [
                  {
                    label: "判型テーマ",
                    before: "食い違いあり",
                    after: "表示中の設定に揃える",
                  },
                ]
              : []),
          ]}
          saving={saving}
          onCommit={() => void commit()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={(!sendConfig && !sendStyle) || titleInvalid}
            onClick={() => setConfirming(true)}
          >
            変更を確認
          </Button>
        </div>
      )}
    </SectionFrame>
  );
}

// ---- 3. 組み設定（テーマ変数） ----

const KUMI_FIELDS = [
  { key: "lines", varName: "--vs-theme--num-of-line", label: "行数", step: 1 },
  {
    key: "charsPerLine",
    varName: "--vs-theme--num-of-character",
    label: "字詰め（字/行）",
    step: 1,
  },
  {
    key: "lineHeight",
    varName: "--vs-line-height",
    label: "行送り",
    step: 0.05,
  },
  {
    key: "fontSizePercent",
    varName: "--vs-font-size-on-print",
    label: "フォントサイズ（%）",
    step: 0.01,
  },
] as const;

function KumiSection({
  projectId,
  branch,
  theme,
  themeUsage,
  onSaved,
}: {
  projectId: string;
  branch: string;
  theme: ThemeSettings;
  themeUsage: ThemeUsage;
  onSaved: () => void;
}) {
  // 現在値（'72.92%' 等の単位付き文字列）を数値へ。抽出できない変数は編集不可
  const initial = Object.fromEntries(
    KUMI_FIELDS.map((field) => {
      const raw = theme.vars[field.varName];
      const value = raw === null ? null : Number.parseFloat(raw);
      return [
        field.key,
        value !== null && Number.isFinite(value) ? String(value) : null,
      ];
    }),
  ) as Record<(typeof KUMI_FIELDS)[number]["key"], string | null>;

  const [values, setValues] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const editableFields = KUMI_FIELDS.filter(
    (field) => initial[field.key] !== null,
  );
  if (editableFields.length === 0) {
    return (
      <SectionFrame title={`組み設定 — ${theme.label}`} themeUsage={themeUsage}>
        <p className="text-sm text-muted-foreground">
          このテーマには組み設定の変数が見つかりません。CSSを直接編集してください。
        </p>
      </SectionFrame>
    );
  }

  const changedFields = editableFields.filter(
    (field) =>
      values[field.key] !== null && values[field.key] !== initial[field.key],
  );
  const invalid = editableFields.some((field) => {
    const value = values[field.key];
    return (
      value === null || value.trim() === "" || !Number.isFinite(Number(value))
    );
  });

  const commit = async () => {
    setSaving(true);
    try {
      const changed = new Set(changedFields.map((field) => field.key));
      const num = (key: (typeof KUMI_FIELDS)[number]["key"]) =>
        changed.has(key) ? Number(values[key]) : null;
      const result = await saveThemeVars(projectId, {
        cssPath: theme.cssPath,
        baseSha: theme.sha,
        vars: {
          lines: num("lines"),
          charsPerLine: num("charsPerLine"),
          lineHeight: num("lineHeight"),
          fontSizePercent: num("fontSizePercent"),
        },
        branch,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("組み設定をコミットしました");
      setConfirming(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionFrame title={`組み設定 — ${theme.label}`} themeUsage={themeUsage}>
      <p className="text-xs text-muted-foreground">{theme.cssPath}</p>
      <div className="grid grid-cols-2 gap-2">
        {editableFields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm">
            {field.label}
            <Input
              type="number"
              step={field.step}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((prev) => ({
                  ...prev,
                  [field.key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </div>
      {confirming ? (
        <ConfirmDiff
          changes={changedFields.map((field) => ({
            label: field.label,
            before: initial[field.key] ?? "",
            after: values[field.key] ?? "",
          }))}
          saving={saving}
          onCommit={() => void commit()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={changedFields.length === 0 || invalid}
            onClick={() => setConfirming(true)}
          >
            変更を確認
          </Button>
        </div>
      )}
    </SectionFrame>
  );
}

// ---- 3-2. ノンブル・柱（Issue #237） ----

// Input と同じトーンの select（shadcn select 未導入のため。atelier-workspace と同じ流儀）
const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function NombreSection({
  projectId,
  branch,
  theme,
  themeUsage,
  onSaved,
}: {
  projectId: string;
  branch: string;
  theme: ThemeSettings;
  themeUsage: ThemeUsage;
  onSaved: () => void;
}) {
  const initial = theme.nombre;
  const [page, setPage] = useState<NombreSlot>(initial?.page ?? "none");
  const [title, setTitle] = useState<NombreSlot>(initial?.title ?? "none");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (initial === null) {
    return (
      <SectionFrame
        title={`ノンブル・柱 — ${theme.label}`}
        themeUsage={themeUsage}
      >
        <p className="text-sm text-muted-foreground">
          このテーマにはノンブル・柱の変数が見つからないか、フォームで扱えない値が
          入っています。CSSを直接編集してください。
        </p>
      </SectionFrame>
    );
  }

  const changes = [
    page !== initial.page
      ? {
          label: "ノンブルの位置",
          before: NOMBRE_SLOT_LABELS[initial.page],
          after: NOMBRE_SLOT_LABELS[page],
        }
      : null,
    title !== initial.title
      ? {
          label: "柱（章タイトル）の位置",
          before: NOMBRE_SLOT_LABELS[initial.title],
          after: NOMBRE_SLOT_LABELS[title],
        }
      : null,
  ].filter((change) => change !== null);

  const commit = async () => {
    setSaving(true);
    try {
      const result = await saveNombreVars(projectId, {
        cssPath: theme.cssPath,
        baseSha: theme.sha,
        settings: { page, title },
        branch,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("ノンブル・柱の設定をコミットしました");
      setConfirming(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionFrame
      title={`ノンブル・柱 — ${theme.label}`}
      themeUsage={themeUsage}
    >
      <p className="text-xs text-muted-foreground">
        小口（外側）は左右ページで自動的に入れ替わります。ノンブルと柱を同じ位置にすると
        「1　章タイトル」のように連結して出ます。
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          ノンブル（ページ番号）
          <select
            className={selectClass}
            value={page}
            onChange={(event) => setPage(event.target.value as NombreSlot)}
          >
            {NOMBRE_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {NOMBRE_SLOT_LABELS[slot]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          柱（章タイトル）
          <select
            className={selectClass}
            value={title}
            onChange={(event) => setTitle(event.target.value as NombreSlot)}
          >
            {NOMBRE_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {NOMBRE_SLOT_LABELS[slot]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        本文との間隔を広げたいときは、組み設定の字詰めを減らして天地の余白を広げてください。
      </p>
      {confirming ? (
        <ConfirmDiff
          changes={changes}
          saving={saving}
          onCommit={() => void commit()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={changes.length === 0}
            onClick={() => setConfirming(true)}
          >
            変更を確認
          </Button>
        </div>
      )}
    </SectionFrame>
  );
}

// ---- 4. 奥付 ----

function OkuzukeSection({
  projectId,
  branch,
  okuzuke,
  onSaved,
  onOpenChapter,
}: {
  projectId: string;
  branch: string;
  okuzuke: BookSettingsData["okuzuke"];
  onSaved: () => void;
  onOpenChapter: (path: string) => void;
}) {
  const [dateText, setDateText] = useState(okuzuke?.data.dateText ?? "");
  const [fields, setFields] = useState(okuzuke?.data.fields ?? []);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!okuzuke) {
    return (
      <SectionFrame title="奥付">
        <p className="text-sm text-muted-foreground">
          奥付のテンプレート構造（class: colophon の章）を検出できませんでした。
          奥付は章ファイルとしてエディタで直接編集できます。
        </p>
      </SectionFrame>
    );
  }

  const dateChanged =
    okuzuke.data.dateText !== null && dateText.trim() !== okuzuke.data.dateText;
  const changedFields = fields.filter(
    (field) =>
      okuzuke.data.fields.find((original) => original.label === field.label)
        ?.value !== field.value.trim(),
  );
  const dirty = dateChanged || changedFields.length > 0;

  const commit = async () => {
    setSaving(true);
    try {
      const result = await saveOkuzuke(projectId, {
        path: okuzuke.path,
        baseSha: okuzuke.sha,
        branch,
        dateText: dateChanged ? dateText.trim() : null,
        fields: changedFields.map((field) => ({
          label: field.label,
          value: field.value.trim(),
        })),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("奥付をコミットしました");
      setConfirming(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionFrame title="奥付">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {okuzuke.path.split("/").pop()}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => onOpenChapter(okuzuke.path)}
        >
          章として直接編集
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {okuzuke.data.dateText !== null && (
          <label className="flex flex-col gap-1 text-sm">
            発行日（「◯◯　初版発行」の◯◯部分）
            <Input
              value={dateText}
              onChange={(event) => setDateText(event.target.value)}
            />
          </label>
        )}
        {fields.map((field, index) => (
          <label key={field.label} className="flex flex-col gap-1 text-sm">
            {field.label}
            <Input
              value={field.value}
              onChange={(event) =>
                setFields((prev) =>
                  prev.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
        ))}
      </div>
      {confirming ? (
        <ConfirmDiff
          changes={[
            ...(dateChanged
              ? [
                  {
                    label: "発行日",
                    before: okuzuke.data.dateText ?? "",
                    after: dateText.trim(),
                  },
                ]
              : []),
            ...changedFields.map((field) => ({
              label: field.label,
              before:
                okuzuke.data.fields.find(
                  (original) => original.label === field.label,
                )?.value ?? "",
              after: field.value.trim(),
            })),
          ]}
          saving={saving}
          onCommit={() => void commit()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => setConfirming(true)}
          >
            変更を確認
          </Button>
        </div>
      )}
    </SectionFrame>
  );
}
