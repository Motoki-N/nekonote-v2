import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code の worktree（別作業ツリーのビルド生成物を巻き込まない）
    ".claude/**",
    // Vivliostyle Viewer の自前ホスト（postinstall で node_modules からコピーされる生成物）
    "public/vivliostyle/**",
    // 原稿リポジトリ側のテンプレート（アプリのコードではない。Node/CommonJS 前提）
    "docs/templates/**",
  ]),
]);

export default eslintConfig;
