import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // dev の Server Action 呼び出しログは引数を平文出力する（PAT等の秘密情報が
    // ターミナルログに漏れる）ため無効化する（2026-07-13 のE2Eで実害を確認）
    serverFunctions: false,
  },
};

export default nextConfig;
