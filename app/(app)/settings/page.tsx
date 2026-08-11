import {
  getAiModelSettings,
  getAiUsageSummary,
  getGithubConnection,
  getZennRepo,
  listPersonas,
  listReviewProfiles,
} from "@/lib/actions/settings";
import { GithubConnection } from "@/components/settings/github-connection";
import { ZennRepoSettings } from "@/components/settings/zenn-repo-settings";
import { ModelSettings } from "@/components/settings/model-settings";
import { PersonaList } from "@/components/settings/persona-list";
import { ProfileList } from "@/components/settings/profile-list";
import { UsageSummary } from "@/components/settings/usage-summary";

/** 設定画面（SPEC-dashboard-critique-settings §3.4）。AIモデル・使用量・ペルソナ・プロファイル・GitHub連携 */
export default async function SettingsPage() {
  const [modelSettings, personas, profiles, connection, usage, zennRepo] =
    await Promise.all([
      getAiModelSettings(),
      listPersonas(),
      listReviewProfiles(),
      getGithubConnection(),
      getAiUsageSummary(),
      getZennRepo(),
    ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold text-foreground">設定</h1>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-4 sm:p-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">
            AIモデル設定
          </h2>
          <p className="text-sm text-muted-foreground">
            能力レベルごとに使うAIモデルのマッピングです。モデルの世代交代には、ここの変更だけで追従できます。
          </p>
          {modelSettings.ok && modelSettings.data ? (
            <ModelSettings data={modelSettings.data} />
          ) : (
            <p className="text-sm text-destructive">
              {modelSettings.ok
                ? "読み込みに失敗しました"
                : modelSettings.error.message}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">
            AI使用量（直近30日）
          </h2>
          <p className="text-sm text-muted-foreground">
            AI機能の呼び出し回数とトークン数です。金額はプロバイダ側の管理画面で確認してください。
          </p>
          {usage.ok && usage.data ? (
            <UsageSummary rows={usage.data} />
          ) : (
            <p className="text-sm text-destructive">
              {usage.ok ? "読み込みに失敗しました" : usage.error.message}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">ペルソナ</h2>
          <p className="text-sm text-muted-foreground">
            レビューやチャットを担当するAIの人格です。標準ペルソナは複製してから編集できます。
          </p>
          {personas.ok && personas.data ? (
            <PersonaList personas={personas.data} />
          ) : (
            <p className="text-sm text-destructive">
              {personas.ok ? "読み込みに失敗しました" : personas.error.message}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">
            レビュープロファイル
          </h2>
          <p className="text-sm text-muted-foreground">
            レビュー・講評の評価観点（プロンプト）です。標準プロファイルは複製してから編集できます。
          </p>
          {profiles.ok && profiles.data && personas.ok && personas.data ? (
            <ProfileList profiles={profiles.data} personas={personas.data} />
          ) : (
            <p className="text-sm text-destructive">
              {profiles.ok ? "読み込みに失敗しました" : profiles.error.message}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">
            GitHub連携
          </h2>
          <p className="text-sm text-muted-foreground">
            原稿リポジトリの読み込みに使う Personal Access
            Token（PAT）を登録します。
            トークンは暗号化して保存され、登録後に値が表示されることはありません。
          </p>
          {connection.ok ? (
            <GithubConnection
              initialConnected={connection.data?.connected ?? false}
              initialUsername={connection.data?.username ?? null}
            />
          ) : (
            <p className="text-sm text-destructive">
              {connection.error.message}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">Zenn連携</h2>
          <p className="text-sm text-muted-foreground">
            Zenn記事の投稿先リポジトリ（ZennのGitHub連携に設定したもの）を登録します。
            投稿にはGitHub連携のPATを使います。
          </p>
          {zennRepo.ok ? (
            <ZennRepoSettings initialRepo={zennRepo.data?.repo ?? null} />
          ) : (
            <p className="text-sm text-destructive">{zennRepo.error.message}</p>
          )}
        </section>
      </main>
    </div>
  );
}
