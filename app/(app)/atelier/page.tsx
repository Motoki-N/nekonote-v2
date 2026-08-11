import { createClient } from "@/lib/supabase/server";
import {
  AtelierWorkspace,
  type AtelierProject,
} from "@/components/atelier/atelier-workspace";

/**
 * アトリエ（SPEC-illustrator §4.1）。
 * イラストレーターへの依頼フォーム＋案選択＋ギャラリーの独立ページ。
 * プロジェクトはページ内で選択する（既定値は最新更新）
 */
export default async function AtelierPage() {
  const supabase = await createClient();
  const [{ data: projects }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, repo")
      .order("updated_at", { ascending: false }),
    supabase.from("user_settings").select("selected_project_id").maybeSingle(),
  ]);

  const items: AtelierProject[] = (projects ?? []).map((project) => ({
    id: project.id,
    title: project.title,
    hasRepo: Boolean(project.repo),
  }));

  // 既定値: ダッシュボードの選択中プロジェクト → なければ最新更新（SPEC §4.1）
  const selectedId = settingsRow?.selected_project_id;
  const initialProjectId =
    selectedId && items.some((item) => item.id === selectedId)
      ? selectedId
      : null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">アトリエ</h1>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
        <AtelierWorkspace
          projects={items}
          initialProjectId={initialProjectId}
        />
      </main>
    </div>
  );
}
