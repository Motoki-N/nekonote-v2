"use client";

import Link from "next/link";
import { BookMarked, SquareStack } from "lucide-react";

import type { LinkedScene } from "@/lib/board";

/**
 * 原稿ファイルに紐づくシーン／章の読み取り専用リスト（SPEC-manuscript-bridge §4.4）。
 * エディタのサイドバーと原稿タブのファイルヘッダ直下で共用する。
 * タイトルだけでなく構成メモ（content）も出す——執筆中に構成を読めることが本質的な価値。
 * 紐づけの編集はボード側（シーン・章ダイアログ）の領分なので、ここでは表示とリンクのみ
 */
export function LinkedSceneList({
  projectId,
  scenes,
}: {
  projectId: string;
  /** このファイルに紐づくシーン／章（構成順。0件なら何も描画しない） */
  scenes: LinkedScene[];
}) {
  if (scenes.length === 0) return null;

  return (
    <section aria-label="この原稿のシーン" className="flex flex-col gap-1">
      <h3 className="px-2 text-xs text-muted-foreground">この原稿のシーン</h3>
      <ul className="flex flex-col gap-0.5">
        {scenes.map((scene) => {
          const Icon = scene.kind === "chapter" ? BookMarked : SquareStack;
          return (
            <li key={scene.id}>
              <Link
                href={`/projects/${projectId}/board?scene=${encodeURIComponent(scene.id)}`}
                className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/50"
              >
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 break-all">
                    {scene.title || "（無題）"}
                  </span>
                </span>
                {scene.content !== "" && (
                  <span className="line-clamp-4 pl-6 text-xs whitespace-pre-wrap text-muted-foreground">
                    {scene.content}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
