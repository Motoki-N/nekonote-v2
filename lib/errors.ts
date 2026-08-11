import { NextResponse } from "next/server";

export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "internal";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

/**
 * アプリ共通のエラークラス。
 * API Route / Server Action で投げ、`errorResponse` で応答に変換する。
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

/** 未知の例外を AppError に正規化する */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message =
    error instanceof Error ? error.message : "予期しないエラーが発生しました";
  return new AppError("internal", message, { cause: error });
}

// Server Action の throw は本番でメッセージが握りつぶされるため、
// { ok, error? } の戻り値でクライアントへ伝える（internal は固定文言に置換）
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

/** Server Action 用: 例外を ActionResult のエラー形に正規化する */
export function toActionError(error: unknown): ActionResult<never> {
  const appError = toAppError(error);
  if (appError.code === "internal") {
    console.error(appError);
    return {
      ok: false,
      error: { code: "internal", message: "サーバーエラーが発生しました" },
    };
  }
  return {
    ok: false,
    error: { code: appError.code, message: appError.message },
  };
}

/** API Route 用の共通エラーレスポンス。内部詳細はログのみに残し、クライアントには code と message だけ返す */
export function errorResponse(error: unknown): NextResponse {
  const appError = toAppError(error);
  // internal はDB由来等の生メッセージを含みうるため、クライアントには固定文言のみ返す
  const message =
    appError.code === "internal"
      ? "サーバーエラーが発生しました"
      : appError.message;
  if (appError.code === "internal") {
    console.error(appError);
  }
  return NextResponse.json(
    { error: { code: appError.code, message } },
    { status: appError.status },
  );
}
