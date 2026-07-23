"use client";

import type { SceneRecord } from "@/lib/board";
import { EMOTION_MAX, EMOTION_MIN } from "@/lib/schemas/enums";

const SLOT_WIDTH = 24; // 1シーン = 起点・終点の2スロット
const TOP = 8;
const BOTTOM = 64;
const HEIGHT = 76;
const LEFT_PAD = 28; // 軸ラベル分

// 固定ドメイン(-5〜+5)の線形スケール。実データのmin/maxは使わない
// （感情強度は絶対値として比較できることが重要なため、シーン構成ごとに縮尺が変わるのを避ける）
function yFor(value: number): number {
  return BOTTOM - ((value - EMOTION_MIN) / (EMOTION_MAX - EMOTION_MIN)) * (BOTTOM - TOP);
}

/**
 * 感情の起伏の折れ線（SPEC-beat-board §3.2）。
 * 構成順序（order_index）に沿って emotion_start → emotion_end の遷移を
 * -5〜+5の固定スケールで描画する。未設定はスキップして線をつなぐ。
 * 色はテーマ用CSS変数（currentColor / Tailwind のテーマクラス）のみ
 */
export function EmotionLine({ scenes }: { scenes: SceneRecord[] }) {
  const points: { x: number; y: number }[] = [];
  scenes.forEach((scene, index) => {
    if (scene.emotion_start !== null) {
      points.push({ x: LEFT_PAD + index * 2 * SLOT_WIDTH, y: yFor(scene.emotion_start) });
    }
    if (scene.emotion_end !== null) {
      points.push({
        x: LEFT_PAD + (index * 2 + 1) * SLOT_WIDTH,
        y: yFor(scene.emotion_end),
      });
    }
  });

  const width = LEFT_PAD + Math.max(scenes.length, 1) * 2 * SLOT_WIDTH + 8;

  return (
    <section className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <h2 className="text-sm font-medium text-foreground">感情の起伏</h2>
      {points.length < 2 ? (
        <p className="text-xs text-muted-foreground">
          シーンに感情の起点・終点を設定すると、構成順の起伏がここに折れ線で表示されます
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
            {/* 感情強度の基準線と軸ラベル */}
            <text x={4} y={yFor(EMOTION_MAX) + 4} className="fill-muted-foreground text-[11px]">
              +5
            </text>
            <text x={4} y={yFor(0) + 4} className="fill-muted-foreground text-[11px]">
              0
            </text>
            <text x={4} y={yFor(EMOTION_MIN) + 4} className="fill-muted-foreground text-[11px]">
              -5
            </text>
            <line
              x1={LEFT_PAD}
              y1={yFor(0)}
              x2={width - 4}
              y2={yFor(0)}
              className="stroke-border"
              strokeDasharray="4 4"
            />
            {/* シーン番号（構成順） */}
            {scenes.map((scene, index) => (
              <text
                key={scene.id}
                x={LEFT_PAD + (index * 2 + 0.5) * SLOT_WIDTH}
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
              <circle key={index} cx={p.x} cy={p.y} r={3} fill="currentColor" />
            ))}
          </svg>
        </div>
      )}
    </section>
  );
}
