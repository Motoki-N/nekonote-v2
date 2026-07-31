# セキュリティポリシー / Security Policy

## 脆弱性の報告 / Reporting a Vulnerability

本リポジトリで脆弱性を発見した場合は、公開Issueではなく **GitHub の Private Vulnerability Reporting**（リポジトリの Security タブ → Report a vulnerability）から報告してください。

Please report vulnerabilities via GitHub's Private Vulnerability Reporting (Security tab → Report a vulnerability), not via public issues.

## 前提となる設計 / Design Assumptions

本アプリは**単一ユーザー（もしくはごく少人数の許可リスト制）での運用を前提**に設計されています。

- 認証はメール許可リストの2層ゲート（環境変数 `ALLOWED_EMAILS` ＋ DB の `private.auth_allowlist`）。いずれも空なら全拒否（フェイルクローズ）
- レートリミットはインメモリの固定ウィンドウ方式（`lib/rate-limit.ts`）。サーバーレス環境ではインスタンス間で共有されないため、不特定多数向けの運用には別途対策が必要
- 既知の監査記録は [docs/security-audit-20260714.md](docs/security-audit-20260714.md) を参照

フォークして複数ユーザー向けに運用する場合は、上記の前提を見直してください。
