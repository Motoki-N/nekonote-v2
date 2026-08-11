"use client";

import { FilePlus2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type Template = {
  id: string;
  name: string;
  content: string;
  tag_name: string | null;
};

/** テンプレート挿入メニュー（プロットに落とし込む）。挿入処理は親（エディタ）が担う */
export function TemplateMenu({
  templates,
  onInsert,
}: {
  templates: Template[];
  onInsert: (template: Template) => void;
}) {
  if (templates.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <FilePlus2 data-icon="inline-start" />
            テンプレート
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {templates.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onClick={() => onInsert(template)}
          >
            {template.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
