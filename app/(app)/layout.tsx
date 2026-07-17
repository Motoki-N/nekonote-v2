import { ChromeHeader, ChromeProvider } from "@/components/layout/app-chrome";
import { AppHeader } from "@/components/layout/app-header";

/**
 * 認証済みページ共通レイアウト。グローバルナビをここで1箇所だけマウントし、
 * スクロールは内側コンテナが担う（ハブページは自然スクロール、
 * プロジェクト配下は h-full でビューポート固定を維持する）。
 * エディタ集中モード中は ChromeHeader がグローバルナビを隠す
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChromeProvider>
      <div className="flex h-dvh flex-col">
        <ChromeHeader>
          <AppHeader />
        </ChromeHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </div>
    </ChromeProvider>
  );
}
