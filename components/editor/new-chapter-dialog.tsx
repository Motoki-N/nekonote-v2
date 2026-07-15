'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * 新規章ファイルの作成ダイアログ（SPEC-vertical-editor-phase2 §3.3）。
 * `manuscripts/` 配下固定。作成＝コミット。entry への追記は自動では行わない。
 * フォームは閉じるとアンマウントされるため、開くたびに空欄へ戻る
 */
export function NewChapterDialog({
  open,
  creating,
  onCreate,
  onOpenChange,
}: {
  open: boolean
  creating: boolean
  onCreate: (fileName: string) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !creating && onOpenChange(next)}>
      <DialogContent>
        <NewChapterForm
          creating={creating}
          onCreate={onCreate}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function NewChapterForm({
  creating,
  onCreate,
  onCancel,
}: {
  creating: boolean
  onCreate: (fileName: string) => void
  onCancel: () => void
}) {
  const [fileName, setFileName] = useState('')

  return (
    <>
      <DialogHeader>
        <DialogTitle>新しい章ファイル</DialogTitle>
        <DialogDescription>
          manuscripts/ 配下に雛形入りで作成し、そのままコミットします。book.config.js の entry
          への追記は行わないため、章順に載せるには entry を直接編集してください
        </DialogDescription>
      </DialogHeader>
      <form
        id="editor-new-chapter-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (fileName.trim().length > 0) onCreate(fileName.trim())
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm text-foreground">
          ファイル名
          <Input
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder="例: 22-scene12.md"
            maxLength={100}
            autoFocus
            disabled={creating}
          />
        </label>
      </form>
      <DialogFooter>
        <Button variant="outline" size="sm" disabled={creating} onClick={onCancel}>
          キャンセル
        </Button>
        <Button
          type="submit"
          form="editor-new-chapter-form"
          size="sm"
          disabled={creating || fileName.trim().length === 0}
        >
          {creating && <Loader2 data-icon="inline-start" className="animate-spin" />}
          作成してコミット
        </Button>
      </DialogFooter>
    </>
  )
}
