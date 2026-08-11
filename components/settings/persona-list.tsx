"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createPersona,
  deletePersona,
  duplicatePersona,
  updatePersona,
  type PersonaRecord,
} from "@/lib/actions/settings";
import {
  aiCapabilities,
  personaTypes,
  referenceScopes,
  writingGenres,
  type AiCapability,
  type PersonaType,
  type ReferenceScope,
  type WritingGenre,
} from "@/lib/schemas/enums";
import { WRITING_GENRE_LABEL } from "@/lib/constants/proposal-template";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CAPABILITY_LABEL,
  PERSONA_TYPE_LABEL,
  REFERENCE_SCOPE_LABEL,
  genreScopeLabel,
  selectClass,
} from "@/components/settings/labels";

/**
 * ペルソナ管理（SPEC-dashboard-critique-settings §3.4）。
 * 標準は閲覧＋「複製」のみ、ユーザー行は編集・削除。編集はダイアログ
 */
export function PersonaList({ personas }: { personas: PersonaRecord[] }) {
  const router = useRouter();

  async function handleDuplicate(persona: PersonaRecord) {
    const result = await duplicatePersona(persona.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast(`「${persona.name}」を複製しました`);
    router.refresh();
  }

  async function handleDelete(persona: PersonaRecord) {
    const result = await deletePersona(persona.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast(`「${persona.name}」を削除しました`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <PersonaDialog
          trigger={
            <Button size="sm" variant="outline">
              <Plus data-icon="inline-start" />
              新規ペルソナ
            </Button>
          }
        />
      </div>
      <ul className="flex flex-col gap-2">
        {personas.map((persona) => (
          <li
            key={persona.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-card-foreground">
                  {persona.name}
                </span>
                {persona.is_default && <Badge variant="secondary">標準</Badge>}
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>{PERSONA_TYPE_LABEL[persona.persona_type]}</span>
                <span>能力: {CAPABILITY_LABEL[persona.ai_capability]}</span>
                <span>
                  参照: {REFERENCE_SCOPE_LABEL[persona.reference_scope]}
                </span>
                <span>ジャンル: {genreScopeLabel(persona.writing_genre)}</span>
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              {persona.is_default ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${persona.name}を複製`}
                  className="text-muted-foreground"
                  onClick={() => void handleDuplicate(persona)}
                >
                  <Copy />
                </Button>
              ) : (
                <>
                  <PersonaDialog
                    persona={persona}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${persona.name}を編集`}
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
                          aria-label={`${persona.name}を削除`}
                          className="text-muted-foreground"
                        >
                          <Trash2 />
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          「{persona.name}」を削除しますか？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          このペルソナを起用したレビュー履歴は削除されずに残ります（担当表示は消えます）。この操作は元に戻せません。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => void handleDelete(persona)}
                        >
                          削除する
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** ペルソナの新規作成・編集ダイアログ（persona 省略時は新規） */
function PersonaDialog({
  persona,
  trigger,
}: {
  persona?: PersonaRecord;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(persona?.name ?? "");
  const [description, setDescription] = useState(persona?.description ?? "");
  const [capability, setCapability] = useState<AiCapability>(
    persona?.ai_capability ?? "medium",
  );
  const [scope, setScope] = useState<ReferenceScope>(
    persona?.reference_scope ?? "all",
  );
  const [personaType, setPersonaType] = useState<PersonaType>(
    persona?.persona_type ?? "reviewer",
  );
  // "" = 全ジャンル共通（writing_genre null。SPEC-genre-profiles）
  const [writingGenre, setWritingGenre] = useState<WritingGenre | "">(
    persona?.writing_genre ?? "",
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const input = {
        name: name.trim(),
        description: description.trim(),
        ai_capability: capability,
        reference_scope: scope,
        persona_type: personaType,
        writing_genre: writingGenre === "" ? null : writingGenre,
      };
      const result = persona
        ? await updatePersona(persona.id, input)
        : await createPersona(input);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setOpen(false);
      toast(persona ? "ペルソナを更新しました" : "ペルソナを作成しました");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {persona ? "ペルソナを編集" : "新規ペルソナ"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            名前（必須）
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            性格・口調・スタンス（プロンプトに反映）
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-40 text-sm"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              能力レベル
              <select
                className={selectClass}
                value={capability}
                onChange={(e) => setCapability(e.target.value as AiCapability)}
              >
                {aiCapabilities.map((c) => (
                  <option key={c} value={c}>
                    {CAPABILITY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              型
              <select
                className={selectClass}
                value={personaType}
                onChange={(e) => setPersonaType(e.target.value as PersonaType)}
              >
                {personaTypes.map((t) => (
                  <option key={t} value={t}>
                    {PERSONA_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              参照範囲
              <select
                className={selectClass}
                value={scope}
                onChange={(e) => setScope(e.target.value as ReferenceScope)}
              >
                {referenceScopes.map((s) => (
                  <option key={s} value={s}>
                    {REFERENCE_SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              対象ジャンル
              <select
                className={selectClass}
                value={writingGenre}
                onChange={(e) =>
                  setWritingGenre(e.target.value as WritingGenre | "")
                }
              >
                <option value="">共通（全ジャンル）</option>
                {writingGenres.map((g) => (
                  <option key={g} value={g}>
                    {WRITING_GENRE_LABEL[g]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                submitting || name.trim() === "" || description.trim() === ""
              }
            >
              {persona ? "保存する" : "作成する"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
