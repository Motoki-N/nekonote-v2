// ビートボードの純関数ヘルパー（SPEC-beat-board §4）。
// Server Actions / API / クライアントUI で共用するため副作用を持たない

import { BOARD_TEMPLATES, boardTemplateList } from "@/lib/board-templates";
import type {
  ApprovalStatus,
  Emotion,
  SceneAnchor,
  ScenePart,
  ScenePartAll,
  StructureTemplate,
} from "@/lib/schemas/enums";
import { EMOTION_MAX, EMOTION_MIN, scenePartsAll } from "@/lib/schemas/enums";

export type SceneRecord = {
  id: string;
  project_id: string;
  /** 'chapter' は目次ボードの章カード（SPEC-outline-board。ビートボードには描画しない） */
  part: ScenePartAll;
  anchor: SceneAnchor | null;
  order_index: number;
  title: string;
  content: string;
  /** そのシーンを通した感情の変化量（-9〜+9。0=変化なし、null=未設定。Issue #205） */
  emotion_delta: Emotion | null;
  /** シーンレビューのゲート状態（Issue #57。「通す」で approved になる） */
  status: ApprovalStatus;
  /** 紐づく原稿ファイルのパス（Issue #56。null = 未紐づけ） */
  manuscript_path: string | null;
};

// ---- テンプレートレジストリからのグローバル対応表の導出（Issue #54） ----
// スラッグがテンプレート横断で一意なため、全テンプレートを平坦化した対応表が成立する。
// Record の網羅性は「enums の全語彙がいずれかのテンプレート定義に現れること」に依存する
// （語彙を追加するときは lib/board-templates.ts も同時に更新すること）

const allLanes = boardTemplateList.flatMap((t) => t.lanes);
const allTurningPoints = boardTemplateList.flatMap((t) =>
  t.lanes.flatMap((lane) =>
    lane.turningPoints.map((tp) => ({ ...tp, part: lane.id })),
  ),
);

export const PART_LABEL = {
  ...Object.fromEntries(allLanes.map((lane) => [lane.id, lane.label])),
  chapter: "章",
} as Record<ScenePartAll, string>;

// レーンヘッダーの短い説明
export const PART_DESCRIPTION = Object.fromEntries(
  allLanes.map((lane) => [lane.id, lane.description]),
) as Record<ScenePart, string>;

export const ANCHOR_LABEL = Object.fromEntries(
  allTurningPoints.map((tp) => [tp.id, tp.label]),
) as Record<SceneAnchor, string>;

/** カード上のアンカーバッジ用の短縮ラベル */
export const ANCHOR_BADGE = Object.fromEntries(
  allTurningPoints.map((tp) => [tp.id, tp.badge]),
) as Record<SceneAnchor, string>;

/** 新規シーン本文の初期値（Issue #155。4観点のテンプレとして残す。
 * 章カードは対象外。編集ダイアログの placeholder（本文を空にしたとき）と共用） */
export const SCENE_CONTENT_TEMPLATE = [
  "4観点を目安に自由に:",
  "・シチュエーション（場所・時刻）",
  "・起きること",
  "・感情の変化",
  "・葛藤",
].join("\n");

/** 感情の変化量の表示用テキスト（null=未設定、0=±0、それ以外は符号付き数値） */
export function formatEmotion(value: Emotion | null): string {
  if (value === null) return "未設定";
  if (value === 0) return "±0";
  return value > 0 ? `+${value}` : `${value}`;
}

/** 感情の起伏の1点（computeEmotionArc の結果） */
export type EmotionArcPoint = {
  sceneId: string;
  /** 先頭を0として変化量を積み上げた到達値（EMOTION_MIN〜EMOTION_MAX にクランプ済み） */
  value: number;
  /** 上下限に達して変化量を反映しきれなかった（UIで赤字警告する。Issue #205） */
  clamped: boolean;
};

/**
 * 各シーンの変化量から感情の起伏を積み上げる（SPEC-beat-board §3.2。Issue #205）。
 * 先頭を0とし、構成順に emotion_delta を足し込む。未設定シーンは変化なし（累積を維持）。
 * 上下限（±9）を超える分は切り捨て、そのシーンに clamped を立てる。
 * scenes はビートボードの表示順（章カードを除く正準順序）で渡すこと
 */
export function computeEmotionArc(scenes: SceneRecord[]): EmotionArcPoint[] {
  let current = 0;
  return scenes.map((scene) => {
    const raw = current + (scene.emotion_delta ?? 0);
    const next = Math.min(EMOTION_MAX, Math.max(EMOTION_MIN, raw));
    const clamped = scene.emotion_delta !== null && raw !== next;
    current = next;
    return { sceneId: scene.id, value: next, clamped };
  });
}

/** アンカーが属するパート（pp1⇔setup 等の整合はこの対応表が正） */
export const ANCHOR_TO_PART = Object.fromEntries(
  allTurningPoints.map((tp) => [tp.id, tp.part]),
) as Record<SceneAnchor, ScenePart>;

/** 各レーン末尾の固定スロットに置く境界アンカー（持たないレーンもある。SPEC-structure-templates §3） */
export const BOUNDARY_ANCHOR_BY_PART: Partial<
  Record<ScenePartAll, SceneAnchor>
> = Object.fromEntries(
  allLanes
    .map((lane) => [lane.id, lane.turningPoints.find((tp) => tp.boundary)?.id])
    .filter(([, anchor]) => anchor !== undefined),
);

const boundaryAnchors = new Set<SceneAnchor>(
  allTurningPoints.filter((tp) => tp.boundary).map((tp) => tp.id),
);

export function isBoundaryAnchor(
  anchor: SceneAnchor | null,
): anchor is SceneAnchor {
  return anchor !== null && boundaryAnchors.has(anchor);
}

/** part と整合しないアンカーを解除する（D&Dのレーン間移動・ダイアログのパート変更の正規化。
 * chapter は ANCHOR_TO_PART に存在せず常に不一致 → null になる） */
export function normalizeAnchor(
  anchor: SceneAnchor | null,
  part: ScenePartAll,
): SceneAnchor | null {
  if (anchor !== null && ANCHOR_TO_PART[anchor] !== part) return null;
  return anchor;
}

/**
 * 正準順序: レーンをパート順（設定→反応→攻撃→解決→章）に連結した通し順序。
 * 境界アンカー付きシーンは各レーン末尾に固定し、order_index を 0..N-1 で振り直す。
 * 入力配列の並びがレーン内の相対順として保存される。
 * 章レーンを末尾に含めて全走査することで、片方のビュー（ビートボード/目次ボード）から
 * 全件送信された並べ替えでも、もう一方のビューのカードが保全される（SPEC-outline-board §4）
 */
export function toCanonicalOrder(scenes: SceneRecord[]): SceneRecord[] {
  const result: SceneRecord[] = [];
  for (const part of scenePartsAll) {
    const lane = scenes.filter((s) => s.part === part);
    const boundary = BOUNDARY_ANCHOR_BY_PART[part];
    result.push(...lane.filter((s) => !(boundary && s.anchor === boundary)));
    if (boundary) result.push(...lane.filter((s) => s.anchor === boundary));
  }
  return result.map((s, index) => ({ ...s, order_index: index }));
}

/**
 * レーン内の転換点の並び順制約の検証（SPEC-structure-templates §5）。
 * 各レーンで転換点付きシーンの相対順がテンプレート定義順（turningPoints の配列順）に
 * 一致しない最初の違反を返す（prior=定義順で先の転換点が later の後ろに置かれている）。
 * scenes はボード表示順（正準順序）で渡すこと。クライアント（ドロップ時）とサーバー
 * （updateScene / reorderScenes）で共用する
 */
export function findTurningPointOrderViolation(
  scenes: SceneRecord[],
  template: StructureTemplate,
): { prior: SceneAnchor; later: SceneAnchor } | null {
  for (const lane of BOARD_TEMPLATES[template].lanes) {
    const defIndex = new Map(
      lane.turningPoints.map((tp, index) => [tp.id, index]),
    );
    let maxIndex = -1;
    let maxAnchor: SceneAnchor | null = null;
    for (const scene of scenes) {
      if (scene.part !== lane.id || scene.anchor === null) continue;
      const index = defIndex.get(scene.anchor);
      // part↔anchor 不整合はここでは扱わない（normalizeAnchor が解除する）
      if (index === undefined) continue;
      if (index < maxIndex && maxAnchor !== null) {
        return { prior: scene.anchor, later: maxAnchor };
      }
      if (index > maxIndex) {
        maxIndex = index;
        maxAnchor = scene.anchor;
      }
    }
  }
  return null;
}

/** 順序違反の日本語メッセージ（トースト・AppError 共用） */
export function turningPointOrderMessage(violation: {
  prior: SceneAnchor;
  later: SceneAnchor;
}): string {
  return `「${ANCHOR_LABEL[violation.prior]}」は「${ANCHOR_LABEL[violation.later]}」より前に置く必要があります`;
}
