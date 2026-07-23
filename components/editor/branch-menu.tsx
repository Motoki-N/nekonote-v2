'use client'

import { useState } from 'react'
import { Check, GitBranch, GitPullRequest, Loader2, Plus } from 'lucide-react'

import { listEditorBranches } from '@/lib/actions/editor'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * ブランチセレクタ（SPEC-vertical-editor-phase5 §3.1）。章一覧サイドバー上部に置き、
 * 切替・新規作成・PR作成の入口をまとめる。一覧は開いたときに遅延取得する
 */
export function BranchMenu({
  projectId,
  branch,
  defaultBranch,
  switching,
  onSwitch,
  onCreateRequest,
  onPrRequest,
}: {
  projectId: string
  branch: string
  defaultBranch: string
  /** 切替中はトリガーを無効化する */
  switching: boolean
  onSwitch: (branch: string) => void
  onCreateRequest: () => void
  onPrRequest: () => void
}) {
  const [branches, setBranches] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadBranches = () => {
    setBranches(null)
    setLoadError(null)
    void listEditorBranches(projectId).then((result) => {
      if (!result.ok || !result.data) {
        setLoadError(result.ok ? 'ブランチ一覧の取得に失敗しました' : result.error.message)
        return
      }
      setBranches(result.data.branches)
    })
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && loadBranches()}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={switching}
            className="w-full justify-start"
            title={`ブランチ: ${branch}`}
          >
            {switching ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <GitBranch data-icon="inline-start" />
            )}
            <span className="min-w-0 truncate">{branch}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        {/* GroupLabel（DropdownMenuLabel）は Menu.Group 内必須（Base UI の制約） */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>ブランチ</DropdownMenuLabel>
        </DropdownMenuGroup>
        {branches === null && loadError === null && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            読み込み中…
          </div>
        )}
        {loadError !== null && (
          <p className="px-2 py-1.5 text-sm text-destructive">{loadError}</p>
        )}
        {branches?.map((name) => (
          <DropdownMenuItem key={name} onClick={() => name !== branch && onSwitch(name)}>
            <span className="flex w-full min-w-0 items-center gap-2">
              {/* 現在ブランチの印（幅は常に確保して名前の頭を揃える） */}
              <Check className={name === branch ? 'size-4 shrink-0' : 'size-4 shrink-0 opacity-0'} />
              <span className="min-w-0 truncate">{name}</span>
              {name === defaultBranch && (
                <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
                  デフォルト
                </span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCreateRequest}>
          <span className="flex items-center gap-2">
            <Plus className="size-4 shrink-0" />
            新しいブランチを作成…
          </span>
        </DropdownMenuItem>
        {/* PRの base はデフォルトブランチ固定のため、デフォルトを開いている間は無効 */}
        <DropdownMenuItem disabled={branch === defaultBranch} onClick={onPrRequest}>
          <span className="flex items-center gap-2">
            <GitPullRequest className="size-4 shrink-0" />
            Pull Request を作成…
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
