"use client";

import { createContext, useContext, useMemo, useState } from "react";

/** 画面クローム（グローバルナビ・プロジェクトヘッダー）の表示状態。エディタ集中モードから隠すために使う */
const ChromeContext = createContext<{
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
} | null>(null);

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const value = useMemo(() => ({ hidden, setHidden }), [hidden]);
  return (
    <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>
  );
}

export function useChrome() {
  const ctx = useContext(ChromeContext);
  if (!ctx) {
    throw new Error("useChrome は ChromeProvider の内側でのみ使用できます");
  }
  return ctx;
}

/** 集中モード中に非表示になるヘッダー領域のラッパー（children はサーバー描画のまま受け取る） */
export function ChromeHeader({ children }: { children: React.ReactNode }) {
  const { hidden } = useChrome();
  if (hidden) return null;
  return <>{children}</>;
}
