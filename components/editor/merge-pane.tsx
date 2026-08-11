"use client";

import { useEffect, useRef } from "react";
import { GitMerge, Info } from "lucide-react";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Button } from "@/components/ui/button";

/**
 * 競合時のマージ支援（SPEC-vertical-editor-phase2 §8）。
 * 左=リモート最新（読み取り専用）・右=ローカル編集。チャンク単位でリモートから取り込みつつ
 * 右ペインを直接編集して手動マージする。自動マージはしない
 */
export function MergePane({
  remoteContent,
  localContent,
  onAdopt,
  onDiscardLocal,
}: {
  remoteContent: string;
  localContent: string;
  /** マージ結果（右ペインの内容）を編集に取り込み、リモートSHAを新しい基準にする */
  onAdopt: (merged: string) => void;
  /** ローカル編集を破棄してリモート最新を開き直す */
  onDiscardLocal: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const shared = [
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "14px",
          backgroundColor: "var(--background)",
          color: "var(--foreground)",
        },
        ".cm-content": { fontFamily: "var(--font-sans)", lineHeight: "1.8" },
      }),
    ];
    const view = new MergeView({
      a: {
        doc: remoteContent,
        extensions: [
          ...shared,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      },
      b: { doc: localContent, extensions: shared },
      parent: containerRef.current,
      revertControls: "a-to-b",
      highlightChanges: true,
      gutter: true,
    });
    mergeRef.current = view;
    return () => {
      view.destroy();
      mergeRef.current = null;
    };
  }, [remoteContent, localContent]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">原稿がリモートで更新されています</p>
          <p className="text-xs">
            左がリモートの最新、右があなたの編集です。矢印ボタンでリモートの変更を取り込むか、
            右ペインを直接編集して手動でマージしてください
          </p>
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 border-b border-border text-xs text-muted-foreground">
        <span className="border-r border-border px-4 py-1.5">
          リモート（最新）
        </span>
        <span className="px-4 py-1.5">あなたの編集（マージ結果）</span>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto [&_.cm-mergeView]:h-full"
      />
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2">
        <Button variant="outline" size="sm" onClick={onDiscardLocal}>
          自分の編集を破棄してリモートを開く
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const merged = mergeRef.current?.b.state.doc.toString();
            if (merged !== undefined) onAdopt(merged);
          }}
        >
          <GitMerge data-icon="inline-start" />
          マージ結果を編集に取り込む
        </Button>
      </div>
    </div>
  );
}
