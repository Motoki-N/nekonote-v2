"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function GoogleLoginButton({ returnTo }: { returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleLogin = async () => {
    setPending(true);
    setFailed(false);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
      },
    });
    if (error) {
      setFailed(true);
      setPending(false);
    }
    // 成功時は Google へリダイレクトされるため何もしない
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={handleLogin} disabled={pending} size="lg">
        {pending ? "Googleへ移動中..." : "Googleでログイン"}
      </Button>
      {failed && (
        <p className="text-sm text-destructive">
          サインインを開始できませんでした。時間をおいて再度お試しください。
        </p>
      )}
    </div>
  );
}
