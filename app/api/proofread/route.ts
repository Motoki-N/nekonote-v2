import { streamObject } from "ai";

import { resolveModel } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import {
  buildRejectedSuggestionsGuidance,
  buildReviewSystemPrompt,
  PROOFREAD_COMMENT_GUIDANCE,
  PROOFREAD_EXHAUSTIVE_GUIDANCE,
} from "@/lib/ai/prompts";
import { AppError, errorResponse } from "@/lib/errors";
import { resolveRepoGit } from "@/lib/git/project-context";
import { sortByGenrePriority } from "@/lib/genre-priority";
import { suggestionKey } from "@/lib/proofread-apply";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getFileContent, getLatestCommitSha } from "@/lib/git/github";
import {
  manuscriptFilePathSchema,
  proofreadRequestSchema,
  proofreadSuggestionSchema,
} from "@/lib/schemas/manuscript";
import { createClient } from "@/lib/supabase/server";
import { aiCapabilities, parseEnum, writingGenres } from "@/lib/schemas/enums";

// 原稿全文の校正はレビュー文書より提案数が多くなりうるため実行上限を延長。
// 網羅性の指示（Issue #281）で1回あたりの出力件数がさらに増えるため /api/review と同じ300秒にする
export const maxDuration = 300;

// 選択範囲校正の追加指針（SPEC-proofread-selection §4。選択部分だけが入力になる旨を明示し、
// 断片の冒頭・末尾を「文が途中」と誤指摘させない）
const PROOFREAD_SELECTION_GUIDANCE =
  "今回の入力は原稿ファイルの一部（作者が選択した範囲）である。文章が途中から始まり途中で終わることがあるが、それ自体は問題にせず、渡された範囲内の本文だけを校正すること。";

// 拒否済み提案を「プロンプトへ載せる」上限件数（Issue #262）。
// 1ファイルの拒否が積み上がってもプロンプトが肥大しないよう直近ぶんに絞る。
// 保存前の除外フィルタは取りこぼしが許されないため、この上限を掛けず全件で効かせる
const REJECTED_PROMPT_LIMIT = 50;

/**
 * AI校正（SPEC-proofreading §3.3・§3.5）。
 * 実行時点の最新原稿を取得して streamObject（配列）で構造化提案を逐次返し、
 * 完了時に pending を置き換え保存＋ last_reviewed_commit を更新する。
 * selection 指定時は選択範囲だけを校正し、範囲内の pending のみ置き換え・SHAは進めない
 * （SPEC-proofread-selection）。
 * review_sessions は使わない（提案のライフサイクルは revision_suggestions.status が担う）
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    // APIコスト暴走の抑止（security-audit-20260714 M-1）。校正は原稿全文を投げるため厳しめ
    enforceRateLimit(user.id, "proofread", { perMinute: 3, perDay: 60 });

    const parsed = proofreadRequestSchema.safeParse(await req.json());
    if (!parsed.success)
      throw new AppError("validation", "リクエストの形式が不正です");
    const { manuscriptLinkId, selection } = parsed.data;

    // RLS越しの取得＝所有確認を兼ねる（リンク→プロジェクトの repo/base_path も同時に引く）
    const { data: link, error: linkError } = await supabase
      .from("manuscript_links")
      .select("id, file_path, projects (id, repo)")
      .eq("id", manuscriptLinkId)
      .maybeSingle();
    if (linkError) throw new AppError("internal", linkError.message);
    if (!link || !link.projects)
      throw new AppError("not_found", "原稿リンクが見つかりません");
    // DB由来の file_path も再検証する（PostgREST直叩きで作られた不正な行への多層防御）
    const filePath = manuscriptFilePathSchema.parse(link.file_path);

    const { repo, token } = await resolveRepoGit(supabase, link.projects, {
      patMessage: "GitHub PATが未登録です。設定から登録してください",
    });

    // 画面表示が古くても、その時点の最新原稿を正として校正する
    const [{ content }, latestSha] = await Promise.all([
      getFileContent(token, repo, filePath),
      getLatestCommitSha(token, repo, filePath),
    ]);

    // 選択範囲の校正（SPEC-proofread-selection §4）: 選択テキストが最新原稿に
    // 実在することを確認してから、その範囲だけをAIに渡す（画面表示と実体のズレへの安全弁）
    if (selection !== undefined && !content.includes(selection)) {
      throw new AppError(
        "validation",
        "選択範囲が最新の原稿に見つかりません。原稿を開き直して選択し直してください",
      );
    }

    // 一度拒否した指摘は繰り返さない（Issue #262）。作者が「このままでよい」と判断した提案を
    // AIへ渡して蒸し返させず、保存前にも同一の提案（原文抜粋＋修正案の一致）を除外する二段構え。
    // 拒否は再校正でも消えない（pending のみ置き換え）ため、この一覧が作者の判断の履歴になる
    const { data: rejectedRows, error: rejectedError } = await supabase
      .from("revision_suggestions")
      .select("original_text, suggested_text")
      .eq("manuscript_link_id", link.id)
      .eq("status", "rejected")
      // 拒否が新しい順。プロンプトへ載せる分を直近から選ぶための並び
      .order("updated_at", { ascending: false });
    if (rejectedError) throw new AppError("internal", rejectedError.message);
    const rejected = rejectedRows ?? [];
    // 除外フィルタは全件で効かせる（上限を掛けると古い拒否がすり抜ける）
    const rejectedKeys = new Set(rejected.map(suggestionKey));
    // 選択範囲校正では範囲内の拒否済みだけを伝える（範囲外は入力に現れず文脈として無意味）
    const rejectedForPrompt = (
      selection === undefined
        ? rejected
        : rejected.filter(
            (s) =>
              s.original_text !== "" && selection.includes(s.original_text),
          )
    ).slice(0, REJECTED_PROMPT_LIMIT);

    // 校正プロファイルのサーバー側ジャンル解決（SPEC-genre-profiles §校正）。
    // 選択UIはなく、標準行（is_default）限定＝従来の「実質標準固定」セマンティクスを保ったまま、
    // プロジェクトの執筆ジャンルに合う標準プロファイル（技術書→技術書校正）を自動選択する。
    // 担当ペルソナは従来どおり default_persona_id 経由
    const { data: proposal, error: proposalError } = await supabase
      .from("proposals")
      .select("writing_genre")
      .eq("project_id", link.projects.id)
      .maybeSingle();
    if (proposalError) throw new AppError("internal", proposalError.message);
    const writingGenre = parseEnum(
      writingGenres,
      proposal?.writing_genre ?? "novel",
      "proposals.writing_genre",
    );

    const { data: candidates, error: profileError } = await supabase
      .from("review_profiles")
      .select(
        "prompt_template, writing_genre, personas (description, ai_capability)",
      )
      .eq("target_phase", "proofreading")
      .eq("is_default", true)
      .order("created_at");
    if (profileError) throw new AppError("internal", profileError.message);
    const profile = sortByGenrePriority(candidates ?? [], writingGenre)[0];
    if (!profile?.personas) {
      throw new AppError(
        "internal",
        "校正プロファイルまたは担当ペルソナが見つかりません",
      );
    }

    const { model, provider, modelId } = await resolveModel(
      supabase,
      parseEnum(
        aiCapabilities,
        profile.personas.ai_capability,
        "personas.ai_capability",
      ),
    );

    const result = streamObject({
      model,
      output: "array",
      schema: proofreadSuggestionSchema,
      // コメントは作者のメモとして文脈に使わせ、校正対象からは外す（Issue #17）。
      // 網羅性の指示は、再校正のたびに別の指摘が出てくるのを抑えるため（Issue #281）
      system: [
        buildReviewSystemPrompt({
          personaDescription: profile.personas.description,
          promptTemplate: profile.prompt_template,
        }),
        "",
        PROOFREAD_EXHAUSTIVE_GUIDANCE,
        "",
        PROOFREAD_COMMENT_GUIDANCE,
        ...(selection !== undefined ? ["", PROOFREAD_SELECTION_GUIDANCE] : []),
        ...(rejectedForPrompt.length > 0
          ? ["", buildRejectedSuggestionsGuidance(rejectedForPrompt)]
          : []),
      ].join("\n"),
      // 校正さんの reference_scope は「原稿テキストのみ」（企画書・ノート・シーンは渡さない）。
      // 選択範囲校正では選択部分だけを渡す（SPEC-proofread-selection §2）
      prompt: selection ?? content,
      // ストリーム開始後のプロバイダエラーはHTTPステータスに出ないため、サーバーログに残す
      onError: ({ error }) => {
        console.error("校正ストリームでエラー:", error);
      },
      // 完了時にまとめて保存する（stop による切断時は保存せず、半端な提案を残さない）
      onFinish: async ({ object, usage }) => {
        // 使用量記録（Issue #45）。object が検証に失敗してもトークンは消費されている
        await recordAiUsage(supabase, {
          feature: "proofread",
          provider,
          modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        // スキーマ検証に失敗した場合は object が undefined（既存 pending は温存する）
        if (!object) return;
        // プロンプトで抑止しきれなかった蒸し返しをここで確実に落とす（Issue #262）
        const toSave = object.filter(
          (s) => !rejectedKeys.has(suggestionKey(s)),
        );
        try {
          // 再校正は pending のみ置き換え（on_hold / accepted / rejected は残す。SPEC §2）。
          // 選択範囲校正は原文抜粋が選択範囲内に見つかる pending だけ置き換え、
          // 範囲外の pending は残す（SPEC-proofread-selection §4）
          if (selection !== undefined) {
            const { data: pendings, error: pendingError } = await supabase
              .from("revision_suggestions")
              .select("id, original_text")
              .eq("manuscript_link_id", link.id)
              .eq("status", "pending");
            if (pendingError) {
              console.error("既存提案の取得に失敗:", pendingError.message);
              return;
            }
            const inRangeIds = (pendings ?? [])
              .filter(
                (s) =>
                  s.original_text !== "" && selection.includes(s.original_text),
              )
              .map((s) => s.id);
            if (inRangeIds.length > 0) {
              const { error: deleteError } = await supabase
                .from("revision_suggestions")
                .delete()
                .in("id", inRangeIds);
              if (deleteError) {
                console.error("既存提案の削除に失敗:", deleteError.message);
                return;
              }
            }
          } else {
            const { error: deleteError } = await supabase
              .from("revision_suggestions")
              .delete()
              .eq("manuscript_link_id", link.id)
              .eq("status", "pending");
            if (deleteError) {
              console.error("既存提案の削除に失敗:", deleteError.message);
              return;
            }
          }
          if (toSave.length > 0) {
            const { error: insertError } = await supabase
              .from("revision_suggestions")
              .insert(
                toSave.map((s) => ({
                  manuscript_link_id: link.id,
                  granularity: "sentence",
                  original_text: s.original_text,
                  suggested_text: s.suggested_text,
                  reason: s.reason,
                  status: "pending",
                })),
              );
            if (insertError) {
              console.error("提案の保存に失敗:", insertError.message);
              return;
            }
          }
          // 部分校正は「ファイル全体を校正した」ことにならないため SHA を進めない
          // （更新バナー＝前回の全文校正以降の変更検知の意味を保つ。SPEC-proofread-selection §2）
          if (selection === undefined) {
            const { error: shaError } = await supabase
              .from("manuscript_links")
              .update({ last_reviewed_commit: latestSha })
              .eq("id", link.id);
            if (shaError)
              console.error(
                "last_reviewed_commit の更新に失敗:",
                shaError.message,
              );
          }
        } catch (error) {
          // 保存の失敗でストリーム自体は壊さない（クライアントは取り直しで気づける）
          console.error("校正結果の保存に失敗:", error);
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    return errorResponse(error);
  }
}
