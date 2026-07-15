'use client'

import { useEffect, useRef } from 'react'

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { buildEditorExtensions } from '@/components/editor/codemirror'

/**
 * 入力ペイン（SPEC-vertical-editor-phase2 §4）。CodeMirror の生成・破棄のみを担い、
 * 内容の変更通知・保存要求は親（vertical-editor）へ委譲する。
 * 別の章を開くときは親が key を変えて作り直す
 */
export function EditorPane({
  initialContent,
  onDocChange,
  onSaveRequest,
}: {
  initialContent: string
  onDocChange: (content: string) => void
  onSaveRequest: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // ハンドラは ref 経由で参照し、親の再レンダーでエディタを作り直さない
  const handlersRef = useRef({ onDocChange, onSaveRequest })
  useEffect(() => {
    handlersRef.current = { onDocChange, onSaveRequest }
  }, [onDocChange, onSaveRequest])

  useEffect(() => {
    if (!containerRef.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: initialContent,
        extensions: buildEditorExtensions({
          onDocChange: (content) => handlersRef.current.onDocChange(content),
          onSaveRequest: () => handlersRef.current.onSaveRequest(),
        }),
      }),
      parent: containerRef.current,
    })
    return () => view.destroy()
    // initialContent は初期値のみ（変更で作り直さない。差し替えは view.dispatch で行う）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="h-full min-h-0" aria-label="本文の入力ペイン" />
}
