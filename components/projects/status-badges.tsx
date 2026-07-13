import { BadgeCheck } from "lucide-react";

import type { ProjectStatus, ProposalStatus } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "企画中",
  writing: "執筆中",
  editing: "推敲中",
  completed: "完成",
};

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "下書き",
  in_review: "レビュー中",
  approved: "承認済み",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant={status === "completed" ? "default" : "secondary"}>
      {PROJECT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** 企画書ステータス。承認済みはレビューゲート通過の記章として塗りで目立たせる */
export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  if (status === "approved") {
    return (
      <Badge variant="default">
        <BadgeCheck data-icon="inline-start" />
        企画承認済み
      </Badge>
    );
  }
  return <Badge variant="outline">企画: {PROPOSAL_STATUS_LABEL[status]}</Badge>;
}
