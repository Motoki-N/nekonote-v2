import "server-only";

import { AppError } from "@/lib/errors";

// AI呼び出しエンドポイント共通の簡易レートリミット（security-audit-20260714 M-1）。
// 目的はセッション奪取・暴走スクリプトによるAPIコスト暴走の抑止であり、厳密な流量制御ではない。
// インメモリの固定ウィンドウ方式＝Vercelのインスタンス分離で緩くなりうるが、抑止には足りる。
// 単一許可ユーザー制の前提で固定値運用（複数ユーザー化する際は永続ストア方式を再検討すること）

type CounterWindow = { count: number; resetAt: number };

const counters = new Map<string, CounterWindow>();

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** 期限切れエントリの掃除（単一ユーザー前提では小さいが、無限成長だけは防ぐ） */
function prune(now: number): void {
  if (counters.size < 1000) return;
  for (const [key, window] of counters) {
    if (window.resetAt <= now) counters.delete(key);
  }
}

/** キーのウィンドウをインクリメントし、上限内なら true を返す */
function bump(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): boolean {
  const window = counters.get(key);
  if (!window || window.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return limit >= 1;
  }
  window.count += 1;
  return window.count <= limit;
}

/**
 * ユーザー×エンドポイント単位の回数制限。超過時は AppError('rate_limited') を投げる。
 * Route Handler の認証チェック直後（LLM呼び出しより前）に呼ぶこと
 */
export function enforceRateLimit(
  userId: string,
  endpoint: string,
  limits: { perMinute: number; perDay: number },
): void {
  const now = Date.now();
  prune(now);
  if (!bump(`${userId}:${endpoint}:m`, limits.perMinute, MINUTE_MS, now)) {
    throw new AppError(
      "rate_limited",
      "短時間にリクエストが集中しています。1分ほど待ってからもう一度お試しください",
    );
  }
  if (!bump(`${userId}:${endpoint}:d`, limits.perDay, DAY_MS, now)) {
    throw new AppError(
      "rate_limited",
      "本日のAI利用回数が上限に達しました。日を改めてお試しください",
    );
  }
}
