import { NextResponse } from "next/server";

export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "internal";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  internal: 500,
};

/**
 * アプリ共通のエラークラス。
 * API Route / Server Action で投げ、`errorResponse` で応答に変換する。
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

/** 未知の例外を AppError に正規化する */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : "予期しないエラーが発生しました";
  return new AppError("internal", message, { cause: error });
}

/** API Route 用の共通エラーレスポンス。内部詳細はログのみに残し、クライアントには code と message だけ返す */
export function errorResponse(error: unknown): NextResponse {
  const appError = toAppError(error);
  // internal はDB由来等の生メッセージを含みうるため、クライアントには固定文言のみ返す
  const message =
    appError.code === "internal" ? "サーバーエラーが発生しました" : appError.message;
  if (appError.code === "internal") {
    console.error(appError);
  }
  return NextResponse.json(
    { error: { code: appError.code, message } },
    { status: appError.status },
  );
}
