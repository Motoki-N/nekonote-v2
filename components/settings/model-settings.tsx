"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  deleteAiModelSetting,
  upsertAiModelSetting,
  type AiModelSettingsData,
} from "@/lib/actions/settings";
import type { AiProvider, ModelCapability } from "@/lib/schemas/enums";
import { aiProviders } from "@/lib/schemas/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CAPABILITY_LABEL,
  PROVIDER_LABEL,
  selectClass,
} from "@/components/settings/labels";

type RowState = {
  provider: AiProvider;
  modelId: string;
  isCustom: boolean;
};

/**
 * AIモデル設定（SPEC-dashboard-critique-settings §3.4）。
 * capability 3行 × provider セレクト＋model_id 入力。ユーザー行がなければデフォルト値を表示し、
 * 「デフォルトに戻す」= 行削除。キー未設定プロバイダには警告バッジ（サーバー判定の boolean のみ）
 */
export function ModelSettings({ data }: { data: AiModelSettingsData }) {
  const [rows, setRows] = useState<Record<ModelCapability, RowState>>(
    () =>
      Object.fromEntries(
        data.rows.map((row) => [
          row.capability,
          {
            provider: row.provider,
            modelId: row.modelId,
            isCustom: row.isCustom,
          },
        ]),
      ) as Record<ModelCapability, RowState>,
  );
  const [busyCapability, setBusyCapability] = useState<ModelCapability | null>(
    null,
  );

  function setRow(capability: ModelCapability, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [capability]: { ...prev[capability], ...patch },
    }));
  }

  async function handleSave(capability: ModelCapability) {
    const row = rows[capability];
    if (busyCapability || row.modelId.trim() === "") return;
    setBusyCapability(capability);
    try {
      const result = await upsertAiModelSetting({
        capability,
        provider: row.provider,
        model_id: row.modelId.trim(),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setRow(capability, { isCustom: true });
      toast(`${CAPABILITY_LABEL[capability]}のモデル設定を保存しました`);
    } finally {
      setBusyCapability(null);
    }
  }

  async function handleReset(capability: ModelCapability) {
    if (busyCapability) return;
    setBusyCapability(capability);
    try {
      const result = await deleteAiModelSetting(capability);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      const fallback = data.defaults[capability];
      setRows((prev) => ({
        ...prev,
        [capability]: {
          provider: fallback.provider,
          modelId: fallback.modelId,
          isCustom: false,
        },
      }));
      toast(`${CAPABILITY_LABEL[capability]}をデフォルトに戻しました`);
    } finally {
      setBusyCapability(null);
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {data.rows.map((meta) => {
        const row = rows[meta.capability];
        const busy = busyCapability === meta.capability;
        return (
          <li
            key={meta.capability}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-card-foreground">
                {CAPABILITY_LABEL[meta.capability]}
              </span>
              {row.isCustom && <Badge variant="secondary">カスタム</Badge>}
              {!data.keyConfigured[row.provider] && (
                <Badge variant="destructive">
                  <TriangleAlert data-icon="inline-start" />
                  APIキー未設定
                </Badge>
              )}
              {meta.personaNames.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  担当: {meta.personaNames.join("・")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`${CAPABILITY_LABEL[meta.capability]}のプロバイダ`}
                className={`${selectClass} w-32 flex-none`}
                value={row.provider}
                disabled={busy}
                onChange={(e) =>
                  setRow(meta.capability, {
                    provider: e.target.value as AiProvider,
                  })
                }
              >
                {aiProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABEL[provider]}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`${CAPABILITY_LABEL[meta.capability]}のモデルID`}
                className="h-8 min-w-40 flex-1 text-sm"
                value={row.modelId}
                placeholder={data.defaults[meta.capability].modelId}
                disabled={busy}
                onChange={(e) =>
                  setRow(meta.capability, { modelId: e.target.value })
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || row.modelId.trim() === ""}
                onClick={() => void handleSave(meta.capability)}
              >
                保存
              </Button>
              {row.isCustom && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={busy}
                  onClick={() => void handleReset(meta.capability)}
                >
                  デフォルトに戻す
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
