import { WorkspaceSkeleton } from "@/components/layout/workspace-skeleton";

/** エディタタブの読み込み中表示（Issue #290。GitHub 取得の完了までスケルトンを出す） */
export default function Loading() {
  return <WorkspaceSkeleton label="エディタを読み込み中" />;
}
