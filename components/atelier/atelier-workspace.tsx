"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { listIllustrations } from "@/lib/actions/illustrations";
import type { IllustrationItem } from "@/lib/schemas/illustration";
import { Button } from "@/components/ui/button";
import { AtelierGallery } from "@/components/atelier/atelier-gallery";
import { RequestFlow } from "@/components/atelier/request-flow";

export type AtelierProject = {
  id: string;
  title: string;
  hasRepo: boolean;
};

// Input と同じトーンの select（shadcn select 未導入のため。project-form-dialog と同じ流儀）
export const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

// プロジェクト切替中（projectId 不一致）を「読み込み中」として扱うための束
// （effect は fetch のみ・setState はコールバック内に限定する lint 規約に合わせた形）
type LoadedGallery = {
  projectId: string;
  items: IllustrationItem[];
  error: string | null;
};

/**
 * アトリエの本体（SPEC-illustrator §4.1）。
 * プロジェクトセレクタ＋依頼フロー（主）＋ギャラリー（従）。lg未満は縦積み
 */
export function AtelierWorkspace({
  projects,
  initialProjectId,
}: {
  projects: AtelierProject[];
  initialProjectId: string | null;
}) {
  const [projectId, setProjectId] = useState<string | null>(
    initialProjectId ?? projects[0]?.id ?? null,
  );
  const [loaded, setLoaded] = useState<LoadedGallery | null>(null);
  // 参照画像（編集依頼・キャラ一貫性）。ギャラリーの「参照にして依頼」で設定される
  const [reference, setReference] = useState<IllustrationItem | null>(null);
  // 削除されたイラストid（依頼フロー側の生成結果パネルの後始末用）
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);
  // 生成のたびに増やして一覧を取り直すためのトリガー（署名URLの鮮度もこれで保たれる）
  const [reloadKey, setReloadKey] = useState(0);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void listIllustrations(projectId).then((result) => {
      if (cancelled) return;
      setLoaded({
        projectId,
        items: result.ok && result.data ? result.data : [],
        error: result.ok ? null : result.error.message,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  // projectId と一致しない loaded は古い（切替直後）＝読み込み中扱い
  const gallery = loaded && loaded.projectId === projectId ? loaded : null;

  const handleGenerated = useCallback((item: IllustrationItem) => {
    setLoaded((prev) =>
      prev && prev.projectId === item.projectId
        ? { ...prev, items: [item, ...prev.items] }
        : prev,
    );
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setLoaded((prev) =>
      prev ? { ...prev, items: prev.items.filter((item) => item.id !== id) } : prev,
    );
    setReference((prev) => (prev?.id === id ? null : prev));
    setLastDeletedId(id);
  }, []);

  const handleTitleChanged = useCallback((id: string, title: string) => {
    setLoaded((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) => (item.id === id ? { ...item, title } : item)),
          }
        : prev,
    );
  }, []);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8">
        <p className="text-sm text-card-foreground">まだプロジェクトがありません。</p>
        <p className="text-sm text-muted-foreground">
          イラストの依頼はプロジェクト単位で行います。まずはプロジェクトをつくってください。
        </p>
        <Button nativeButton={false} render={<Link href="/projects">プロジェクトをつくる</Link>} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="atelier-project" className="text-sm font-medium text-foreground">
          プロジェクト
        </label>
        <select
          id="atelier-project"
          className={`${selectClass} max-w-72`}
          value={projectId ?? ""}
          onChange={(e) => {
            setProjectId(e.target.value);
            setReference(null);
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      {project && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <RequestFlow
            key={project.id}
            project={project}
            reference={reference}
            deletedId={lastDeletedId}
            onSetReference={setReference}
            onGenerated={(item) => {
              handleGenerated(item);
              // 念のため取り直しもかける（被参照数・署名URLの整合）
              setReloadKey((k) => k + 1);
            }}
          />
          <AtelierGallery
            projectId={project.id}
            items={gallery?.items ?? null}
            error={gallery?.error ?? null}
            onSetReference={setReference}
            onUploaded={handleGenerated}
            onDeleted={handleDeleted}
            onTitleChanged={handleTitleChanged}
          />
        </div>
      )}
    </div>
  );
}
