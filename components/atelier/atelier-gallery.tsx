"use client";

import { useRef, useState } from "react";
import {
  Check,
  Download,
  Flag,
  ListChecks,
  Loader2,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  deleteIllustration,
  deleteIllustrations,
  setIllustrationFavorite,
  syncIllustrationPlacements,
  updateIllustrationTitle,
  uploadReferenceImage,
} from "@/lib/actions/illustrations";
import {
  BULK_DELETE_MAX,
  ILLUSTRATION_EXTENSION_BY_MIME,
  ILLUSTRATION_KIND_LABEL,
  ILLUSTRATION_STYLE_LABEL,
  REFERENCE_UPLOAD_MAX_BYTES,
  type IllustrationItem,
} from "@/lib/schemas/illustration";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" });

/** ギャラリーの絞り込み（SPEC §11）。画風での絞り込みは作らない（表示のみ） */
type GalleryFilter = "all" | "favorite" | "placed";

const FILTER_OPTIONS: { value: GalleryFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "favorite", label: "お気に入り" },
  { value: "placed", label: "採用" },
];

function matchesFilter(item: IllustrationItem, filter: GalleryFilter) {
  if (filter === "favorite") return item.isFavorite;
  if (filter === "placed") return item.placedAt !== null;
  return true;
}

/** 署名URLのパス部から拡張子を取り出す（ダウンロードのファイル名用） */
function extensionOf(signedUrl: string): string {
  const match = /\.(\w+)$/.exec(new URL(signedUrl).pathname);
  return match ? match[1] : "png";
}

/** 署名URLはクロスオリジンで download 属性が効かないため、blob 経由で保存する */
async function downloadImage(item: IllustrationItem): Promise<void> {
  const res = await fetch(item.signedUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${item.title}.${extensionOf(item.signedUrl)}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * ギャラリー（SPEC-illustrator §4.4）。
 * グリッド表示＋タイトルのインライン編集＋拡大表示（プロンプト=説明文）＋
 * ダウンロード・削除（被参照は警告）・参照画像にして依頼・参照画像のアップロード（Issue #104）・
 * お気に入り☆と採用⛳の表示・絞り込み、原稿の配置状況の走査（Issue #328）・
 * 選択モードでの一括削除（Issue #332。採用⛳は選択不可）
 */
export function AtelierGallery({
  projectId,
  hasRepo,
  items,
  error,
  onSetReference,
  onUploaded,
  onDeleted,
  onTitleChanged,
  onFavoriteChanged,
  onPlacementsSynced,
}: {
  projectId: string;
  /** 原稿リポジトリが設定済みか（配置状況の走査ボタンの有効/無効） */
  hasRepo: boolean;
  /** null = 読み込み中 */
  items: IllustrationItem[] | null;
  error: string | null;
  onSetReference: (item: IllustrationItem) => void;
  onUploaded: (item: IllustrationItem) => void;
  onDeleted: (ids: string[]) => void;
  onTitleChanged: (id: string, title: string) => void;
  onFavoriteChanged: (id: string, isFavorite: boolean) => void;
  /** 走査で⛳が変わったとき（一覧を取り直す） */
  onPlacementsSynced: () => void;
}) {
  const [zoomed, setZoomed] = useState<IllustrationItem | null>(null);
  const [deleting, setDeleting] = useState<IllustrationItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<GalleryFilter>("all");
  // 選択モード（Issue #332）。選択はidで持ち、表示・送信時は現在の一覧と突き合わせる
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visibleItems = items?.filter((item) => matchesFilter(item, filter));
  // 採用⛳は一括削除の対象外（Issue #332）
  const selectableItems = (visibleItems ?? []).filter(
    (item) => item.placedAt === null,
  );
  // 選択後に☆を外して絞り込みから外れた・走査で⛳が付いた画像は対象にしない（見えない画像を消さない）
  const selectedItems = selectableItems.filter((item) =>
    selectedIds.has(item.id),
  );
  const overLimit = selectedItems.length > BULK_DELETE_MAX;

  function handleChangeFilter(next: GalleryFilter) {
    setFilter(next);
    // 見えない画像を選んだまま消す事故を防ぐため、絞り込みの切り替えで選択を解除する
    setSelectedIds(new Set());
  }

  function exitSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(item: IllustrationItem) {
    if (item.placedAt !== null) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = selectedItems.map((item) => item.id);
    setBulkDeleting(true);
    try {
      const result = await deleteIllustrations(ids);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "削除に失敗しました" : result.error.message);
        return;
      }
      const { deletedIds, failed, skipped } = result.data;
      if (deletedIds.length > 0) onDeleted(deletedIds);
      // 消せなかった画像は選択したまま残し、そのまま再試行できるようにする
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of deletedIds) next.delete(id);
        return next;
      });
      const skippedNote =
        skipped > 0 ? `（採用中の${skipped}件は除外しました）` : "";
      if (failed > 0) {
        toast.error(
          `${deletedIds.length}件削除・${failed}件失敗しました${skippedNote}`,
        );
      } else {
        toast(`${deletedIds.length}件のイラストを削除しました${skippedNote}`);
      }
    } catch {
      toast.error("削除に失敗しました。通信環境を確認してください");
    } finally {
      setBulkDeleting(false);
      setConfirmingBulk(false);
    }
  }

  async function handleToggleFavorite(item: IllustrationItem) {
    const next = !item.isFavorite;
    setBusyId(item.id);
    try {
      const result = await setIllustrationFavorite(item.id, next);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onFavoriteChanged(item.id, next);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSyncPlacements() {
    setSyncing(true);
    try {
      const result = await syncIllustrationPlacements(projectId);
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "配置状況の更新に失敗しました" : result.error.message,
        );
        return;
      }
      const { added, removed } = result.data;
      toast(
        added === 0 && removed === 0
          ? "採用マークに変更はありません"
          : `採用マークを更新しました（${added}件追加・${removed}件解除）`,
      );
      if (added > 0 || removed > 0) onPlacementsSynced();
    } catch {
      toast.error("配置状況の更新に失敗しました。通信環境を確認してください");
    } finally {
      setSyncing(false);
    }
  }

  async function handleUpload(file: File) {
    // Server Action の bodySizeLimit（15mb）超過はアクション到達前に reject され
    // サーバー側の検証文言が出せないため、サイズはクライアントでも先に検査する
    if (file.size > REFERENCE_UPLOAD_MAX_BYTES) {
      toast.error("ファイルサイズは10MB以下にしてください");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadReferenceImage(projectId, formData);
      if (!result.ok || !result.data) {
        toast.error(
          result.ok ? "アップロードに失敗しました" : result.error.message,
        );
        return;
      }
      onUploaded(result.data);
      toast("参照画像をアップロードしました");
    } catch {
      toast.error("アップロードに失敗しました。通信環境を確認してください");
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveTitle(item: IllustrationItem) {
    const title = editingTitle.trim();
    if (title === "" || title === item.title) {
      setEditingId(null);
      return;
    }
    setBusyId(item.id);
    try {
      const result = await updateIllustrationTitle(item.id, title);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onTitleChanged(item.id, title);
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(item: IllustrationItem) {
    setBusyId(item.id);
    try {
      const result = await deleteIllustration(item.id);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onDeleted([item.id]);
      toast("イラストを削除しました");
    } finally {
      setBusyId(null);
      setDeleting(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-card-foreground">
          ギャラリー
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {items !== null && items.length > 0 && (
            <Button
              size="sm"
              variant={selecting ? "secondary" : "outline"}
              aria-pressed={selecting}
              onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
            >
              <ListChecks data-icon="inline-start" />
              選択
            </Button>
          )}
          {/* 参照画像のアップロード（Issue #104）。絵柄・キャラの統一に使う外部画像を取り込む */}
          <input
            ref={fileInputRef}
            type="file"
            accept={Object.keys(ILLUSTRATION_EXTENSION_BY_MIME).join(",")}
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // 同じファイルの再選択でも change を発火させる
              if (file) void handleUpload(file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            参照画像をアップロード
          </Button>
          {/* 既定ブランチの原稿を読み直して採用⛳を補正する（Issue #328） */}
          <Button
            size="sm"
            variant="outline"
            disabled={syncing || !hasRepo}
            title={
              hasRepo
                ? "既定ブランチの原稿を読み、採用マークを付け直します"
                : "原稿リポジトリが設定されていません"
            }
            onClick={() => void handleSyncPlacements()}
          >
            {syncing ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            原稿の配置状況を更新
          </Button>
        </div>
      </div>

      {items !== null && items.length > 0 && (
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="絞り込み"
        >
          {FILTER_OPTIONS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "secondary" : "ghost"}
              aria-pressed={filter === option.value}
              onClick={() => handleChangeFilter(option.value)}
            >
              {option.label}
              <span className="text-xs text-muted-foreground">
                {
                  items.filter((item) => matchesFilter(item, option.value))
                    .length
                }
              </span>
            </Button>
          ))}
        </div>
      )}

      {/* 選択モードの操作バー（Issue #332） */}
      {selecting && items !== null && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 p-2">
          <span className="text-sm text-card-foreground">
            {selectedItems.length}件選択中
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={selectableItems.length === 0}
            onClick={() =>
              setSelectedIds(new Set(selectableItems.map((item) => item.id)))
            }
          >
            表示中をすべて選択
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={selectedItems.length === 0}
            onClick={() => setSelectedIds(new Set())}
          >
            選択解除
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {overLimit && (
              <span className="text-xs text-destructive">
                一度に削除できるのは{BULK_DELETE_MAX}件までです
              </span>
            )}
            <Button
              size="sm"
              variant="destructive"
              disabled={selectedItems.length === 0 || overLimit || bulkDeleting}
              onClick={() => setConfirmingBulk(true)}
            >
              {bulkDeleting ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              まとめて削除
            </Button>
            <Button size="sm" variant="outline" onClick={exitSelecting}>
              完了
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : items === null ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" />
          読み込み中…
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col gap-2 py-6 text-center">
          <p className="text-sm text-card-foreground">
            まだイラストがありません。
          </p>
          <p className="text-sm text-muted-foreground">
            イラストレーターが原稿と設定資料を読み、表紙・挿絵・キャラクター・コンセプトアートを
            描きます。左のフォームから最初の依頼をどうぞ。
          </p>
        </div>
      ) : visibleItems && visibleItems.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filter === "favorite"
            ? "お気に入りのイラストはまだありません。☆で印を付けられます。"
            : "原稿に採用されたイラストはまだありません。"}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(visibleItems ?? []).map((item) => (
            <li
              key={item.id}
              className={`relative flex flex-col gap-2 rounded-md border p-2 ${
                selecting && item.placedAt === null && selectedIds.has(item.id)
                  ? "border-primary ring-2 ring-primary"
                  : "border-border"
              }`}
            >
              {selecting && (
                <input
                  type="checkbox"
                  checked={item.placedAt === null && selectedIds.has(item.id)}
                  disabled={item.placedAt !== null}
                  title={
                    item.placedAt !== null
                      ? "原稿に採用されている画像はまとめて削除できません"
                      : undefined
                  }
                  aria-label={`${item.title} を選択`}
                  onChange={() => toggleSelected(item)}
                  className="absolute top-4 left-4 z-10 size-5 accent-[var(--primary)]"
                />
              )}
              <button
                type="button"
                onClick={() =>
                  selecting ? toggleSelected(item) : setZoomed(item)
                }
                aria-label={
                  selecting
                    ? `${item.title} の選択を切り替え`
                    : `${item.title} を拡大表示`
                }
                // 選択モード中の操作はチェックボックスに集約し、画像はポインタ操作の補助にとどめる
                tabIndex={selecting ? -1 : undefined}
                className={`overflow-hidden rounded ${
                  selecting && item.placedAt !== null
                    ? "cursor-not-allowed opacity-60"
                    : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 署名URL（短寿命・外部最適化不可）のため素の img を使う */}
                <img
                  src={item.signedUrl}
                  alt={item.title}
                  loading="lazy"
                  className="h-44 w-full object-cover transition-transform hover:scale-105"
                />
              </button>

              <div className="flex items-center gap-1">
                {editingId === item.id ? (
                  <>
                    <Input
                      value={editingTitle}
                      autoFocus
                      disabled={busyId === item.id}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveTitle(item);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-7 flex-1 text-sm"
                      aria-label="タイトルを編集"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="タイトルを保存"
                      disabled={busyId === item.id}
                      onClick={() => void handleSaveTitle(item)}
                    >
                      <Check />
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-card-foreground">
                      {item.title}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${item.title} のタイトルを編集`}
                      className="text-muted-foreground"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditingTitle(item.title);
                      }}
                    >
                      <Pencil />
                    </Button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary">
                  {ILLUSTRATION_KIND_LABEL[item.kind]}
                </Badge>
                {item.placedAt !== null && (
                  <Badge
                    variant="outline"
                    title="既定ブランチの原稿に載っています"
                  >
                    <Flag />
                    採用
                  </Badge>
                )}
                {item.style !== null && (
                  <span className="text-xs text-muted-foreground">
                    {ILLUSTRATION_STYLE_LABEL[item.style]}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {dateFormat.format(new Date(item.createdAt))}
                </span>
                <div className="ml-auto flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      item.isFavorite
                        ? `${item.title} をお気に入りから外す`
                        : `${item.title} をお気に入りにする`
                    }
                    aria-pressed={item.isFavorite}
                    className={
                      item.isFavorite ? "text-primary" : "text-muted-foreground"
                    }
                    disabled={busyId === item.id}
                    onClick={() => void handleToggleFavorite(item)}
                  >
                    <Star className={item.isFavorite ? "fill-current" : ""} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${item.title} をダウンロード`}
                    className="text-muted-foreground"
                    onClick={() => {
                      void downloadImage(item).catch(() =>
                        toast.error("ダウンロードに失敗しました"),
                      );
                    }}
                  >
                    <Download />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${item.title} を削除`}
                    className="text-muted-foreground"
                    disabled={busyId === item.id}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => onSetReference(item)}
              >
                参照画像にして依頼
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 拡大表示: プロンプトを説明文として添える（SPEC §4.4） */}
      <Dialog
        open={zoomed !== null}
        onOpenChange={(open) => !open && setZoomed(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          {zoomed && (
            <>
              <DialogHeader>
                <DialogTitle>{zoomed.title}</DialogTitle>
                <DialogDescription>
                  {ILLUSTRATION_KIND_LABEL[zoomed.kind]}・
                  {zoomed.style !== null &&
                    `${ILLUSTRATION_STYLE_LABEL[zoomed.style]}・`}
                  {dateFormat.format(new Date(zoomed.createdAt))}
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element -- 署名URLのため素の img を使う */}
              <img
                src={zoomed.signedUrl}
                alt={zoomed.title}
                className="max-h-[60vh] w-full rounded object-contain"
              />
              {/* アップロード参照画像（kind 'reference'）にはプロンプトがない */}
              {zoomed.prompt !== "" && (
                <div className="max-h-32 overflow-y-auto rounded-md bg-muted/50 p-2">
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {zoomed.prompt}
                  </p>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 削除確認: 被参照なら警告を添える（SPEC §2） */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>イラストを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.title}
              」を完全に削除します。この操作は取り消せません。
              {deleting && deleting.referencedCount > 0 && (
                <>
                  <br />
                  このイラストは他の{deleting.referencedCount}
                  枚の参照元になっています（削除しても参照した画像は残ります）。
                </>
              )}
              {deleting?.placedImagePath && (
                <>
                  <br />
                  このイラストは原稿リポジトリにコピー済みです（
                  {deleting.placedImagePath}
                  ）。削除してもリポジトリ内のコピーと原稿の挿入記法は残ります。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void handleDelete(deleting)}
              disabled={busyId !== null}
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 一括削除の確認: 選択に含まれる注意点を件数で添える（Issue #332） */}
      <AlertDialog
        open={confirmingBulk}
        onOpenChange={(open) => !open && setConfirmingBulk(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedItems.length}件のイラストを削除しますか？
            </AlertDialogTitle>
            <AlertDialogDescription>
              選択したイラストを完全に削除します。この操作は取り消せません。
              {selectedItems.some((item) => item.isFavorite) && (
                <>
                  <br />
                  お気に入りのイラストが
                  {selectedItems.filter((item) => item.isFavorite).length}
                  件含まれています。
                </>
              )}
              {selectedItems.some((item) => item.referencedCount > 0) && (
                <>
                  <br />
                  他の画像の参照元になっているイラストが
                  {
                    selectedItems.filter((item) => item.referencedCount > 0)
                      .length
                  }
                  件含まれています（削除しても参照した画像は残ります）。
                </>
              )}
              {selectedItems.some((item) => item.placedImagePath) && (
                <>
                  <br />
                  原稿リポジトリにコピー済みのイラストが
                  {selectedItems.filter((item) => item.placedImagePath).length}
                  件含まれています（削除してもリポジトリ内のコピーと原稿の挿入記法は残ります）。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleBulkDelete()}
              disabled={bulkDeleting}
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
