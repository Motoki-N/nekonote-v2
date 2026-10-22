"use client";

import { useEffect, useState } from "react";
import { Flag, Loader2, Star } from "lucide-react";

import { listIllustrations } from "@/lib/actions/illustrations";
import {
  ILLUSTRATION_KIND_LABEL,
  ILLUSTRATION_STYLE_LABEL,
  type IllustrationItem,
} from "@/lib/schemas/illustration";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Loaded = { items: IllustrationItem[]; error: string | null };

/**
 * 原稿へ挿入するアトリエのイラストを選ぶ（SPEC-illustrator §11）。
 * 開くたびにマウントされる前提（親が open のときだけ描画する）＝毎回一覧と署名URLを取り直す。
 * アップロード参照画像（kind 'reference'）は「アトリエで生成した画像」ではないので出さない
 */
export function AtelierPickDialog({
  projectId,
  onPick,
  onClose,
}: {
  projectId: string;
  onPick: (item: IllustrationItem) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listIllustrations(projectId)
      .then((result) => {
        if (cancelled) return;
        setLoaded({
          items:
            result.ok && result.data
              ? result.data.filter((item) => item.kind !== "reference")
              : [],
          error: result.ok ? null : result.error.message,
        });
      })
      .catch(() => {
        // 通信エラー等で reject されても「読み込み中」のまま止めない
        if (cancelled) return;
        setLoaded({
          items: [],
          error: "一覧の取得に失敗しました。通信環境を確認してください",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const visible = loaded?.items.filter(
    (item) => !favoritesOnly || item.isFavorite,
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>アトリエから挿入</DialogTitle>
          <DialogDescription>
            選んだイラストを images/
            へコピーしてコミットし、カーソル位置に挿入記法を追記します
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={favoritesOnly ? "ghost" : "secondary"}
            aria-pressed={!favoritesOnly}
            onClick={() => setFavoritesOnly(false)}
          >
            すべて
          </Button>
          <Button
            size="sm"
            variant={favoritesOnly ? "secondary" : "ghost"}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly(true)}
          >
            <Star data-icon="inline-start" />
            お気に入り
          </Button>
        </div>

        {loaded === null ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" />
            読み込み中…
          </p>
        ) : loaded.error ? (
          <p className="py-8 text-center text-sm text-destructive">
            {loaded.error}
          </p>
        ) : !visible || visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {favoritesOnly
              ? "お気に入りのイラストはありません（アトリエのギャラリーで☆を付けられます）"
              : "このプロジェクトのイラストはまだありません"}
          </p>
        ) : (
          <ul className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="flex w-full flex-col gap-1 rounded-md border border-border p-1.5 text-left transition-colors hover:bg-accent"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 署名URL（短寿命・外部最適化不可）のため素の img を使う */}
                  <img
                    src={item.signedUrl}
                    alt={item.title}
                    loading="lazy"
                    className="h-32 w-full rounded object-cover"
                  />
                  <span className="truncate text-xs font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge variant="secondary">
                      {ILLUSTRATION_KIND_LABEL[item.kind]}
                    </Badge>
                    {item.placedAt !== null && (
                      <Badge variant="outline">
                        <Flag />
                        採用
                      </Badge>
                    )}
                    {item.isFavorite && (
                      <Star
                        className="size-3.5 fill-current text-primary"
                        aria-label="お気に入り"
                      />
                    )}
                    {item.style !== null && (
                      <span className="text-xs text-muted-foreground">
                        {ILLUSTRATION_STYLE_LABEL[item.style]}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
