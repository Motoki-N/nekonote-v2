import { generateImage } from "ai";

import { resolveImageModel } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import { AppError, errorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  generateRequestSchema,
  ILLUSTRATION_EXTENSION_BY_MIME,
  ILLUSTRATION_KIND_LABEL,
  type IllustrationItem,
} from "@/lib/schemas/illustration";
import { createClient } from "@/lib/supabase/server";

// 画像生成はテキストより遅い（デフォルトのGemini系で10〜15秒。SPEC-illustrator §3）
export const maxDuration = 60;

/** 署名URLの寿命（SPEC §6: 短寿命） */
const SIGNED_URL_TTL_SECONDS = 3600;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    // 画像生成は本アプリ最高コストの操作。分2回・日20回（SPEC §2）
    enforceRateLimit(user.id, "illustration-generate", {
      perMinute: 2,
      perDay: 20,
    });

    const parsed = generateRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError(
        "validation",
        parsed.error.issues[0]?.message ?? "リクエストの形式が不正です",
      );
    }
    const { request, prompt } = parsed.data;

    // RLS越しの取得＝所有確認を兼ねる。title は初期タイトルの組み立てに使う
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, title")
      .eq("id", request.projectId)
      .maybeSingle();
    if (projectError) throw new AppError("internal", projectError.message);
    if (!project)
      throw new AppError("not_found", "プロジェクトが見つかりません");

    // 参照画像（複数可。SPEC §13）: RLS越しの行取得（所有確認）→ Storage からダウンロードして
    // 依頼の順序どおりに入力へ添付する
    const referenceIds = request.referenceIllustrationIds ?? [];
    let referenceImages: Uint8Array[] = [];
    if (referenceIds.length > 0) {
      const { data: references, error: referenceError } = await supabase
        .from("illustrations")
        .select("id, storage_path")
        .in("id", referenceIds);
      if (referenceError)
        throw new AppError("internal", referenceError.message);
      // 他人のイラスト・削除済みは RLS で返らない＝件数が欠ける
      const pathById = new Map(
        (references ?? []).map((row) => [row.id, row.storage_path]),
      );
      if (referenceIds.some((id) => !pathById.has(id)))
        throw new AppError("not_found", "参照イラストが見つかりません");

      referenceImages = await Promise.all(
        referenceIds.map(async (id) => {
          const { data: blob, error: downloadError } = await supabase.storage
            .from("illustrations")
            .download(pathById.get(id)!);
          if (downloadError || !blob) {
            throw new AppError(
              "internal",
              `参照イラストの取得に失敗しました: ${downloadError?.message}`,
            );
          }
          return new Uint8Array(await blob.arrayBuffer());
        }),
      );
    }

    const { model, provider, modelId } = await resolveImageModel(supabase);
    const { image, usage } = await generateImage({
      model,
      prompt:
        referenceImages.length > 0
          ? { images: referenceImages, text: prompt }
          : prompt,
      aspectRatio: request.aspectRatio,
    });

    // 使用量記録（Issue #45）。トークン数はプロバイダが返さない場合 null で残る
    await recordAiUsage(supabase, {
      feature: "illustration-generate",
      provider,
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    // バケットの許可形式のみ保存（想定外の形式はフェイルクローズ）。
    // 出力形式はモデル依存（Gemini系は jpeg を返すことがある）のため決め打ちにしない
    const extension = ILLUSTRATION_EXTENSION_BY_MIME[image.mediaType];
    if (!extension) {
      throw new AppError(
        "internal",
        `生成画像の形式が想定外です: ${image.mediaType}`,
      );
    }

    // パスは {user_id}/{illustration_id}.{拡張子}（SPEC §5.1）。id はここで採番して両者を揃える
    const illustrationId = crypto.randomUUID();
    const storagePath = `${user.id}/${illustrationId}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("illustrations")
      .upload(storagePath, image.uint8Array, { contentType: image.mediaType });
    if (uploadError) {
      throw new AppError(
        "internal",
        `画像の保存に失敗しました: ${uploadError.message}`,
      );
    }

    // 初期タイトルはサーバー側で「プロジェクト名＋種別」（SPEC §5.3）
    const { data: row, error: insertError } = await supabase
      .from("illustrations")
      .insert({
        id: illustrationId,
        project_id: project.id,
        kind: request.kind,
        title: `${project.title} ${ILLUSTRATION_KIND_LABEL[request.kind]}`,
        request,
        prompt,
        storage_path: storagePath,
      })
      .select("id, project_id, kind, title, prompt, created_at")
      .single();
    if (insertError || !row) {
      // 行のないオブジェクトを残さない（ベストエフォート。失敗してもRLSで本人以外は見えない）
      await supabase.storage.from("illustrations").remove([storagePath]);
      throw new AppError(
        "internal",
        `イラストの保存に失敗しました: ${insertError?.message}`,
      );
    }

    // 参照関係（添付順を position に残す）。失敗したら行と実体を消して生成ごと失敗にする
    // （参照の記録が欠けると、参照元の削除時の警告が漏れるため）
    if (referenceIds.length > 0) {
      const { error: referencesError } = await supabase
        .from("illustration_references")
        .insert(
          referenceIds.map((referenceId, position) => ({
            illustration_id: row.id,
            reference_illustration_id: referenceId,
            position,
          })),
        );
      if (referencesError) {
        await supabase.from("illustrations").delete().eq("id", row.id);
        await supabase.storage.from("illustrations").remove([storagePath]);
        throw new AppError(
          "internal",
          `参照画像の記録に失敗しました: ${referencesError.message}`,
        );
      }
    }

    const { data: signed, error: signError } = await supabase.storage
      .from("illustrations")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed) {
      throw new AppError(
        "internal",
        `画像URLの発行に失敗しました: ${signError?.message}`,
      );
    }

    const illustration: IllustrationItem = {
      id: row.id,
      projectId: row.project_id,
      kind: row.kind as IllustrationItem["kind"],
      title: row.title,
      prompt: row.prompt,
      style: request.style ?? null,
      createdAt: row.created_at,
      signedUrl: signed.signedUrl,
      referencedCount: 0, // 生成直後を参照するイラストはまだ存在しない
      isFavorite: false,
      placedAt: null,
      placedImagePath: null,
    };
    return Response.json({ illustration });
  } catch (error) {
    return errorResponse(error);
  }
}
