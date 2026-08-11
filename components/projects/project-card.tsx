"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, FileText, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteProject } from "@/lib/actions/projects";
import type { ProjectStatus, ProposalStatus } from "@/lib/schemas/enums";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  EditProjectDialog,
  type ProjectFormValues,
} from "@/components/projects/project-form-dialog";
import {
  ProjectStatusBadge,
  ProposalStatusBadge,
} from "@/components/projects/status-badges";

export type ProjectListItem = ProjectFormValues & {
  status: ProjectStatus;
  proposalStatus: ProposalStatus | null;
};

const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" });

export function ProjectCard({ project }: { project: ProjectListItem }) {
  const router = useRouter();

  async function handleDelete() {
    const result = await deleteProject(project.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast("プロジェクトを削除しました");
    router.refresh();
  }

  return (
    <li className="group relative rounded-lg border border-border bg-card transition-colors hover:bg-muted/50">
      <Link href={`/projects/${project.id}`} className="block p-4">
        <div className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2 pr-16">
            <span className="font-medium text-card-foreground">
              {project.title}
            </span>
            <ProjectStatusBadge status={project.status} />
            {project.proposalStatus && (
              <ProposalStatusBadge status={project.proposalStatus} />
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {project.event_name && <span>{project.event_name}</span>}
            {project.deadline && (
              <span className="flex items-center gap-1">
                <CalendarDays className="size-3" />
                {dateFormat.format(new Date(project.deadline))}
              </span>
            )}
            {project.target_pages !== null && (
              <span className="flex items-center gap-1">
                <FileText className="size-3" />
                {project.target_pages}ページ目標
              </span>
            )}
          </span>
        </div>
      </Link>
      <span className="absolute top-3 right-3 flex gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        <EditProjectDialog
          project={project}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="プロジェクトを編集"
              className="text-muted-foreground"
            >
              <Pencil />
            </Button>
          }
        />
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="プロジェクトを削除"
                className="text-muted-foreground"
              >
                <Trash2 />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                「{project.title}」を削除しますか？
              </AlertDialogTitle>
              <AlertDialogDescription>
                企画書・ノート紐づけ・レビュー履歴もすべて削除されます（紐づけたノート自体は残ります）。この操作は元に戻せません。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>
                削除する
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
    </li>
  );
}
