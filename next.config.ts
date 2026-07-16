import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // dev の Server Action 呼び出しログは引数を平文出力する（PAT等の秘密情報が
    // ターミナルログに漏れる）ため無効化する（2026-07-13 のE2Eで実害を確認）
    serverFunctions: false,
  },
  experimental: {
    serverActions: {
      // 画像アップロード（uploadImage）は base64 で約4/3倍になるため、
      // 10MB画像＋メタ分を通す（既定1MBのままだとスキーマ検証前に落ちる。
      // security-review 2026-07-16 M-1）
      bodySizeLimit: '15mb',
    },
  },
};

export default nextConfig;
