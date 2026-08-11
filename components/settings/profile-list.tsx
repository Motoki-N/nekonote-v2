"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createReviewProfile,
  deleteReviewProfile,
  duplicateReviewProfile,
  updateReviewProfile,
  type PersonaRecord,
  type ReviewProfileRecord,
} from "@/lib/actions/settings";
import {
  targetPhases,
  writingGenres,
  type TargetPhase,
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
  TARGET_PHASE_LABEL,
  genreScopeLabel,
  selectClass,
} from "@/components/settings/labels";

/**
 * レビュープロファイル管理（SPEC-dashboard-critique-settings §3.4）。
 * 標準は閲覧＋「複製」のみ、ユーザー行は編集・削除。
 * 担当（default_persona_id）に選べるのは reviewer 型のペルソナのみ
 */
export function ProfileList({
  profiles,
  personas,
}: {
  profiles: ReviewProfileRecord[];
  /** 全ペルソナ（reviewer 絞り込みと担当名表示に使う） */
  personas: PersonaRecord[];
}) {
  const router = useRouter();
  const personaName = (id: string | null) =>
    id === null ? null : (personas.find((p) => p.id === id)?.name ?? null);

  async function handleDuplicate(profile: ReviewProfileRecord) {
    const result = await duplicateReviewProfile(profile.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast(`「${profile.name}」を複製しました`);
    router.refresh();
  }

  async function handleDelete(profile: ReviewProfileRecord) {
    const result = await deleteReviewProfile(profile.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast(`「${profile.name}」を削除しました`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <ProfileDialog
          personas={personas}
          trigger={
            <Button size="sm" variant="outline">
              <Plus data-icon="inline-start" />
              新規プロファイル
            </Button>
          }
        />
      </div>
      <ul className="flex flex-col gap-2">
        {profiles.map((profile) => (
          <li
            key={profile.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-card-foreground">
                  {profile.name}
                </span>
                {profile.is_default && <Badge variant="secondary">標準</Badge>}
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>対象: {TARGET_PHASE_LABEL[profile.target_phase]}</span>
                <span>ジャンル: {genreScopeLabel(profile.writing_genre)}</span>
                <span>
                  担当:{" "}
                  {personaName(profile.default_persona_id) ?? "（既定なし）"}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              {profile.is_default ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${profile.name}を複製`}
                  className="text-muted-foreground"
                  onClick={() => void handleDuplicate(profile)}
                >
                  <Copy />
                </Button>
              ) : (
                <>
                  <ProfileDialog
                    profile={profile}
                    personas={personas}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${profile.name}を編集`}
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
                          aria-label={`${profile.name}を削除`}
                          className="text-muted-foreground"
                        >
                          <Trash2 />
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          「{profile.name}」を削除しますか？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          このプロファイルで実行したレビュー履歴は削除されずに残ります。この操作は元に戻せません。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => void handleDelete(profile)}
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

/** レビュープロファイルの新規作成・編集ダイアログ（profile 省略時は新規） */
function ProfileDialog({
  profile,
  personas,
  trigger,
}: {
  profile?: ReviewProfileRecord;
  personas: PersonaRecord[];
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile?.name ?? "");
  const [targetPhase, setTargetPhase] = useState<TargetPhase>(
    profile?.target_phase ?? "proposal",
  );
  const [promptTemplate, setPromptTemplate] = useState(
    profile?.prompt_template ?? "",
  );
  const [defaultPersonaId, setDefaultPersonaId] = useState(
    profile?.default_persona_id ?? "",
  );
  // "" = 全ジャンル共通（writing_genre null。SPEC-genre-profiles）
  const [writingGenre, setWritingGenre] = useState<WritingGenre | "">(
    profile?.writing_genre ?? "",
  );
  const [submitting, setSubmitting] = useState(false);

  const reviewerPersonas = personas.filter(
    (p) => p.persona_type === "reviewer",
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const input = {
        name: name.trim(),
        target_phase: targetPhase,
        prompt_template: promptTemplate,
        default_persona_id: defaultPersonaId === "" ? null : defaultPersonaId,
        writing_genre: writingGenre === "" ? null : writingGenre,
      };
      const result = profile
        ? await updateReviewProfile(profile.id, input)
        : await createReviewProfile(input);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setOpen(false);
      toast(
        profile ? "プロファイルを更新しました" : "プロファイルを作成しました",
      );
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {profile ? "プロファイルを編集" : "新規プロファイル"}
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
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              対象フェーズ
              <select
                className={selectClass}
                value={targetPhase}
                onChange={(e) => setTargetPhase(e.target.value as TargetPhase)}
              >
                {targetPhases.map((phase) => (
                  <option key={phase} value={phase}>
                    {TARGET_PHASE_LABEL[phase]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              担当ペルソナ
              <select
                className={selectClass}
                value={defaultPersonaId}
                onChange={(e) => setDefaultPersonaId(e.target.value)}
              >
                <option value="">（既定なし）</option>
                {reviewerPersonas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
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
          <label className="flex flex-col gap-1 text-sm">
            プロンプト（レビュー観点の本文）
            <Textarea
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              className="max-h-72 min-h-48 text-sm"
              required
            />
          </label>
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                submitting || name.trim() === "" || promptTemplate.trim() === ""
              }
            >
              {profile ? "保存する" : "作成する"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
