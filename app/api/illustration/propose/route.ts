import { generateObject } from "ai";

import { resolveModel } from "@/lib/ai/models";
import { ILLUSTRATOR_PERSONA_ID } from "@/lib/ai/personas";
import { recordAiUsage } from "@/lib/ai/usage";
import {
  buildIllustrationProposeInput,
  buildIllustrationProposeSystemPrompt,
  type ManuscriptFileContext,
  type NoteContext,
  type ProposalContext,
} from "@/lib/ai/prompts";
import { AppError, errorResponse } from "@/lib/errors";
import { patCredentialProvider } from "@/lib/git/credentials";
import { getFileContent } from "@/lib/git/github";
import {
  countChars,
  fetchAllManuscriptContents,
} from "@/lib/manuscript-content";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  COLOR_MODE_LABEL,
  ILLUSTRATION_KIND_LABEL,
  proposeOutputSchema,
  proposeRequestSchema,
  type IllustrationRequest,
} from "@/lib/schemas/illustration";
import { CRITIQUE_MAX_CHARS } from "@/lib/schemas/manuscript";
import { createClient } from "@/lib/supabase/server";
import { aiCapabilities, parseEnum, writingGenres } from "@/lib/schemas/enums";

export const maxDuration = 60;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 企画書一式（企画書＋紐づけノート。ごみ箱中は除外）。未作成なら null（依頼文だけで案を練る） */
async function fetchProposalMaterials(
  supabase: Supabase,
  projectId: string,
): Promise<{ proposal: ProposalContext | null; notes: NoteContext[] }> {
  const { data: proposal, error: proposalError } = await supabase
    .from("proposals")
    .select("id, writing_genre, purpose, genre, target_audience, content")
    .eq("project_id", projectId)
    .maybeSingle();
  if (proposalError) throw new AppError("internal", proposalError.message);
  if (!proposal) return { proposal: null, notes: [] };

  const { data: links, error: linksError } = await supabase
    .from("proposal_notes")
    .select("notes (title, content, deleted_at, note_tags (tags (name)))")
    .eq("proposal_id", proposal.id);
  if (linksError) throw new AppError("internal", linksError.message);
  const notes: NoteContext[] = (links ?? [])
    .flatMap((row) => (row.notes ? [row.notes] : []))
    .filter((note) => note.deleted_at === null)
    .map((note) => ({
      title: note.title,
      content: note.content,
      tags: note.note_tags.flatMap((nt) => (nt.tags ? [nt.tags.name] : [])),
    }));

  return {
    proposal: {
      writingGenre: parseEnum(
        writingGenres,
        proposal.writing_genre,
        "proposals.writing_genre",
      ),
      purpose: proposal.purpose,
      genre: proposal.genre,
      targetAudience: proposal.target_audience,
      content: proposal.content,
    },
    notes,
  };
}

/**
 * 種別ごとの原稿資料（SPEC-illustrator §5.2）。
 * 表紙・コンセプト: 全文（原稿未接続なら空=企画書のみ）/ 挿絵: 選択ファイルのみ（未接続はエラー）
 */
async function fetchManuscriptMaterials(
  supabase: Supabase,
  request: IllustrationRequest,
  project: { repo: string | null; base_path: string | null },
): Promise<ManuscriptFileContext[]> {
  if (request.kind === "character") return [];

  const connected = Boolean(project.repo);
  const credential = connected
    ? await patCredentialProvider.getCredential(supabase)
    : null;

  if (request.kind === "insert") {
    // 挿絵は対象ファイルが資料の本体。原稿に繋がっていなければ依頼が成立しない
    if (!project.repo)
      throw new AppError("validation", "リポジトリが設定されていません");
    if (!credential) throw new AppError("validation", "GitHub PATが未登録です");
    const path = request.manuscriptPath;
    if (!path)
      throw new AppError(
        "validation",
        "挿絵は対象の原稿ファイルを選択してください",
      );
    // base_path 配下のみ許可（任意パス指定でリポジトリ内の他ファイルを読ませない）
    const basePath = project.base_path ?? "";
    if (
      basePath !== "" &&
      !path.startsWith(`${basePath.replace(/\/$/, "")}/`)
    ) {
      throw new AppError(
        "validation",
        "対象ファイルが原稿フォルダの外にあります",
      );
    }
    const file = await getFileContent(credential.token, project.repo, path);
    return [{ path, content: file.content }];
  }

  // 表紙・コンセプトアート: 原稿全文（未接続・PAT未登録なら企画書のみで進める）
  if (!project.repo || !credential) return [];
  const files = await fetchAllManuscriptContents(
    credential.token,
    project.repo,
    project.base_path ?? "",
  );
  return files;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    // APIコスト暴走の抑止。案出しはテキスト生成なので generate より緩め（SPEC §5.3）
    enforceRateLimit(user.id, "illustration-propose", {
      perMinute: 5,
      perDay: 50,
    });

    const parsed = proposeRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError(
        "validation",
        parsed.error.issues[0]?.message ?? "リクエストの形式が不正です",
      );
    }
    const request = parsed.data.request;

    // RLS越しの取得＝所有確認を兼ねる
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, title, repo, base_path")
      .eq("id", request.projectId)
      .maybeSingle();
    if (projectError) throw new AppError("internal", projectError.message);
    if (!project)
      throw new AppError("not_found", "プロジェクトが見つかりません");

    // 参照画像はRLS越しの取得で所有確認（他人のイラストは not_found。SPEC §6）。
    // 案出しでは画像そのものは使わず、元プロンプトをテキスト文脈として渡す
    let referencePrompt: string | null = null;
    if (request.referenceIllustrationId) {
      const { data: reference, error: referenceError } = await supabase
        .from("illustrations")
        .select("id, prompt")
        .eq("id", request.referenceIllustrationId)
        .maybeSingle();
      if (referenceError)
        throw new AppError("internal", referenceError.message);
      if (!reference)
        throw new AppError("not_found", "参照イラストが見つかりません");
      referencePrompt = reference.prompt;
    }

    // イラストレーターペルソナ（標準シード。description はユーザー編集可）
    const { data: persona, error: personaError } = await supabase
      .from("personas")
      .select("description, ai_capability")
      .eq("id", ILLUSTRATOR_PERSONA_ID)
      .maybeSingle();
    if (personaError) throw new AppError("internal", personaError.message);
    if (!persona)
      throw new AppError(
        "internal",
        "イラストレーターペルソナが見つかりません",
      );

    // 挿絵は選択ファイル＋場面補足のみ（§5.2 の出し分け。企画書一式は渡さない）
    const { proposal, notes } =
      request.kind === "insert"
        ? { proposal: null, notes: [] }
        : await fetchProposalMaterials(supabase, project.id);
    const manuscriptFiles = await fetchManuscriptMaterials(
      supabase,
      request,
      project,
    );

    // LLM入力の肥大化ガード（講評の実行不可ラインを流用）
    const inputChars =
      (proposal ? countChars(proposal.content) : 0) +
      notes.reduce((sum, note) => sum + countChars(note.content), 0) +
      manuscriptFiles.reduce((sum, file) => sum + countChars(file.content), 0);
    if (inputChars > CRITIQUE_MAX_CHARS) {
      throw new AppError(
        "validation",
        `参照資料が約${inputChars.toLocaleString("ja-JP")}字あり、案出しの上限（${CRITIQUE_MAX_CHARS.toLocaleString("ja-JP")}字）を超えています`,
      );
    }

    // 見出しはツリー表示と同じ相対パスにする（講評と同じ流儀）
    const basePath = project.base_path ?? "";
    const prefixLength =
      basePath === "" ? 0 : basePath.replace(/\/$/, "").length + 1;

    const { model, provider, modelId } = await resolveModel(
      supabase,
      parseEnum(
        aiCapabilities,
        persona.ai_capability,
        "personas.ai_capability",
      ),
    );
    const { object, usage } = await generateObject({
      model,
      schema: proposeOutputSchema,
      system: buildIllustrationProposeSystemPrompt({
        personaDescription: persona.description,
      }),
      prompt: buildIllustrationProposeInput({
        request: {
          kindLabel: ILLUSTRATION_KIND_LABEL[request.kind],
          colorModeLabel: COLOR_MODE_LABEL[request.colorMode],
          aspectRatio: request.aspectRatio,
          instructions: request.instructions,
          sceneNote: request.sceneNote ?? null,
          referencePrompt,
        },
        proposal,
        notes,
        manuscriptFiles: manuscriptFiles.map((f) => ({
          path: f.path.slice(prefixLength),
          content: f.content,
        })),
      }),
    });

    // 使用量記録（Issue #45）
    await recordAiUsage(supabase, {
      feature: "illustration-propose",
      provider,
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    return Response.json({ proposals: object.proposals });
  } catch (error) {
    return errorResponse(error);
  }
}
