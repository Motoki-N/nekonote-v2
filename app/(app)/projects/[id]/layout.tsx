import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus } from "@/lib/schemas/enums";
import { Button } from "@/components/ui/button";
import { ChromeHeader } from "@/components/layout/app-chrome";
import { EditProjectButton } from "@/components/projects/edit-project-button";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectStatusBadge } from "@/components/projects/status-badges";

/**
 * プロジェクト配下の共通レイアウト（SPEC-beat-board §3.1）。
 * プロジェクト情報ヘッダー＋タブナビ（企画書 | ビートボード）を描画し、
 * 各ページ（企画書エディタ・ビートボード）はビューポート残り高さの中で各自スクロールする
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: proposal }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, status, event_name, deadline, target_pages, repo, base_path")
      .eq("id", id)
      .maybeSingle(),
    // 構成ボードのタブ文言の出し分けキー（Issue #96・SPEC-outline-board §3.1）
    supabase.from("proposals").select("writing_genre").eq("project_id", id).maybeSingle(),
  ]);
  if (!project) notFound();
  const boardLabel = (proposal?.writing_genre ?? "novel") === "novel" ? "ビートボード" : "目次";

  return (
    <div className="flex h-full flex-col">
      {/* 集中モード中は ChromeHeader がヘッダーを隠す */}
      <ChromeHeader>
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 sm:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="プロジェクト一覧へ戻る"
          className="text-muted-foreground"
          nativeButton={false}
          render={
            <Link href="/projects">
              <ArrowLeft />
            </Link>
          }
        />
        <h1 className="min-w-0 truncate text-base font-bold text-foreground">{project.title}</h1>
        <ProjectStatusBadge status={project.status as ProjectStatus} />
        <EditProjectButton
          project={{
            id: project.id,
            title: project.title,
            status: project.status as ProjectStatus,
            event_name: project.event_name,
            deadline: project.deadline,
            target_pages: project.target_pages,
            repo: project.repo,
            base_path: project.base_path,
          }}
        />
          <div className="ml-auto">
            <ProjectTabs projectId={project.id} boardLabel={boardLabel} />
          </div>
        </header>
      </ChromeHeader>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
