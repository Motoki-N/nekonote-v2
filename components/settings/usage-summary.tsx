import type { AiUsageSummaryRow } from "@/lib/actions/settings";
import type { AiUsageFeature } from "@/lib/ai/usage";
import type { AiProvider } from "@/lib/schemas/enums";
import { PROVIDER_LABEL } from "@/components/settings/labels";

// 使用量ログの機能種別ラベル（lib/ai/usage.ts の AiUsageFeature と対応）
const FEATURE_LABEL: Record<AiUsageFeature, string> = {
  chat: "会話",
  review: "レビュー・講評",
  proofread: "校正",
  "illustration-propose": "イラスト案出し",
  "illustration-generate": "画像生成",
};

function formatTokens(value: number): string {
  return value.toLocaleString("ja-JP");
}

/** 直近30日のAI使用量サマリー（Issue #45。表示のみ・操作なし） */
export function UsageSummary({ rows }: { rows: AiUsageSummaryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">直近30日の利用記録はまだありません。</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">機能</th>
            <th className="px-3 py-2 font-medium">モデル</th>
            <th className="px-3 py-2 text-right font-medium">回数</th>
            <th className="px-3 py-2 text-right font-medium">入力トークン</th>
            <th className="px-3 py-2 text-right font-medium">出力トークン</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.feature}-${row.provider}-${row.modelId}`}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-3 py-2 text-foreground">
                {FEATURE_LABEL[row.feature as AiUsageFeature] ?? row.feature}
              </td>
              <td className="px-3 py-2 text-foreground">
                {PROVIDER_LABEL[row.provider as AiProvider] ?? row.provider} / {row.modelId}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {formatTokens(row.callCount)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {formatTokens(row.inputTokens)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {formatTokens(row.outputTokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
