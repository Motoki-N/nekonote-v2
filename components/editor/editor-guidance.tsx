"use client";

import Link from "next/link";
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";

function GuidanceCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-start gap-3 rounded-lg border border-border bg-card p-4">
        {children}
      </div>
    </div>
  );
}

/** 前提未達（repo/PAT/取得エラー）の誘導表示（原稿タブと同じ作法） */
export function EditorGuidance({
  kind,
  message,
}: {
  kind: "error" | "no_pat" | "no_repo";
  /** kind === 'error' のときのエラーメッセージ */
  message?: string | null;
}) {
  if (kind === "error") {
    return (
      <GuidanceCard>
        <p className="text-sm text-destructive">{message}</p>
        <p className="text-sm text-muted-foreground">
          PATの有効期限・対象リポジトリ設定と、プロジェクトのリポジトリ名を確認してください。
        </p>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings">設定をひらく</Link>}
        />
      </GuidanceCard>
    );
  }
  if (kind === "no_pat") {
    return (
      <GuidanceCard>
        <p className="text-sm text-foreground">
          エディタでの執筆には GitHub PAT の登録が必要です。
        </p>
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link href="/settings">
              <Settings data-icon="inline-start" />
              設定でPATを登録する
            </Link>
          }
        />
      </GuidanceCard>
    );
  }
  return (
    <GuidanceCard>
      <p className="text-sm text-foreground">
        原稿リポジトリが設定されていません。
      </p>
      <p className="text-sm text-muted-foreground">
        ヘッダーの編集ボタン（鉛筆アイコン）から「原稿リポジトリ（owner/repo）」を設定してください。
      </p>
    </GuidanceCard>
  );
}
