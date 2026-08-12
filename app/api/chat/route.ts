import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from "ai";

import { generateChatThreadTitle } from "@/lib/ai/chat-title";
import { resolveModel } from "@/lib/ai/models";
import { ASSISTANT_PERSONA_ID } from "@/lib/ai/personas";
import { recordAiUsage } from "@/lib/ai/usage";
import { chatTitleFrom } from "@/lib/chat-title";
import {
  buildDashboardChatPrompt,
  buildDeepDivePrompt,
  type NoteContext,
  type ScheduleContext,
} from "@/lib/ai/prompts";
import { AppError, errorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { chatRequestSchema } from "@/lib/schemas/chat";
import { CRITIQUE_MAX_CHARS } from "@/lib/schemas/manuscript";
import {
  saveMemoNoteInputSchema,
  saveScheduleInputSchema,
  scheduleSchema,
  type SaveMemoNoteOutput,
  type SaveScheduleOutput,
  type Schedule,
} from "@/lib/schemas/schedule";
import { createClient } from "@/lib/supabase/server";
import { deltaSince } from "@/lib/writing-progress";
import {
  aiCapabilities,
  parseEnum,
  projectStatuses,
} from "@/lib/schemas/enums";
import { jstDateString } from "@/lib/date";

// ストリーミング応答のため Vercel Functions の実行上限を延長
export const maxDuration = 60;

/** SPEC-ai-deep-dive §3.2: モデルへ送る履歴は直近20メッセージに制限 */
const HISTORY_LIMIT = 20;

function textOf(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 掘り下げに同梱する関連ノートの上限（トークンコスト抑制。SPEC-ai-deep-dive §3.2） */
const RELATED_NOTES_LIMIT = 10;

/**
 * 対象ノートと同じ仮タイトルタグ（working_title）を持つ関連ノートを取得する（Issue #46）。
 * RLS 越しの取得＝自分のノートのみ。ごみ箱内は除外し、更新が新しい順に上限件数まで。
 * 本文は保存済みDB値（対象ノートだけがエディタ現在値。SPEC-ai-deep-dive §3.2）
 */
async function fetchRelatedNotes(
  supabase: SupabaseServerClient,
  noteId: string,
): Promise<NoteContext[]> {
  // 対象ノートに付いている仮タイトルタグ
  const { data: tagLinks, error: tagError } = await supabase
    .from("note_tags")
    .select("tag_id, tags!inner(kind)")
    .eq("note_id", noteId)
    .eq("tags.kind", "working_title");
  if (tagError) throw new AppError("internal", tagError.message);
  const tagIds = (tagLinks ?? []).map((link) => link.tag_id);
  if (tagIds.length === 0) return [];

  // 同じ仮タイトルタグを持つ他のノートID（複数タグ一致による重複は除去）
  const { data: noteLinks, error: linkError } = await supabase
    .from("note_tags")
    .select("note_id")
    .in("tag_id", tagIds)
    .neq("note_id", noteId);
  if (linkError) throw new AppError("internal", linkError.message);
  const noteIds = [...new Set((noteLinks ?? []).map((link) => link.note_id))];
  if (noteIds.length === 0) return [];

  const { data: notes, error: notesError } = await supabase
    .from("notes")
    .select("title, content, note_tags(tags(name))")
    .in("id", noteIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(RELATED_NOTES_LIMIT);
  if (notesError) throw new AppError("internal", notesError.message);

  return (notes ?? []).map((note) => ({
    title: note.title,
    content: note.content,
    tags: note.note_tags.flatMap((link) => (link.tags ? [link.tags.name] : [])),
  }));
}

/**
 * スケジュールコンテキストをサーバーで組み立てる（SPEC-conversational-personas §5.2）。
 * projects は RLS 越しに取得＝他人のプロジェクトidは not_found（IDOR遮断）
 */
async function buildScheduleContext(
  supabase: SupabaseServerClient,
  projectId: string,
): Promise<ScheduleContext> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("title, status, event_name, deadline, target_pages, schedule")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new AppError("internal", projectError.message);
  if (!project) throw new AppError("not_found", "プロジェクトが見つかりません");

  // 進捗は全行を日付昇順で引き、7日/30日前を跨ぐ直前の記録を増分の基準にする
  const { data: progressRows, error: progressError } = await supabase
    .from("writing_progress")
    .select("date, total_chars")
    .eq("project_id", projectId)
    .order("date");
  if (progressError) throw new AppError("internal", progressError.message);

  const rows = (progressRows ?? []).map((row) => ({
    date: row.date,
    totalChars: row.total_chars,
  }));
  const latest = rows.at(-1) ?? null;
  const today = jstDateString(new Date());

  // 保存済みスケジュール（jsonb）は zod を通し、不正データは未保存として扱う
  const savedSchedule = scheduleSchema.safeParse(project.schedule);

  return {
    projectTitle: project.title,
    status: parseEnum(projectStatuses, project.status, "projects.status"),
    eventName: project.event_name,
    deadline: project.deadline,
    daysRemaining: project.deadline
      ? Math.round(
          (Date.parse(project.deadline) - Date.parse(today)) / 86_400_000,
        )
      : null,
    targetPages: project.target_pages,
    latest,
    delta7: deltaSince(rows, today, 7),
    delta30: deltaSince(rows, today, 30),
    savedSchedule: savedSchedule.success ? savedSchedule.data : null,
  };
}

/**
 * チャットのAIツール（SPEC-schedule-and-memo-tools §5.1・§10）。
 * dashboard 分岐と掘り下げ（note）分岐で共用する。
 * execute は RLS 越しの supabase クライアントをクロージャで掴む＝所有確認は RLS が担う。
 * 失敗は throw せず ok: false で返し、モデルに締めの文で正直に伝えさせる
 */
function buildChatTools(
  supabase: SupabaseServerClient,
  options: { canSaveSchedule: boolean; projectId?: string },
): ToolSet {
  const tools: ToolSet = {
    saveMemoNote: tool({
      description:
        "会話の内容を短いメモ（Markdown）にまとめて、作者のノートとして保存する。作者がメモ化・保存を明確に頼んだときだけ使う",
      inputSchema: saveMemoNoteInputSchema,
      // 戻り値注釈＝クライアントの結果カードとの共有契約（lib/schemas/schedule.ts）
      execute: async ({ content }): Promise<SaveMemoNoteOutput> => {
        // 先頭行がMarkdown記号のみだと chatTitleFrom が空文字を返すため、日付でフォールバック
        const title =
          chatTitleFrom(content) || `メモ ${jstDateString(new Date())}`;
        // user_id は DB デフォルト（auth.uid()）＝本人のノートとしてのみ作られる
        const { data: note, error } = await supabase
          .from("notes")
          .insert({ title, content })
          .select("id, title")
          .single();
        if (error || !note) {
          console.error("saveMemoNote 失敗:", error?.message);
          return { ok: false as const, message: "ノートの作成に失敗しました" };
        }
        return { ok: true as const, noteId: note.id, title: note.title };
      },
    }),
  };

  // アシスタント×プロジェクト選択時のみ登録（それ以外はモデルからツール自体が見えない。SPEC §3）
  if (options.canSaveSchedule && options.projectId) {
    const projectId = options.projectId;
    tools.saveSchedule = tool({
      description:
        "確定した執筆スケジュール（マイルストーンと1日あたり文字数目標）を対象プロジェクトに保存する。既存のスケジュールは丸ごと上書きされる。作者が確定・保存を明確に頼んだときだけ使う",
      inputSchema: saveScheduleInputSchema,
      // 戻り値注釈＝クライアントの結果カードとの共有契約（lib/schemas/schedule.ts）
      execute: async (input): Promise<SaveScheduleOutput> => {
        // id はサーバー採番・done はリセット・期日昇順に整列（SPEC §3）。
        // 器のスキーマ検証は safeParse＝失敗も ok: false で返す（throw だと errorText に乗る）
        const parsed = scheduleSchema.safeParse({
          dailyTargetChars: input.dailyTargetChars,
          milestones: [...input.milestones]
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            .map((milestone) => ({
              ...milestone,
              id: crypto.randomUUID(),
              done: false,
              remindedAt: null,
            })),
          savedAt: new Date().toISOString(),
        });
        if (!parsed.success) {
          return {
            ok: false as const,
            message: "スケジュールの形式が不正です",
          };
        }
        const schedule: Schedule = parsed.data;
        const { data: updated, error } = await supabase
          .from("projects")
          .update({ schedule })
          .eq("id", projectId)
          .select("id");
        if (error || !updated || updated.length === 0) {
          console.error("saveSchedule 失敗:", error?.message);
          return {
            ok: false as const,
            message: "スケジュールの保存に失敗しました",
          };
        }
        return {
          ok: true as const,
          milestoneCount: schedule.milestones.length,
        };
      },
    });
  }

  return tools;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    // APIコスト暴走の抑止（security-audit-20260714 M-1）。会話は対話ペースを想定した上限
    enforceRateLimit(user.id, "chat", { perMinute: 10, perDay: 300 });

    const parsed = chatRequestSchema.safeParse(await req.json());
    if (!parsed.success)
      throw new AppError("validation", "リクエストの形式が不正です");
    const { threadId, context } = parsed.data;
    const messages = parsed.data.messages as unknown as UIMessage[];

    // 1メッセージあたりの本文長は zod では検証できない（UIMessage の構造はSDK任せ）ため、
    // 講評・レビューと同じ合計文字数ガードをここで掛ける（security-audit-20260812 L-1）。
    // 数えるのはモデルへ実際に渡る直近 HISTORY_LIMIT 件だけ——全件を数えると、
    // モデルに渡らない古い履歴が上限を押し上げて長寿スレッドが継続不能になる
    const recent = messages.slice(-HISTORY_LIMIT);
    const chatInputChars = recent.reduce(
      (total, message) => total + textOf(message).length,
      0,
    );
    if (chatInputChars > CRITIQUE_MAX_CHARS) {
      throw new AppError(
        "validation",
        `会話が約${chatInputChars.toLocaleString("ja-JP")}字あり、送信の上限（${CRITIQUE_MAX_CHARS.toLocaleString("ja-JP")}字）を超えています`,
      );
    }

    // RLS越しの取得＝所有確認を兼ねる。担当ペルソナとノートのごみ箱状態も同時に引く
    const { data: thread, error: threadError } = await supabase
      .from("chat_threads")
      .select(
        "id, note_id, persona_id, title, personas (description, ai_capability, persona_type), notes (deleted_at)",
      )
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) throw new AppError("internal", threadError.message);
    if (!thread) throw new AppError("not_found", "スレッドが見つかりません");
    if (!thread.personas)
      throw new AppError("internal", "担当ペルソナが見つかりません");

    // スレッドの実態とコンテキスト形態の食い違いは validation エラー
    if ((context.kind === "note") !== (thread.note_id !== null)) {
      throw new AppError(
        "validation",
        "スレッドとコンテキストの種類が一致しません",
      );
    }

    let system: string;
    let tools: ToolSet | undefined;
    if (context.kind === "note") {
      if (thread.notes?.deleted_at) {
        throw new AppError(
          "not_found",
          "ノートがごみ箱に入っています。復元してから掘り下げてください",
        );
      }
      // note 分岐は kind 検証済みのため thread.note_id は非 null
      const relatedNotes = thread.note_id
        ? await fetchRelatedNotes(supabase, thread.note_id)
        : [];
      system = buildDeepDivePrompt({
        personaDescription: thread.personas.description,
        note: context.note,
        relatedNotes,
      });
      // 掘り下げでもメモ化ツールを使えるようにする（Issue #50・SPEC §10）。
      // saveSchedule はプロジェクト文脈がないため未登録＝モデルから見えない
      tools = buildChatTools(supabase, { canSaveSchedule: false });
    } else {
      // 多層防御: PostgREST 直叩き等で作られた reviewer 型スレッドでの会話を遮断する
      // （正規経路では getOrCreateDashboardThread が同じ検証を済ませている）
      if (thread.personas.persona_type !== "conversational") {
        throw new AppError("validation", "このペルソナとは会話できません");
      }
      // スケジュールデータの同梱はアシスタントのみ（マスターは chat_only を厳密適用）
      const schedule =
        context.projectId && thread.persona_id === ASSISTANT_PERSONA_ID
          ? await buildScheduleContext(supabase, context.projectId)
          : null;
      system = buildDashboardChatPrompt({
        personaDescription: thread.personas.description,
        schedule,
      });
      tools = buildChatTools(supabase, {
        canSaveSchedule:
          thread.persona_id === ASSISTANT_PERSONA_ID &&
          Boolean(context.projectId),
        projectId: context.projectId,
      });
    }

    const { model, provider, modelId } = await resolveModel(
      supabase,
      parseEnum(
        aiCapabilities,
        thread.personas.ai_capability,
        "personas.ai_capability",
      ),
    );

    const result = streamText({
      model,
      system,
      messages: await convertToModelMessages(recent),
      tools,
      // ツール実行後に締めのテキストを続けて生成させる（SPEC §5.1）
      stopWhen: stepCountIs(3),
      // 使用量記録（Issue #45）。usage は全ステップの合算
      onFinish: async ({ usage }) => {
        await recordAiUsage(supabase, {
          feature: "chat",
          provider,
          modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: recent,
        // 応答完了時に差分（今回の user 発言と assistant 応答）だけを永続化する
        onEnd: async ({ messages: finalMessages }) => {
          try {
            const lastUser = [...recent]
              .reverse()
              .find((m) => m.role === "user");
            const assistant = finalMessages[finalMessages.length - 1];
            const rows: {
              thread_id: string;
              role: "user" | "assistant";
              content: string;
            }[] = [];
            if (lastUser) {
              rows.push({
                thread_id: threadId,
                role: "user",
                content: textOf(lastUser),
              });
            }
            if (assistant && assistant.role === "assistant") {
              const content = textOf(assistant);
              if (content)
                rows.push({ thread_id: threadId, role: "assistant", content });
            }
            if (rows.length > 0) {
              const { error } = await supabase
                .from("chat_messages")
                .insert(rows);
              if (error)
                console.error("チャット履歴の保存に失敗:", error.message);
            }
            // ダッシュボード相談のみ: タイトル未設定なら今回の user 発言からAIで自動設定し
            // （サーバー側で本文から生成＝クライアント注入不可・リネーム済みは is null で守る。
            // Issue #44。生成失敗時は chatTitleFrom にフォールバック）、
            // updated_at をバンプする（「最後に更新したスレッドを継続」「一覧の更新日時降順」の
            // 基盤。SPEC-chat-thread-list §5.2）
            if (context.kind === "dashboard") {
              const title =
                thread.title === null && lastUser
                  ? await generateChatThreadTitle(supabase, textOf(lastUser))
                  : "";
              const { data: titled } = title
                ? await supabase
                    .from("chat_threads")
                    .update({ title })
                    .eq("id", threadId)
                    .is("title", null)
                    .select("id")
                : { data: null };
              // タイトル設定が走った経路は set_updated_at トリガーがバンプを兼ねる。
              // 走らなかった経路（設定済み・タイトル生成が空）だけ明示的にバンプする
              if (!titled || titled.length === 0) {
                await supabase
                  .from("chat_threads")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", threadId);
              }
            }
          } catch (error) {
            // 履歴保存の失敗で応答自体は壊さない（次回送信時に履歴から欠けるのみ）
            console.error("チャット履歴の保存に失敗:", error);
          }
        },
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
