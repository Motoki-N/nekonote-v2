'use client'

import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createEditorPullRequest } from '@/lib/actions/editor'
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
import { Textarea } from '@/components/ui/textarea'

/**
 * Pull Request 作成ダイアログ（SPEC-vertical-editor-phase5 §3.3）。
 * head=現在ブランチ・base=デフォルトブランチ固定。マージ・レビューはGitHub側で行う。
 * フォームは閉じるとアンマウントされるため、開くたびに初期値へ戻る
 */
export function PrCreateDialog({
  projectId,
  branch,
  defaultBranch,
  open,
  onOpenChange,
}: {
  projectId: string
  branch: string
  defaultBranch: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <PrCreateForm
          projectId={projectId}
          branch={branch}
          defaultBranch={defaultBranch}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function PrCreateForm({
  projectId,
  branch,
  defaultBranch,
  onClose,
}: {
  projectId: string
  branch: string
  defaultBranch: string
  onClose: () => void
}) {
  const [title, setTitle] = useState(`原稿: ${branch} の変更`)
  const [body, setBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ number: number; url: string } | null>(null)

  const submit = async () => {
    setCreating(true)
    try {
      const result = await createEditorPullRequest(projectId, {
        branch,
        title: title.trim(),
        body,
      })
      if (!result.ok || !result.data) {
        toast.error(result.ok ? 'Pull Request の作成に失敗しました' : result.error.message)
        return
      }
      setCreated(result.data)
      toast.success(`Pull Request #${result.data.number} を作成しました`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Pull Request を作成</DialogTitle>
        <DialogDescription>
          {branch} → {defaultBranch} のPRを作成します。マージはGitHub側で行ってください
        </DialogDescription>
      </DialogHeader>

      {created === null ? (
        <form
          id="editor-pr-create-form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim().length > 0) void submit()
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            タイトル
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              autoFocus
              disabled={creating}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            本文（任意）
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              maxLength={5000}
              disabled={creating}
            />
          </label>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground">Pull Request #{created.number} を作成しました。</p>
          <a
            href={created.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" />
            GitHubでひらく（レビュー・マージ）
          </a>
        </div>
      )}

      <DialogFooter>
        {created === null ? (
          <>
            <Button variant="outline" size="sm" disabled={creating} onClick={onClose}>
              キャンセル
            </Button>
            <Button
              type="submit"
              form="editor-pr-create-form"
              size="sm"
              disabled={creating || title.trim().length === 0}
            >
              {creating && <Loader2 data-icon="inline-start" className="animate-spin" />}
              作成
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onClose}>
            閉じる
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
