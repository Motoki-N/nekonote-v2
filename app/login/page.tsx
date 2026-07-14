import { GoogleLoginButton } from "@/components/google-login-button";

const ERROR_MESSAGES: Record<string, string> = {
  denied: "このアカウントは利用を許可されていません。",
  signin_failed:
    "サインインできませんでした。このアカウントは利用を許可されていない可能性があります。",
  config: "サーバーの認証設定が完了していません（環境変数未設定）。",
};

/** returnTo はサイト内パスのみ許可する（オープンリダイレクト防止） */
function sanitizeReturnTo(value: string | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.signin_failed) : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold text-foreground">🐱 ネコノテAI</h1>
      <p className="text-sm text-muted-foreground">
        小説は人間が書き、AIはネタ出し・レビュー・校正で伴走する。ニャ
      </p>
      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <GoogleLoginButton returnTo={sanitizeReturnTo(returnTo)} />
    </main>
  );
}
