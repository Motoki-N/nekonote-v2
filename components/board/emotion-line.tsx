"use client";

import { computeEmotionArc, type SceneRecord } from "@/lib/board";
import { EMOTION_MAX, EMOTION_MIN } from "@/lib/schemas/enums";

const SLOT_WIDTH = 24; // 1シーン = 1スロット（変化量を積み上げた到達値を1点で描く）
const TOP = 8;
const BOTTOM = 64;
const HEIGHT = 76;
const LEFT_PAD = 28; // 軸ラベル分

// 固定ドメイン(-9〜+9)の線形スケール。実データのmin/maxは使わない
// （感情の到達値は絶対値として比較できることが重要なため、シーン構成ごとに縮尺が変わるのを避ける）
function yFor(value: number): number {
  return (
    BOTTOM -
    ((value - EMOTION_MIN) / (EMOTION_MAX - EMOTION_MIN)) * (BOTTOM - TOP)
  );
}

/**
 * 感情の起伏の折れ線（SPEC-beat-board §3.2）。
 * 構成順序（order_index）に沿って各シーンの感情の変化量を0から積み上げ、
 * -9〜+9の固定スケールで到達値を描画する（Issue #205）。
 * 未設定シーンは変化なしとして累積を維持する。上下限に達して変化を反映しきれなかった
 * シーンの点は警告色で示す。色はテーマ用CSS変数（currentColor / Tailwind のテーマクラス）のみ
 */
export function EmotionLine({ scenes }: { scenes: SceneRecord[] }) {
  const arc = computeEmotionArc(scenes);
  // 先頭に起点（0）を置き、各シーンの到達値を1点ずつ続ける
  const points = [
    { x: LEFT_PAD, y: yFor(0), clamped: false },
    ...arc.map((point, index) => ({
      x: LEFT_PAD + (index + 1) * SLOT_WIDTH,
      y: yFor(point.value),
      clamped: point.clamped,
    })),
  ];

  const width = LEFT_PAD + (scenes.length + 1) * SLOT_WIDTH + 8;
  const hasEmotion = scenes.some((s) => s.emotion_delta !== null);

  return (
    <section className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <h2 className="text-sm font-medium text-foreground">感情の起伏</h2>
      {!hasEmotion ? (
        <p className="text-xs text-muted-foreground">
          シーンに感情の変化を設定すると、構成順の起伏がここに折れ線で表示されます
        </p>
      ) : (
        <div className="overflow-x-auto">
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label="感情の起伏の折れ線グラフ"
            className="text-primary"
          >
            {/* 感情の到達値の基準線と軸ラベル */}
            <text
              x={4}
              y={yFor(EMOTION_MAX) + 4}
              className="fill-muted-foreground text-[11px]"
            >
              +{EMOTION_MAX}
            </text>
            <text
              x={4}
              y={yFor(0) + 4}
              className="fill-muted-foreground text-[11px]"
            >
              0
            </text>
            <text
              x={4}
              y={yFor(EMOTION_MIN) + 4}
              className="fill-muted-foreground text-[11px]"
            >
              {EMOTION_MIN}
            </text>
            <line
              x1={LEFT_PAD}
              y1={yFor(0)}
              x2={width - 4}
              y2={yFor(0)}
              className="stroke-border"
              strokeDasharray="4 4"
            />
            {/* シーン番号（構成順。起点の分だけ右にずらす） */}
            {scenes.map((scene, index) => (
              <text
                key={scene.id}
                x={LEFT_PAD + (index + 1) * SLOT_WIDTH}
                y={HEIGHT - 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {index + 1}
              </text>
            ))}
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {points.map((p, index) => (
              <circle
                key={index}
                cx={p.x}
                cy={p.y}
                r={3}
                fill="currentColor"
                // 上下限に達して変化を反映しきれなかったシーンは警告色（Issue #205）
                className={p.clamped ? "text-destructive" : undefined}
              />
            ))}
          </svg>
        </div>
      )}
    </section>
  );
}
