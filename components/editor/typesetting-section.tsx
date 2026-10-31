"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  previewTypesettingSwitch,
  switchTypesettingStyle,
} from "@/lib/actions/editor";
import type { TypesettingPreview } from "@/lib/actions/editor";
import { diffTexts } from "@/lib/diff";
import { STYLE_SETS } from "@/lib/editor/typesetting-style";
import type { TypesettingStyle } from "@/lib/editor/typesetting-style";
import { DiffView } from "@/components/diff-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KIND_LABELS = { modify: "変更", add: "追加", delete: "削除" } as const;

/** 現在のスタイルの説明（例: 縦書き（文庫）・A6／B6） */
function describe(style: TypesettingStyle): string {
  const set = STYLE_SETS[style];
  return `${set.label}・${set.primary.label}／${set.secondary.label}`;
}

/**
 * 書籍設定の「組版スタイル」区画（SPEC-horizontal-typesetting §6.2）。
 * 切替は 試算（変更ファイル一覧と差分）→ 確認 → 1コミット。変換できないときは理由を示す
 */
export function TypesettingSection({
  projectId,
  branch,
  style,
  onSaved,
}: {
  projectId: string;
  branch: string;
  style: TypesettingStyle | "custom";
  onSaved: () => void;
}) {
  const [preview, setPreview] = useState<TypesettingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  if (style === "custom") {
    return (
      <Frame>
        <p className="text-sm text-muted-foreground">
          book.config.js
          のテーマを手で指定しているため、アプリからは切り替えられません。
          縦書き・横書きの切り替え方はマニュアル（§8「組版スタイル」）の手動手順を参照してください。
        </p>
      </Frame>
    );
  }

  const to: TypesettingStyle = style === "vertical" ? "horizontal" : "vertical";

  const handlePreview = async () => {
    setLoading(true);
    const result = await previewTypesettingSwitch(projectId, { to, branch });
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setPreview(result.data ?? null);
  };

  const handleCommit = async () => {
    if (!preview?.ok) return;
    setSaving(true);
    const result = await switchTypesettingStyle(projectId, {
      to,
      branch,
      baseShas: preview.baseShas,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`組版スタイルを${STYLE_SETS[to].label}に切り替えました`);
    for (const warning of result.data?.warnings ?? []) toast.warning(warning);
    setPreview(null);
    onSaved();
  };

  return (
    <Frame>
      <p className="text-sm text-foreground">現在: {describe(style)}</p>
      {preview === null ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={handlePreview}
          >
            {loading && (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            )}
            {STYLE_SETS[to].label}に切り替える
          </Button>
        </div>
      ) : preview.ok ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/30 p-3">
          <p className="text-xs text-muted-foreground">
            {describe(to)}
            に切り替えます。次のファイルを1コミットで書き換えます:
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {preview.changes.map((change) => {
              const rows =
                change.kind === "modify" &&
                change.before !== null &&
                change.after !== null
                  ? diffTexts(change.before, change.after)
                  : [];
              return (
                <li key={change.path} className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{KIND_LABELS[change.kind]}</Badge>
                    <span className="break-all font-mono text-xs">
                      {change.path}
                    </span>
                  </span>
                  {rows.length > 0 && <DiffView rows={rows} />}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            判型が変わるため、組み設定（行数・字詰めなど）・ノンブル/柱・目次の見た目は移行先のテーマの値になります。
            移行元のテーマは削除しないので、戻すと前の設定に戻ります。
          </p>
          {preview.warnings.map((warning) => (
            <p key={warning} className="text-xs text-destructive">
              {warning}
            </p>
          ))}
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setPreview(null)}
            >
              戻る
            </Button>
            <Button size="sm" disabled={saving} onClick={handleCommit}>
              {saving && (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              )}
              切り替えてコミット
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm text-destructive">
            次のファイルが想定と違う構造のため、切り替えられません。
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {preview.problems.map((problem) => (
              <li key={`${problem.path}:${problem.reason}`}>
                <span className="break-all font-mono text-xs">
                  {problem.path}
                </span>
                <span className="text-muted-foreground">
                  : {problem.reason}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            VS
            Code等で直接切り替える手順は、マニュアル（§8「組版スタイル」）を参照してください。
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreview(null)}
            >
              閉じる
            </Button>
          </div>
        </div>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">組版スタイル</h3>
      {children}
    </section>
  );
}
