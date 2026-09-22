import { streamObject } from "ai";

import { resolveModel } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import {
  buildAlreadyFoundGuidance,
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
  PROOFREAD_MAX_PASSES,
  proofreadRequestSchema,
  proofreadSuggestionSchema,
  type ProofreadStopReason,
  type ProofreadSuggestion,
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

// 次の周へ進んでよいかを判断する時間予算（Issue #281）。maxDuration（300秒）に達すると
// 保存ごと巻き添えで失われるため、1周ぶんの余白を残して手前で畳む
const PROOFREAD_TIME_BUDGET_MS = 210_000;

/**
 * 周ごとのトークン数を合算するための正規化。
 * finish チャンクが来なかった周では ai@7 が `inputTokens: undefined` の空 usage を渡す
 * （NaN を詰めるフォールバック経路もコード上は残っている）。
 * そのまま足すと合計が NaN に汚染されて使用量記録が丸ごと壊れるため、両方を弾く
 */
function finiteTokens(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

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
    // 保存処理は関数に切り出してあり、そこでは link の絞り込みが効かないためIDを控える
    const linkId = link.id;

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

    // 1周ぶんの system。2周目以降は「すでに挙げた指摘」を末尾に足して漏れだけを拾わせる。
    // コメントは作者のメモとして文脈に使わせ、校正対象からは外す（Issue #17）
    const baseSystem = [
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
    ].join("\n");

    // 多段校正（Issue #281）。作者が手で5〜6回再校正してようやく収束していたものを、
    // サーバー側の周回に置き換える。周をまたいだ重複は suggestionKey で落とし、
    // 新規0件の周を収束とみなして打ち切る。各周の確定要素を1本のJSONへ合流させるため、
    // streamObject の toTextStreamResponse ではなく自前の ReadableStream で返す
    const seenKeys = new Set(rejectedKeys);
    const collected: ProofreadSuggestion[] = [];
    const startedAt = Date.now();
    const encoder = new TextEncoder();

    // クライアントの stop（切断）。以降の周を回さず保存もしない（半端な提案を残さない）
    let aborted = req.signal.aborted;
    req.signal.addEventListener("abort", () => {
      aborted = true;
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let emitted = 0;
        let passes = 0;
        // 最後まで走り切った周の数。0 なら原稿を通しで見た周が一度もない
        let completedPasses = 0;
        let stopReason: ProofreadStopReason = "max_passes";
        let inputTokens = 0;
        let outputTokens = 0;
        // 切断後の enqueue / close は例外になる。ここで握り潰し、
        // 保存判断（aborted）まで処理を進めきる
        const write = (chunk: string) => {
          if (aborted) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            aborted = true;
          }
        };

        write('{"suggestions":[');
        for (let pass = 1; pass <= PROOFREAD_MAX_PASSES; pass++) {
          if (aborted) break;
          // 次の周を始める前に残り時間を見る。maxDuration に達すると保存ごと失われるため、
          // 「あと1周入るか」を予算で判断して手前で畳む
          if (pass > 1 && Date.now() - startedAt > PROOFREAD_TIME_BUDGET_MS) {
            stopReason = "time_limit";
            break;
          }
          passes = pass;
          const foundBefore = collected.length;
          // この周が失敗したか。elementStream は error チャンクを捨てて正常終了するため
          // （ai@7 の createElementStream）、for await は例外を投げない。
          // 失敗はコールバック経由でしか知れない
          let passFailed = false;
          const result = streamObject({
            model,
            output: "array",
            schema: proofreadSuggestionSchema,
            system:
              collected.length === 0
                ? baseSystem
                : [baseSystem, "", buildAlreadyFoundGuidance(collected)].join(
                    "\n",
                  ),
            // 校正さんの reference_scope は「原稿テキストのみ」（企画書・ノート・シーンは渡さない）。
            // 選択範囲校正では選択部分だけを渡す（SPEC-proofread-selection §2）
            prompt: selection ?? content,
            abortSignal: req.signal,
            // ストリーム開始後のプロバイダエラーはHTTPステータスに出ないため、サーバーログに残す
            onError: ({ error }) => {
              passFailed = true;
              console.error(`校正${pass}周目でエラー:`, error);
            },
            // トークン数はここで受け取る。`result.usage` は finish チャンクでしか解決されず、
            // エラー・中断では永久に未解決のままになる（ai@7 は reject もしない）ため await しない
            onFinish: ({ usage, error }) => {
              if (error !== undefined) {
                passFailed = true;
                console.error(`校正${pass}周目でエラー:`, error);
              }
              inputTokens += finiteTokens(usage.inputTokens);
              outputTokens += finiteTokens(usage.outputTokens);
            },
          });
          try {
            for await (const element of result.elementStream) {
              if (aborted) break;
              const key = suggestionKey(element);
              // 拒否済み（Issue #262）と、前の周までに拾った提案を落とす
              if (seenKeys.has(key)) continue;
              seenKeys.add(key);
              collected.push(element);
              write((emitted === 0 ? "" : ",") + JSON.stringify(element));
              emitted += 1;
            }
          } catch (error) {
            // 現状の elementStream はここへ来ないが、将来 throw するようになっても壊れないように
            if (!aborted) {
              passFailed = true;
              console.error(`校正${pass}周目でエラー:`, error);
            }
          }
          if (aborted) break;
          // 失敗した周は「新規0件」に見えるため、収束判定より先に見る。
          // それまでに拾った提案は活かして打ち切る
          if (passFailed) {
            stopReason = "error";
            break;
          }
          // ここまで来た周は原稿を最後まで通して見ている（＝全文校正が1回成立している）
          completedPasses += 1;
          // この周で新しい指摘が1件も出なければ収束とみなす
          if (collected.length === foundBefore) {
            stopReason = "converged";
            break;
          }
        }
        write(
          `],"passes":${passes},"stopReason":${JSON.stringify(stopReason)}}`,
        );

        try {
          // 使用量記録（Issue #45）。エラーで落ちた周のぶんも消費済みとして記録する。
          // ただし stop による中断では、周を読み切らずに離脱するため onFinish が呼ばれず
          // その周のトークンは記録できない（プロバイダ側では消費されている）
          await recordAiUsage(supabase, {
            feature: "proofread",
            provider,
            modelId,
            inputTokens,
            outputTokens,
          });
          // 全周を終えてからまとめて保存する（stop による切断時は保存しない）。
          // 1周目から失敗して1件も拾えなかったときは保存に入らない——
          // saveSuggestions は既存 pending を削除して last_reviewed_commit を進めるため、
          // ここを通すと「AIが落ちただけ」で作者の未処理指摘が消える（旧実装の
          // `if (!object) return;` に相当する防御）
          const nothingUsable =
            stopReason === "error" && collected.length === 0;
          if (!aborted && !nothingUsable) {
            await saveSuggestions(collected, completedPasses > 0);
          }
        } catch (error) {
          // 保存の失敗でストリーム自体は壊さない（クライアントは取り直しで気づける）
          console.error("校正結果の保存に失敗:", error);
        } finally {
          try {
            controller.close();
          } catch {
            // 切断済みのストリームを閉じても実害はない
          }
        }
      },
      // req.signal が届かない経路（プロキシ越しの切断など）への保険
      cancel() {
        aborted = true;
      },
    });

    /**
     * 全周の結果を pending として保存し、last_reviewed_commit を進める。
     * @param scannedWholeFile 原稿を最後まで通して見た周が1回以上あったか。
     *   途中で落ちて1周も完走していない実行でSHAを進めると、全文を校正し切っていないのに
     *   更新バナーの基準だけが最新へ動いてしまう（部分校正でSHAを進めない理由と同じ論理）
     */
    async function saveSuggestions(
      toSave: ProofreadSuggestion[],
      scannedWholeFile: boolean,
    ) {
      // 再校正は pending のみ置き換え（on_hold / accepted / rejected は残す。SPEC §2）。
      // 選択範囲校正は原文抜粋が選択範囲内に見つかる pending だけ置き換え、
      // 範囲外の pending は残す（SPEC-proofread-selection §4）
      if (selection !== undefined) {
        const { data: pendings, error: pendingError } = await supabase
          .from("revision_suggestions")
          .select("id, original_text")
          .eq("manuscript_link_id", linkId)
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
          .eq("manuscript_link_id", linkId)
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
              manuscript_link_id: linkId,
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
      // （更新バナー＝前回の全文校正以降の変更検知の意味を保つ。SPEC-proofread-selection §2）。
      // 1周も完走しなかった実行も同じ理由で進めない（Issue #281）
      if (selection === undefined && scannedWholeFile) {
        const { error: shaError } = await supabase
          .from("manuscript_links")
          .update({ last_reviewed_commit: latestSha })
          .eq("id", linkId);
        if (shaError)
          console.error("last_reviewed_commit の更新に失敗:", shaError.message);
      }
    }

    // useObject が部分JSONとして読めるよう、要素が確定するたびに書き出している
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
