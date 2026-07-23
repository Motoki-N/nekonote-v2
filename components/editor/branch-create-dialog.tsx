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

// サーバー側の newBranchNameSchema と同じ形（事前フィードバック用。正はサーバー検証）
const BRANCH_PATTERN = /^(?!.*\.\.)(?!.*\/\/)[0-9A-Za-z][0-9A-Za-z._/-]{0,99}$/

/**
 * 新規ブランチの作成ダイアログ（SPEC-vertical-editor-phase5 §3.2）。
 * 起点は常にデフォルトブランチのHEAD。作成成功後は親がそのブランチへ切り替える。
 * フォームは閉じるとアンマウントされるため、開くたびに空欄へ戻る
 */
export function BranchCreateDialog({
  open,
  defaultBranch,
  creating,
  onCreate,
  onOpenChange,
}: {
  open: boolean
  defaultBranch: string
  creating: boolean
  onCreate: (name: string) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !creating && onOpenChange(next)}>
      <DialogContent>
        <BranchCreateForm
          defaultBranch={defaultBranch}
          creating={creating}
          onCreate={onCreate}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function BranchCreateForm({
  defaultBranch,
  creating,
  onCreate,
  onCancel,
}: {
  defaultBranch: string
  creating: boolean
  onCreate: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const invalid = trimmed !== '' && !BRANCH_PATTERN.test(trimmed)

  return (
    <>
      <DialogHeader>
        <DialogTitle>新しいブランチ</DialogTitle>
        <DialogDescription>
          デフォルトブランチ（{defaultBranch}）の最新から分岐し、作成後はそのブランチへ切り替えます
        </DialogDescription>
      </DialogHeader>
      <form
        id="editor-branch-create-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed.length > 0 && !invalid) onCreate(trimmed)
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm text-foreground">
          ブランチ名
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例: kaikou-ch03"
            maxLength={100}
            autoFocus
            disabled={creating}
          />
        </label>
        {invalid && (
          <p className="mt-1.5 text-xs text-destructive">
            ブランチ名は英数字で始まる100字以内（英数字・._/-）で入力してください
          </p>
        )}
      </form>
      <DialogFooter>
        <Button variant="outline" size="sm" disabled={creating} onClick={onCancel}>
          キャンセル
        </Button>
        <Button
          type="submit"
          form="editor-branch-create-form"
          size="sm"
          disabled={creating || trimmed.length === 0 || invalid}
        >
          {creating && <Loader2 data-icon="inline-start" className="animate-spin" />}
          作成して切り替え
        </Button>
      </DialogFooter>
    </>
  )
}
