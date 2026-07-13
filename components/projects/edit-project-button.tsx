"use client";

import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EditProjectDialog,
  type ProjectFormValues,
} from "@/components/projects/project-form-dialog";

/**
 * プロジェクト編集ボタン＋ダイアログ。
 * トリガーのJSXをサーバーコンポーネント（layout）から渡すと Base UI の
 * DialogTrigger で hydration ミスマッチになるため、クライアント側で組み立てる
 */
export function EditProjectButton({ project }: { project: ProjectFormValues }) {
  return (
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
  );
}
