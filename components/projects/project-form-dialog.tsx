"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createProject, getNotesByTag, updateProject, type LinkedNote } from "@/lib/actions/projects";
import { projectStatuses, writingGenres, type ProjectStatus, type WritingGenre } from "@/lib/schemas/enums";
import { WRITING_GENRE_LABEL } from "@/lib/constants/proposal-template";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PROJECT_STATUS_LABEL } from "@/components/projects/status-badges";
import { RepoSetupDialog } from "@/components/projects/repo-setup-dialog";

export type WorkingTitleTag = { id: string; name: string };

export type ProjectFormValues = {
  id: string;
  title: string;
  status: ProjectStatus;
  event_name: string | null;
  deadline: string | null;
  target_pages: number | null;
  repo: string | null;
  base_path: string | null;
};

// Input と同じトーンの select（shadcn select 未導入のため。色はテーマ変数のみ）
const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function toNullable(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

/** 新規プロジェクト作成ダイアログ（仮タイトルタグからの一括紐づけ付き。SPEC-proposal-review §3.1） */
export function CreateProjectDialog({ workingTitleTags }: { workingTitleTags: WorkingTitleTag[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [writingGenre, setWritingGenre] = useState<WritingGenre>("novel");
  const [eventName, setEventName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [targetPages, setTargetPages] = useState("");
  const [tagId, setTagId] = useState("");
  const [candidates, setCandidates] = useState<LinkedNote[]>([]);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle("");
    setWritingGenre("novel");
    setEventName("");
    setDeadline("");
    setTargetPages("");
    setTagId("");
    setCandidates([]);
    setCheckedIds(new Set());
  }

  async function handleTagChange(nextTagId: string) {
    setTagId(nextTagId);
    if (!nextTagId) {
      setCandidates([]);
      setCheckedIds(new Set());
      return;
    }
    const result = await getNotesByTag(nextTagId);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    const notes = result.data ?? [];
    setCandidates(notes);
    // タグ付きノートは全チェック済みで提示し、外したいものだけ外す
    setCheckedIds(new Set(notes.map((n) => n.id)));
  }

  function toggleChecked(noteId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await createProject(
        {
          title: title.trim(),
          status: "planning",
          event_name: toNullable(eventName),
          deadline: toNullable(deadline),
          target_pages: targetPages.trim() === "" ? null : Number(targetPages),
        },
        [...checkedIds],
        writingGenre,
      );
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "プロジェクトの作成に失敗しました" : result.error.message);
        return;
      }
      setOpen(false);
      reset();
      router.push(`/projects/${result.data.projectId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm">新規プロジェクト</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新規プロジェクト</DialogTitle>
          <DialogDescription>
            作成すると企画書（定型テンプレ入り）も一緒に用意されます。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            タイトル（必須）
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            執筆ジャンル（企画書のテンプレが変わります）
            <select
              className={selectClass}
              value={writingGenre}
              onChange={(e) => setWritingGenre(e.target.value as WritingGenre)}
            >
              {writingGenres.map((g) => (
                <option key={g} value={g}>
                  {WRITING_GENRE_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            イベント名
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              締切
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              目標ページ数
              <Input
                type="number"
                min={1}
                value={targetPages}
                onChange={(e) => setTargetPages(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            仮タイトルタグからノートを紐づける
            <select
              className={selectClass}
              value={tagId}
              onChange={(e) => void handleTagChange(e.target.value)}
            >
              <option value="">（選択しない）</option>
              {workingTitleTags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  《{tag.name}》
                </option>
              ))}
            </select>
          </label>
          {tagId && (
            <fieldset className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
              <legend className="px-1 text-xs text-muted-foreground">紐づけるノート</legend>
              {candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">このタグの付いたノートはありません</p>
              ) : (
                candidates.map((note) => (
                  <label key={note.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={checkedIds.has(note.id)}
                      onChange={() => toggleChecked(note.id)}
                    />
                    {note.title || "無題"}
                  </label>
                ))
              )}
            </fieldset>
          )}
          <DialogFooter>
            <Button type="submit" disabled={submitting || title.trim() === ""}>
              作成する
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** プロジェクト編集ダイアログ（タイトル・status・イベント・締切・目標ページ数） */
export function EditProjectDialog({
  project,
  trigger,
}: {
  project: ProjectFormValues;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [eventName, setEventName] = useState(project.event_name ?? "");
  const [deadline, setDeadline] = useState(project.deadline ?? "");
  const [targetPages, setTargetPages] = useState(
    project.target_pages === null ? "" : String(project.target_pages),
  );
  const [repo, setRepo] = useState(project.repo ?? "");
  const [basePath, setBasePath] = useState(project.base_path ?? "");
  const [submitting, setSubmitting] = useState(false);
  // repo の初回設定（未設定→設定）を保存成功後に検出して初期セットアップを提案する（SPEC-repo-setup §3.1）
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupRepo, setSetupRepo] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const nextRepo = toNullable(repo);
      const result = await updateProject(project.id, {
        title: title.trim(),
        status,
        event_name: toNullable(eventName),
        deadline: toNullable(deadline),
        target_pages: targetPages.trim() === "" ? null : Number(targetPages),
        repo: nextRepo,
        base_path: toNullable(basePath),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
      if (!project.repo && nextRepo) {
        setSetupRepo(nextRepo);
        setSetupOpen(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>プロジェクトを編集</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            タイトル（必須）
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            ステータス
            <select
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {projectStatuses.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            イベント名
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              締切
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              目標ページ数
              <Input
                type="number"
                min={1}
                value={targetPages}
                onChange={(e) => setTargetPages(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            原稿リポジトリ（owner/repo）
            <Input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="例: yourname/manuscripts"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            原稿フォルダ（リポジトリ内のパス。空ならルート）
            <Input
              value={basePath}
              onChange={(e) => setBasePath(e.target.value)}
              placeholder="例: novel-title"
            />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={submitting || title.trim() === ""}>
              保存する
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {/* 開くたびに再マウントして初期値（タイトル・slug）を確定させる */}
    {setupOpen && (
      <RepoSetupDialog
        open
        onOpenChange={setSetupOpen}
        projectId={project.id}
        defaultTitle={title.trim() || project.title}
        repoName={setupRepo.split("/")[1] ?? ""}
      />
    )}
    </>
  );
}
