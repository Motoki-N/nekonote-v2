"use client";

export type ProgressPoint = {
  /** YYYY-MM-DD（JST） */
  date: string;
  totalChars: number;
};

const STEP = 16; // 1記録あたりの横幅
const TOP = 8;
const BOTTOM = 48;
const HEIGHT = 64;
const LEFT_PAD = 8;
const RIGHT_PAD = 8;

function dateLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/**
 * 直近30日の文字数推移のSVG折れ線（SPEC-dashboard-critique-settings §3.1）。
 * ビートボードの感情折れ線（emotion-line.tsx）と同じ流儀:
 * チャートライブラリは使わず、色はテーマ用CSS変数（currentColor / Tailwind テーマクラス）のみ。
 * targetChars（target_pages の字数換算。Issue #60）があれば破線の目標線を重ねる——
 * 目標が遠いうちは推移が下に寄る（目標までの距離を優先して縦軸に含める）
 */
export function ProgressLine({
  points,
  targetChars = null,
}: {
  points: ProgressPoint[];
  targetChars?: number | null;
}) {
  if (points.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        記録がたまると推移がここに表示されます
      </p>
    );
  }

  const width = LEFT_PAD + (points.length - 1) * STEP + RIGHT_PAD;
  const values = points.map((p) => p.totalChars);
  const max = Math.max(...values, targetChars ?? -Infinity);
  const min = Math.min(...values, targetChars ?? Infinity);
  const y = (chars: number) =>
    max === min
      ? (TOP + BOTTOM) / 2
      : BOTTOM - ((chars - min) / (max - min)) * (BOTTOM - TOP);
  const coords = points.map((p, index) => ({
    x: LEFT_PAD + index * STEP,
    y: y(p.totalChars),
  }));
  const targetY = targetChars === null ? null : y(targetChars);

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={
          targetChars === null
            ? "直近30日の文字数推移の折れ線グラフ"
            : "直近30日の文字数推移と目標線の折れ線グラフ"
        }
        className="text-primary"
      >
        <line
          x1={LEFT_PAD}
          y1={BOTTOM}
          x2={width - RIGHT_PAD}
          y2={BOTTOM}
          className="stroke-border"
        />
        {targetY !== null && (
          <>
            <line
              x1={LEFT_PAD}
              y1={targetY}
              x2={width - RIGHT_PAD}
              y2={targetY}
              strokeDasharray="4 3"
              className="stroke-muted-foreground"
            />
            {/* 線が上端に近いときはラベルを線の下へ逃がす */}
            <text
              x={LEFT_PAD}
              y={targetY >= 20 ? targetY - 3 : targetY + 11}
              className="fill-muted-foreground text-[10px]"
            >
              目標
            </text>
          </>
        )}
        <polyline
          points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {coords.map((c, index) => (
          <circle
            key={points[index].date}
            cx={c.x}
            cy={c.y}
            r={2}
            fill="currentColor"
          />
        ))}
        {/* 期間の両端の日付ラベル */}
        <text
          x={LEFT_PAD}
          y={HEIGHT - 2}
          className="fill-muted-foreground text-[10px]"
        >
          {dateLabel(points[0].date)}
        </text>
        <text
          x={width - RIGHT_PAD}
          y={HEIGHT - 2}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {dateLabel(points[points.length - 1].date)}
        </text>
      </svg>
    </div>
  );
}
