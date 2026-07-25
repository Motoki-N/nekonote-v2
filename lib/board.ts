// ビートボードの純関数ヘルパー（SPEC-beat-board §4）。
// Server Actions / API / クライアントUI で共用するため副作用を持たない

import type {
  ApprovalStatus,
  Emotion,
  SceneAnchor,
  ScenePart,
  ScenePartAll,
} from '@/lib/schemas/enums'
import { scenePartsAll } from '@/lib/schemas/enums'

export type SceneRecord = {
  id: string
  project_id: string
  /** 'chapter' は目次ボードの章カード（SPEC-outline-board。ビートボードには描画しない） */
  part: ScenePartAll
  anchor: SceneAnchor | null
  order_index: number
  title: string
  content: string
  emotion_start: Emotion | null
  emotion_end: Emotion | null
  /** シーンレビューのゲート状態（Issue #57。「通す」で approved になる） */
  status: ApprovalStatus
  /** 紐づく原稿ファイルのパス（Issue #56。null = 未紐づけ） */
  manuscript_path: string | null
}

export const PART_LABEL: Record<ScenePartAll, string> = {
  setup: '設定',
  response: '反応',
  attack: '攻撃',
  resolution: '解決',
  chapter: '章',
}

// レーンヘッダーの短い説明（story-engineering の4部構成準拠）
export const PART_DESCRIPTION: Record<ScenePart, string> = {
  setup: '主人公の日常と危機の醸成。フックで引き込む',
  response: '一変した状況への反応・逃避・模索',
  attack: '主導権を握り、問題へ攻勢をかける',
  resolution: '内面の悪魔を克服した主人公による決着',
}

export const ANCHOR_LABEL: Record<SceneAnchor, string> = {
  pp1: 'PP1: プロットポイント1',
  pinch1: 'ピンチポイント1',
  midpoint: 'ミッドポイント',
  pinch2: 'ピンチポイント2',
  pp2: 'PP2: プロットポイント2',
}

/** カード上のアンカーバッジ用の短縮ラベル */
export const ANCHOR_BADGE: Record<SceneAnchor, string> = {
  pp1: 'PP1',
  pinch1: 'ピンチ1',
  midpoint: 'ミッド',
  pinch2: 'ピンチ2',
  pp2: 'PP2',
}

/** 感情の強度の表示用テキスト（null=未設定、0=0、それ以外は符号付き数値） */
export function formatEmotion(value: Emotion | null): string {
  if (value === null) return '未設定'
  return value > 0 ? `+${value}` : `${value}`
}

/** アンカーが属するパート（pp1⇔setup 等の整合はこの対応表が正） */
export const ANCHOR_TO_PART: Record<SceneAnchor, ScenePart> = {
  pp1: 'setup',
  pinch1: 'response',
  midpoint: 'response',
  pinch2: 'attack',
  pp2: 'attack',
}

export type BoundaryAnchor = 'pp1' | 'midpoint' | 'pp2'

/** 各レーン末尾の固定スロットに置く境界アンカー（解決・章レーンにはない） */
export const BOUNDARY_ANCHOR_BY_PART: Partial<Record<ScenePartAll, BoundaryAnchor>> = {
  setup: 'pp1',
  response: 'midpoint',
  attack: 'pp2',
}

export function isBoundaryAnchor(anchor: SceneAnchor | null): anchor is BoundaryAnchor {
  return anchor === 'pp1' || anchor === 'midpoint' || anchor === 'pp2'
}

/** part と整合しないアンカーを解除する（D&Dのレーン間移動・ダイアログのパート変更の正規化。
 * chapter は ANCHOR_TO_PART に存在せず常に不一致 → null になる） */
export function normalizeAnchor(anchor: SceneAnchor | null, part: ScenePartAll): SceneAnchor | null {
  if (anchor !== null && ANCHOR_TO_PART[anchor] !== part) return null
  return anchor
}

/**
 * 正準順序: レーンをパート順（設定→反応→攻撃→解決→章）に連結した通し順序。
 * 境界アンカー付きシーンは各レーン末尾に固定し、order_index を 0..N-1 で振り直す。
 * 入力配列の並びがレーン内の相対順として保存される。
 * 章レーンを末尾に含めて全走査することで、片方のビュー（ビートボード/目次ボード）から
 * 全件送信された並べ替えでも、もう一方のビューのカードが保全される（SPEC-outline-board §4）
 */
export function toCanonicalOrder(scenes: SceneRecord[]): SceneRecord[] {
  const result: SceneRecord[] = []
  for (const part of scenePartsAll) {
    const lane = scenes.filter((s) => s.part === part)
    const boundary = BOUNDARY_ANCHOR_BY_PART[part]
    result.push(...lane.filter((s) => !(boundary && s.anchor === boundary)))
    if (boundary) result.push(...lane.filter((s) => s.anchor === boundary))
  }
  return result.map((s, index) => ({ ...s, order_index: index }))
}
