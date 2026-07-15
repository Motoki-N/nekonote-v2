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
 * 保存＝コミットの確認ダイアログ（SPEC-vertical-editor-phase2 §6）。
 * メッセージは自動生成値を初期値として編集できる。
 * フォームは閉じるとアンマウントされるため、開くたびに初期値へ戻る
 */
export function SaveDialog({
  open,
  defaultMessage,
  saving,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  defaultMessage: string
  saving: boolean
  onConfirm: (message: string) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <SaveForm
          defaultMessage={defaultMessage}
          saving={saving}
          onConfirm={onConfirm}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function SaveForm({
  defaultMessage,
  saving,
  onConfirm,
  onCancel,
}: {
  defaultMessage: string
  saving: boolean
  onConfirm: (message: string) => void
  onCancel: () => void
}) {
  const [message, setMessage] = useState(defaultMessage)

  return (
    <>
      <DialogHeader>
        <DialogTitle>保存（コミット）</DialogTitle>
        <DialogDescription>
          この内容でリポジトリのデフォルトブランチにコミットします
        </DialogDescription>
      </DialogHeader>
      <form
        id="editor-save-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (message.trim().length > 0) onConfirm(message.trim())
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm text-foreground">
          コミットメッセージ
          <Input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={200}
            autoFocus
            disabled={saving}
          />
        </label>
      </form>
      <DialogFooter>
        <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
          キャンセル
        </Button>
        <Button
          type="submit"
          form="editor-save-form"
          size="sm"
          disabled={saving || message.trim().length === 0}
        >
          {saving && <Loader2 data-icon="inline-start" className="animate-spin" />}
          コミット
        </Button>
      </DialogFooter>
    </>
  )
}
