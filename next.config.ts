import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // dev の Server Action 呼び出しログは引数を平文出力する（PAT等の秘密情報が
    // ターミナルログに漏れる）ため無効化する（2026-07-13 のE2Eで実害を確認）
    serverFunctions: false,
  },
  // 原稿リポジトリの初期セットアップ（lib/git/template.ts）が fs で読むテンプレートを
  // Vercel のサーバーレスバンドルに含める（SPEC-repo-setup §4.2）
  // 編集ダイアログは /projects 一覧と /projects/[id] レイアウト配下の全ページにあるため、
  // Server Action の POST 先になり得るルートすべてを対象にする
  outputFileTracingIncludes: {
    '/projects': ['./docs/templates/manuscript-repo/**'],
    '/projects/**': ['./docs/templates/manuscript-repo/**'],
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
