'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  getBookSettings,
  saveBookConfig,
  saveOkuzuke,
  saveThemeVars,
} from '@/lib/actions/editor'
import type { BookSettingsData, ThemeSettings } from '@/lib/actions/editor'
import type { EntryItem } from '@/lib/editor/book-config'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * 設定フォーム（SPEC-vertical-editor-phase3 §7）。4区画（書誌・章構成・組み設定・奥付）を
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
  projectId: string
  /** 読み書き対象のブランチ（SPEC-vertical-editor-phase5 §3.4。設定フォームも現在ブランチへ） */
  branch: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** いずれかのセクションのコミット成功後（章一覧・テーマの再取得は親の責務） */
  onSaved: () => void
  /** 奥付を章として直接編集する導線（ダイアログは閉じる） */
  onOpenChapter: (path: string) => void
}) {
  const [data, setData] = useState<BookSettingsData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // 読み込み中は導出状態（setState は .then コールバック内のみ＝コードベースの定石）
  const loading = data === null && loadError === null

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof getBookSettings>>) => {
      if (!result.ok || !result.data) {
        setData(null)
        setLoadError(result.ok ? '設定の取得に失敗しました' : result.error.message)
        return
      }
      setLoadError(null)
      setData(result.data)
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getBookSettings(projectId, branch).then((result) => {
      if (!cancelled) applyResult(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, projectId, branch, applyResult])

  /** 保存成功の共通後処理: 設定を取り直し（新SHA）、親へ通知（章一覧・プレビュー更新） */
  const handleSaved = useCallback(() => {
    void getBookSettings(projectId, branch).then(applyResult)
    onSaved()
  }, [projectId, branch, applyResult, onSaved])

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
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="読み込み中" />
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
                  <EntrySection
                    projectId={projectId}
                    branch={branch}
                    config={data.config}
                    candidates={data.entryCandidates}
                    onSaved={handleSaved}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  book.config.js が見つかりません。書誌情報・章構成のフォームを使うには、
                  原稿リポジトリテンプレートの構成にしてください。
                </p>
              )}
              {data.themes.map((theme) => (
                <KumiSection
                  key={theme.cssPath}
                  projectId={projectId}
                  branch={branch}
                  theme={theme}
                  onSaved={handleSaved}
                />
              ))}
              <OkuzukeSection
                projectId={projectId}
                branch={branch}
                okuzuke={data.okuzuke}
                onSaved={handleSaved}
                onOpenChapter={(path) => {
                  onOpenChange(false)
                  onOpenChapter(path)
                }}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- 共通パーツ ----

function SectionFrame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** コミット前の差分プレビュー（SPEC-phase3 §7。変更点の 旧 → 新 を確認してから実行） */
function ConfirmDiff({
  changes,
  saving,
  onCommit,
  onBack,
}: {
  changes: { label: string; before: string; after: string }[]
  saving: boolean
  onCommit: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/30 p-3">
      <p className="text-xs text-muted-foreground">この内容でコミットします:</p>
      <ul className="flex flex-col gap-1 text-sm">
        {changes.map((change) => (
          <li key={change.label} className="min-w-0">
            <span className="text-muted-foreground">{change.label}: </span>
            <span className="break-all line-through opacity-60">{change.before}</span>
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
          {saving && <Loader2 data-icon="inline-start" className="animate-spin" />}
          コミットする
        </Button>
      </div>
    </div>
  )
}

type SectionConfig = NonNullable<BookSettingsData['config']>

// ---- 1. 書誌情報 ----

function BiblioSection({
  projectId,
  branch,
  config,
  onSaved,
}: {
  projectId: string
  branch: string
  config: SectionConfig
  onSaved: () => void
}) {
  const [title, setTitle] = useState(config.title ?? '')
  const [author, setAuthor] = useState(config.author ?? '')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  const titleChanged = config.title !== null && title.trim() !== config.title
  const authorChanged = config.author !== null && author.trim() !== config.author
  const dirty = titleChanged || authorChanged

  const commit = async () => {
    setSaving(true)
    try {
      const result = await saveBookConfig(projectId, {
        baseSha: config.sha,
        title: titleChanged ? title.trim() : null,
        author: authorChanged ? author.trim() : null,
        entryRawItems: null,
        branch,
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('書誌情報をコミットしました')
      setConfirming(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionFrame title="書誌情報">
      {config.title === null && config.author === null ? (
        <p className="text-sm text-muted-foreground">
          title / author を抽出できない構造です。VS Code等で直接編集してください。
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {config.title !== null && (
            <label className="flex flex-col gap-1 text-sm">
              書名（title）
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          )}
          {config.author !== null && (
            <label className="flex flex-col gap-1 text-sm">
              著者（author）
              <Input value={author} onChange={(event) => setAuthor(event.target.value)} />
            </label>
          )}
          {confirming ? (
            <ConfirmDiff
              changes={[
                ...(titleChanged
                  ? [{ label: '書名', before: config.title ?? '', after: title.trim() }]
                  : []),
                ...(authorChanged
                  ? [{ label: '著者', before: config.author ?? '', after: author.trim() }]
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
                disabled={!dirty || title.trim() === '' || author.trim() === ''}
                onClick={() => setConfirming(true)}
              >
                変更を確認
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionFrame>
  )
}

// ---- 2. 章構成（entry） ----

function EntrySection({
  projectId,
  branch,
  config,
  candidates,
  onSaved,
}: {
  projectId: string
  branch: string
  config: SectionConfig
  candidates: string[]
  onSaved: () => void
}) {
  const [items, setItems] = useState<EntryItem[]>(config.entryItems ?? [])
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  if (config.entryItems === null) {
    return (
      <SectionFrame title="章構成（entry）">
        <p className="text-sm text-muted-foreground">
          entry を解析できない構造です（変数参照・スプレッド等）。VS Code等で直接編集してください。
        </p>
      </SectionFrame>
    )
  }

  const original = config.entryItems
  const dirty =
    items.length !== original.length ||
    items.some((item, index) => item.raw !== original[index].raw)
  const remainingCandidates = candidates.filter(
    (candidate) => !items.some((item) => item.path === candidate),
  )

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    setItems((prev) => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const commit = async () => {
    setSaving(true)
    try {
      const result = await saveBookConfig(projectId, {
        baseSha: config.sha,
        title: null,
        author: null,
        entryRawItems: items.map((item) => item.raw),
        branch,
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('章構成をコミットしました')
      setConfirming(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const displayName = (item: EntryItem) =>
    item.path ? (item.path.split('/').pop() ?? item.path) : item.raw

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
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
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
                  {candidate.split('/').pop()}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() =>
                    setItems((prev) => [...prev, { raw: `'${candidate}'`, path: candidate }])
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
              label: '章構成',
              before: original.map(displayName).join(' / '),
              after: items.map(displayName).join(' / '),
            },
          ]}
          saving={saving}
          onCommit={() => void commit()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty} onClick={() => setConfirming(true)}>
            変更を確認
          </Button>
        </div>
      )}
    </SectionFrame>
  )
}

// ---- 3. 組み設定（テーマ変数） ----

const KUMI_FIELDS = [
  { key: 'lines', varName: '--vs-theme--num-of-line', label: '行数', step: 1 },
  { key: 'charsPerLine', varName: '--vs-theme--num-of-character', label: '字詰め（字/行）', step: 1 },
  { key: 'lineHeight', varName: '--vs-line-height', label: '行送り', step: 0.05 },
  { key: 'fontSizePercent', varName: '--vs-font-size-on-print', label: 'フォントサイズ（%）', step: 0.01 },
] as const

function KumiSection({
  projectId,
  branch,
  theme,
  onSaved,
}: {
  projectId: string
  branch: string
  theme: ThemeSettings
  onSaved: () => void
}) {
  // 現在値（'72.92%' 等の単位付き文字列）を数値へ。抽出できない変数は編集不可
  const initial = Object.fromEntries(
    KUMI_FIELDS.map((field) => {
      const raw = theme.vars[field.varName]
      const value = raw === null ? null : Number.parseFloat(raw)
      return [field.key, value !== null && Number.isFinite(value) ? String(value) : null]
    }),
  ) as Record<(typeof KUMI_FIELDS)[number]['key'], string | null>

  const [values, setValues] = useState(initial)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  const editableFields = KUMI_FIELDS.filter((field) => initial[field.key] !== null)
  if (editableFields.length === 0) {
    return (
      <SectionFrame title={`組み設定 — ${theme.label}`}>
        <p className="text-sm text-muted-foreground">
          このテーマには組み設定の変数が見つかりません。CSSを直接編集してください。
        </p>
      </SectionFrame>
    )
  }

  const changedFields = editableFields.filter(
    (field) => values[field.key] !== null && values[field.key] !== initial[field.key],
  )
  const invalid = editableFields.some((field) => {
    const value = values[field.key]
    return value === null || value.trim() === '' || !Number.isFinite(Number(value))
  })

  const commit = async () => {
    setSaving(true)
    try {
      const changed = new Set(changedFields.map((field) => field.key))
      const num = (key: (typeof KUMI_FIELDS)[number]['key']) =>
        changed.has(key) ? Number(values[key]) : null
      const result = await saveThemeVars(projectId, {
        cssPath: theme.cssPath,
        baseSha: theme.sha,
        vars: {
          lines: num('lines'),
          charsPerLine: num('charsPerLine'),
          lineHeight: num('lineHeight'),
          fontSizePercent: num('fontSizePercent'),
        },
        branch,
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('組み設定をコミットしました')
      setConfirming(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionFrame title={`組み設定 — ${theme.label}`}>
      <p className="text-xs text-muted-foreground">{theme.cssPath}</p>
      <div className="grid grid-cols-2 gap-2">
        {editableFields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm">
            {field.label}
            <Input
              type="number"
              step={field.step}
              value={values[field.key] ?? ''}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      {confirming ? (
        <ConfirmDiff
          changes={changedFields.map((field) => ({
            label: field.label,
            before: initial[field.key] ?? '',
            after: values[field.key] ?? '',
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
  )
}

// ---- 4. 奥付 ----

function OkuzukeSection({
  projectId,
  branch,
  okuzuke,
  onSaved,
  onOpenChapter,
}: {
  projectId: string
  branch: string
  okuzuke: BookSettingsData['okuzuke']
  onSaved: () => void
  onOpenChapter: (path: string) => void
}) {
  const [dateText, setDateText] = useState(okuzuke?.data.dateText ?? '')
  const [fields, setFields] = useState(okuzuke?.data.fields ?? [])
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!okuzuke) {
    return (
      <SectionFrame title="奥付">
        <p className="text-sm text-muted-foreground">
          奥付のテンプレート構造（class: colophon の章）を検出できませんでした。
          奥付は章ファイルとしてエディタで直接編集できます。
        </p>
      </SectionFrame>
    )
  }

  const dateChanged = okuzuke.data.dateText !== null && dateText.trim() !== okuzuke.data.dateText
  const changedFields = fields.filter(
    (field) =>
      okuzuke.data.fields.find((original) => original.label === field.label)?.value !==
      field.value.trim(),
  )
  const dirty = dateChanged || changedFields.length > 0

  const commit = async () => {
    setSaving(true)
    try {
      const result = await saveOkuzuke(projectId, {
        path: okuzuke.path,
        baseSha: okuzuke.sha,
        branch,
        dateText: dateChanged ? dateText.trim() : null,
        fields: changedFields.map((field) => ({ label: field.label, value: field.value.trim() })),
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('奥付をコミットしました')
      setConfirming(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionFrame title="奥付">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{okuzuke.path.split('/').pop()}</p>
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
            <Input value={dateText} onChange={(event) => setDateText(event.target.value)} />
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
              ? [{ label: '発行日', before: okuzuke.data.dateText ?? '', after: dateText.trim() }]
              : []),
            ...changedFields.map((field) => ({
              label: field.label,
              before:
                okuzuke.data.fields.find((original) => original.label === field.label)?.value ?? '',
              after: field.value.trim(),
            })),
          ]}
          saving={saving}
          onCommit={() => void commit()}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty} onClick={() => setConfirming(true)}>
            変更を確認
          </Button>
        </div>
      )}
    </SectionFrame>
  )
}
