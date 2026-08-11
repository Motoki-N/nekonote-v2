"use client";

import { RefreshCw } from "lucide-react";

import { selectClass } from "@/components/atelier/atelier-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ZennFrontmatterValue = {
  title: string;
  emoji: string;
  type: "tech" | "idea";
  /** カンマ区切りの入力文字列（配列化は保存時に親が行う） */
  topicsText: string;
  slug: string;
  published: boolean;
};

/**
 * frontmatter入力フォーム（SPEC-zenn-integration §3.2）。
 * slug は初回コミット後に変更不可（変更すると別ファイルになるため。開き直し編集はスコープ外）
 */
export function FrontmatterForm({
  value,
  onChange,
  slugLocked,
  onRegenerateSlug,
}: {
  value: ZennFrontmatterValue;
  onChange: (patch: Partial<ZennFrontmatterValue>) => void;
  /** 初回コミット済み＝slug変更不可 */
  slugLocked: boolean;
  onRegenerateSlug: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
      <label className="flex flex-col gap-1 text-sm" htmlFor="zenn-title">
        タイトル
        <Input
          id="zenn-title"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="記事のタイトル"
          maxLength={100}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor="zenn-emoji">
        絵文字
        <Input
          id="zenn-emoji"
          value={value.emoji}
          onChange={(e) => onChange({ emoji: e.target.value })}
          className="w-20 text-center"
          maxLength={16}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
        <label className="flex flex-col gap-1 text-sm" htmlFor="zenn-type">
          タイプ
          <select
            id="zenn-type"
            className={`${selectClass} w-40`}
            value={value.type}
            onChange={(e) =>
              onChange({ type: e.target.value === "idea" ? "idea" : "tech" })
            }
          >
            <option value="tech">tech（技術記事）</option>
            <option value="idea">idea（アイデア）</option>
          </select>
        </label>
        <label
          className="flex min-w-48 flex-1 flex-col gap-1 text-sm"
          htmlFor="zenn-topics"
        >
          トピック（カンマ区切り・5つまで）
          <Input
            id="zenn-topics"
            value={value.topicsText}
            onChange={(e) => onChange({ topicsText: e.target.value })}
            placeholder="nextjs, supabase"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="zenn-slug">
          slug（ファイル名）
          <span className="flex items-center gap-1">
            <Input
              id="zenn-slug"
              value={value.slug}
              onChange={(e) => onChange({ slug: e.target.value })}
              className="w-56 font-mono text-xs"
              disabled={slugLocked}
              aria-describedby="zenn-slug-help"
            />
            {!slugLocked && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="slugを再生成"
                onClick={onRegenerateSlug}
              >
                <RefreshCw />
              </Button>
            )}
          </span>
        </label>
      </div>
      <p
        id="zenn-slug-help"
        className="text-xs text-muted-foreground sm:col-span-2"
      >
        slug
        は記事URLとファイル名（articles/&lt;slug&gt;.md）になります。半角英小文字・数字・
        ハイフン・アンダースコアの12〜50字。
        {slugLocked && "投稿済みのため変更できません。"}
      </p>
    </div>
  );
}
