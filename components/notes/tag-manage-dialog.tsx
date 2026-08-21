"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteTag, renameTag } from "@/lib/actions/notes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DEFAULT_SORT, type SortValue } from "@/components/notes/sort-options";

type Tag = { id: string; name: string; kind: string };

function kindLabel(kind: string): string {
  return kind === "working_title" ? "仮タイトル" : "カテゴリ";
}

function buildHref(
  q: string | undefined,
  tagIds: string[],
  sort?: SortValue,
): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tagIds.length > 0) params.set("tags", tagIds.join(","));
  if (sort && sort !== DEFAULT_SORT) params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/notes?${qs}` : "/notes";
}

/** 確認待ちの操作。統合はタグが消えるため、削除と同じく確認を挟む */
type Confirm = "delete" | "merge";

function TagRow({
  tag,
  allTags,
  onRemoved,
}: {
  tag: Tag;
  allTags: Tag[];
  /** タグが消えたことの通知。統合の場合は付け替え先のタグIDを渡す */
  onRemoved: (tagId: string, replacementTagId?: string) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, setPending] = useState(false);

  const trimmed = name.trim();
  const changed = trimmed !== "" && trimmed !== tag.name;
  // 同じ種類に同名タグがあれば、保存は「統合」になる（サーバー側も同じ判定をする）
  const mergeTarget = changed
    ? allTags.find(
        (other) =>
          other.id !== tag.id &&
          other.kind === tag.kind &&
          other.name === trimmed,
      )
    : undefined;

  async function submitRename(allowMerge: boolean) {
    setPending(true);
    try {
      const result = await renameTag(tag.id, trimmed, { allowMerge });
      if (!result.ok) {
        // 表示中のタグ一覧が古く統合先に気づけなかった場合（別画面での作成など）は、
        // サーバーの conflict を受けてここで確認に切り替える
        if (result.error.code === "conflict") {
          setConfirm("merge");
          return;
        }
        toast.error(result.error.message);
        return;
      }
      setConfirm(null);
      if (result.data?.merged) {
        toast(`「${trimmed}」に統合しました`);
        onRemoved(tag.id, result.data.id);
      } else {
        toast("タグ名を変更しました");
      }
    } finally {
      setPending(false);
    }
  }

  async function submitDelete() {
    setPending(true);
    try {
      const result = await deleteTag(tag.id);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setConfirm(null);
      toast("タグを削除しました");
      onRemoved(tag.id);
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-muted-foreground">
          {kindLabel(tag.kind)}
        </span>
        <Input
          value={name}
          disabled={pending}
          onChange={(e) => {
            setName(e.target.value);
            setConfirm(null);
          }}
          aria-label={`${tag.name} のタグ名`}
          maxLength={500}
          className="h-7 text-sm"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!changed || pending}
          onClick={() =>
            mergeTarget ? setConfirm("merge") : submitRename(false)
          }
        >
          保存
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${tag.name} を削除`}
          disabled={pending}
          onClick={() => setConfirm("delete")}
        >
          <Trash2 />
        </Button>
      </div>
      {confirm === "delete" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex-1">
            このタグを全てのノートから外して削除します。元に戻せません（ノート自体は残ります）
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setConfirm(null)}
          >
            キャンセル
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={submitDelete}
          >
            削除する
          </Button>
        </div>
      )}
      {confirm === "merge" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {/* 統合先の名前は入力値そのもの（同じ種類・同じ名前のタグ）なので trimmed を使う */}
          <span className="flex-1">
            同じ種類に「{trimmed}
            」があります。統合すると、このタグが付いたノートは「
            {trimmed}」に付け替わり、このタグは消えます
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setConfirm(null)}
          >
            キャンセル
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => submitRename(true)}
          >
            統合する
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * タグの改名・削除・統合ダイアログ（Issue #200）。
 * 一覧のタグチップの隣から開く（SPEC-notes §3.4）
 */
export function TagManageDialog({
  tags,
  selectedTagIds,
  q,
  sort,
}: {
  tags: Tag[];
  selectedTagIds: string[];
  q?: string;
  sort?: SortValue;
}) {
  const router = useRouter();

  // 絞り込み中のタグが消えた場合、存在しないIDでの絞り込みが残らないようURLを直す。
  // 統合ならノートは統合先に付け替わっているので、絞り込みも統合先へ引き継ぐ
  function handleRemoved(tagId: string, replacementTagId?: string) {
    if (!selectedTagIds.includes(tagId)) return;
    const remaining = selectedTagIds.filter((id) => id !== tagId);
    const nextIds =
      replacementTagId && !remaining.includes(replacementTagId)
        ? [...remaining, replacementTagId]
        : remaining;
    router.replace(buildHref(q, nextIds, sort));
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="タグを編集"
            title="タグを編集"
            className="text-muted-foreground"
          >
            <Pencil />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>タグを編集</DialogTitle>
          <DialogDescription>
            名前を変えて保存できます。同じ種類の既存タグと同じ名前にすると、そのタグへ統合されます
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {tags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              allTags={tags}
              onRemoved={handleRemoved}
            />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
