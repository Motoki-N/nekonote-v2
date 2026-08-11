"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import { attachTag } from "@/lib/actions/notes";
import { sortByGenrePriority } from "@/lib/genre-priority";
import {
  resolveProfileForPhase,
  resolveReviewerPersona,
} from "@/lib/review-validation";
import type { ReviewVerdict, WritingGenre } from "@/lib/schemas/enums";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.uuid();

// レビュー対象の種別（SPEC-beat-board §3.4。target_ref に入る id の意味が変わる）。
// 値は review_profiles.target_phase と一致させている（プロファイル検証に使う）
export type ReviewTargetKind = "proposal" | "structure" | "scene" | "character";
const reviewTargetKindSchema = z.enum([
  "proposal",
  "structure",
  "scene",
  "character",
]);

export type FeedbackRecord = {
  id: string;
  content: string;
  user_response: string | null;
  verdict: ReviewVerdict | null;
  created_at: string;
};

export type ReviewSessionState = {
  sessionId: string;
  feedbacks: FeedbackRecord[];
};

/** プロファイルセレクタの1項目（SPEC-dashboard-critique-settings §3.2） */
export type ProfileOption = {
  id: string;
  name: string;
  defaultPersonaId: string | null;
  /** この対象× このプロファイルの running セッションに記録済みのペルソナ名（なければ null） */
  runningPersonaName: string | null;
};

export type PersonaOption = {
  id: string;
  name: string;
};

export type ReviewPanelBootstrap = {
  profiles: ProfileOption[];
  /** 起用できるペルソナ（reviewer 型のみ） */
  personas: PersonaOption[];
  /** 既定選択: running セッションが最新のプロファイル → なければ標準（is_default） */
  initialProfileId: string | null;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 対象の RLS 越し所有確認と、セッション作成に使う project_id の解決。
 * target_ref: proposal / character = 企画書id / structure = プロジェクトid / scene = シーンid
 * （キャラクターレビューの資料は企画書一式なので proposal と同じ解決。SPEC-character-review §5.1）
 * noteId: character フェーズをノート1枚に絞り込む場合のみ非null（Issue #47）。
 * ノート単体では project_id が導出できない（notes は project_id を持たない）ため、
 * 必ず「対象企画書との組」で紐づき（proposal_notes）を検証する
 */
async function resolveTarget(
  supabase: Supabase,
  kind: ReviewTargetKind,
  targetId: string,
  noteId: string | null,
): Promise<{ projectId: string }> {
  // structure/scene 等に note_id 付きセッションを作らせない（running 一意性スコープの分裂防止）
  if (noteId !== null && kind !== "character") {
    throw new AppError(
      "validation",
      "ノート単位のレビューはキャラクターレビューのみ対応しています",
    );
  }
  if (kind === "proposal" || kind === "character") {
    const { data, error } = await supabase
      .from("proposals")
      .select("id, project_id")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw new AppError("internal", error.message);
    if (!data) throw new AppError("not_found", "企画書が見つかりません");

    if (noteId !== null) {
      const { data: link, error: linkError } = await supabase
        .from("proposal_notes")
        .select("note_id, notes (deleted_at)")
        .eq("proposal_id", targetId)
        .eq("note_id", noteId)
        .maybeSingle();
      if (linkError) throw new AppError("internal", linkError.message);
      if (!link || !link.notes || link.notes.deleted_at !== null) {
        throw new AppError("not_found", "ノートがこの企画書に紐づいていません");
      }
    }
    return { projectId: data.project_id };
  }
  if (kind === "structure") {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw new AppError("internal", error.message);
    if (!data) throw new AppError("not_found", "プロジェクトが見つかりません");
    return { projectId: data.id };
  }
  const { data, error } = await supabase
    .from("scenes")
    .select("id, project_id")
    .eq("id", targetId)
    .maybeSingle();
  if (error) throw new AppError("internal", error.message);
  if (!data) throw new AppError("not_found", "シーンが見つかりません");
  return { projectId: data.project_id };
}

async function fetchFeedbacks(
  supabase: Supabase,
  sessionId: string,
): Promise<FeedbackRecord[]> {
  const { data, error } = await supabase
    .from("review_feedbacks")
    .select("id, content, user_response, verdict, created_at")
    .eq("review_session_id", sessionId)
    .order("created_at");
  if (error) throw new AppError("internal", error.message);
  return (data ?? []) as FeedbackRecord[];
}

/**
 * パネル初期表示用の一括読み取り（SPEC-dashboard-critique-settings §3.2）。
 * 対象フェーズの「標準＋自分の」プロファイル一覧・reviewer ペルソナ一覧・既定選択を返す
 */
export async function getReviewPanelBootstrap(
  kind: ReviewTargetKind,
  targetId: string,
  noteId?: string,
): Promise<ActionResult<ReviewPanelBootstrap>> {
  try {
    const parsedKind = reviewTargetKindSchema.parse(kind);
    const tid = uuidSchema.parse(targetId);
    const nid = noteId === undefined ? null : uuidSchema.parse(noteId);
    const supabase = await createClient();

    // 既定選択のジャンル優先ソートに使う執筆ジャンルを解決する（SPEC-genre-profiles）
    const { projectId } = await resolveTarget(supabase, parsedKind, tid, nid);

    // running セッションはノート絞り込み（note_id）まで含めた同一スコープのみ拾う（Issue #47）
    let runningQuery = supabase
      .from("review_sessions")
      .select("review_profile_id, created_at, personas (name)")
      .eq("target_ref", tid)
      .eq("status", "running");
    runningQuery =
      nid === null
        ? runningQuery.is("note_id", null)
        : runningQuery.eq("note_id", nid);

    const [profilesResult, personasResult, runningResult, proposalResult] =
      await Promise.all([
        supabase
          .from("review_profiles")
          .select("id, name, is_default, default_persona_id, writing_genre")
          .eq("target_phase", parsedKind)
          .order("is_default", { ascending: false })
          .order("created_at"),
        supabase
          .from("personas")
          .select("id, name")
          .eq("persona_type", "reviewer")
          .order("is_default", { ascending: false })
          .order("created_at"),
        runningQuery.order("created_at", { ascending: false }),
        supabase
          .from("proposals")
          .select("writing_genre")
          .eq("project_id", projectId)
          .maybeSingle(),
      ]);
    if (profilesResult.error)
      throw new AppError("internal", profilesResult.error.message);
    if (personasResult.error)
      throw new AppError("internal", personasResult.error.message);
    if (runningResult.error)
      throw new AppError("internal", runningResult.error.message);
    if (proposalResult.error)
      throw new AppError("internal", proposalResult.error.message);

    const genre = (proposalResult.data?.writing_genre ??
      "novel") as WritingGenre;
    const sortedProfiles = sortByGenrePriority(
      profilesResult.data ?? [],
      genre,
    );

    // プロファイルごとの running セッション（新しい順なので最初の1件が最新）
    const runningByProfile = new Map<string, { personaName: string | null }>();
    for (const session of runningResult.data ?? []) {
      if (
        session.review_profile_id &&
        !runningByProfile.has(session.review_profile_id)
      ) {
        runningByProfile.set(session.review_profile_id, {
          personaName: session.personas?.name ?? null,
        });
      }
    }

    const profiles: ProfileOption[] = sortedProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      defaultPersonaId: p.default_persona_id,
      runningPersonaName: runningByProfile.get(p.id)?.personaName ?? null,
    }));

    // 既定選択: running セッションが最新のプロファイル → ジャンル優先ソート後の先頭
    // （旧「is_default を探す」はソート後先頭に包含される。同順位内は is_default desc が維持されるため）
    const latestRunningProfileId = (runningResult.data ?? []).find(
      (s) =>
        s.review_profile_id &&
        profiles.some((p) => p.id === s.review_profile_id),
    )?.review_profile_id;
    const initialProfileId = latestRunningProfileId ?? profiles[0]?.id ?? null;

    return {
      ok: true,
      data: {
        profiles,
        personas: (personasResult.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
        })),
        initialProfileId,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** パネル表示用の読み取り: 対象×プロファイルの running セッションがなければ null（開いただけでは行を作らない） */
export async function getReviewSessionState(
  kind: ReviewTargetKind,
  targetId: string,
  profileId: string,
  noteId?: string,
): Promise<ActionResult<ReviewSessionState | null>> {
  try {
    reviewTargetKindSchema.parse(kind);
    const tid = uuidSchema.parse(targetId);
    const pid = uuidSchema.parse(profileId);
    const nid = noteId === undefined ? null : uuidSchema.parse(noteId);
    const supabase = await createClient();

    // 対象×プロファイル×ノート絞り込みごとにセッションが並存する
    // （SPEC-dashboard-critique-settings §3.2、note_id は Issue #47）
    let query = supabase
      .from("review_sessions")
      .select("id")
      .eq("target_ref", tid)
      .eq("review_profile_id", pid)
      .eq("status", "running");
    query = nid === null ? query.is("note_id", null) : query.eq("note_id", nid);
    const { data: session, error: selectError } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selectError) throw new AppError("internal", selectError.message);
    if (!session) return { ok: true, data: null };

    return {
      ok: true,
      data: {
        sessionId: session.id,
        feedbacks: await fetchFeedbacks(supabase, session.id),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * running レビューセッション（反復スレッド）を get-or-create し、フィードバック履歴を返す。
 * running セッションは対象×プロファイル×ノート絞り込みごとに高々1本（アプリロジックで担保）。
 * profileId / personaId はクライアント指定値なのでサーバー側で再検証する（フェーズ一致・reviewer 型）。
 * personaId は新規セッション作成時のみ効く（既存 running のペルソナは変更しない=会話の一貫性）。
 * noteId は character フェーズ専用（resolveTarget で企画書との紐づきを検証。Issue #47）
 */
export async function getOrCreateReviewSession(
  kind: ReviewTargetKind,
  targetId: string,
  profileId: string,
  personaId?: string,
  noteId?: string,
): Promise<ActionResult<ReviewSessionState>> {
  try {
    const parsedKind = reviewTargetKindSchema.parse(kind);
    const tid = uuidSchema.parse(targetId);
    const pid = uuidSchema.parse(profileId);
    const requestedPersonaId =
      personaId === undefined ? undefined : uuidSchema.parse(personaId);
    const nid = noteId === undefined ? null : uuidSchema.parse(noteId);
    const supabase = await createClient();

    const { projectId } = await resolveTarget(supabase, parsedKind, tid, nid);
    const profile = await resolveProfileForPhase(supabase, pid, parsedKind);

    let query = supabase
      .from("review_sessions")
      .select("id")
      .eq("target_ref", tid)
      .eq("review_profile_id", pid)
      .eq("status", "running");
    query = nid === null ? query.is("note_id", null) : query.eq("note_id", nid);
    const { data: existing, error: selectError } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selectError) throw new AppError("internal", selectError.message);

    let sessionId = existing?.id;
    if (!sessionId) {
      const effectivePersonaId = requestedPersonaId ?? profile.defaultPersonaId;
      if (!effectivePersonaId) {
        throw new AppError("validation", "担当ペルソナを選択してください");
      }
      const persona = await resolveReviewerPersona(
        supabase,
        effectivePersonaId,
      );

      const { data: created, error: insertError } = await supabase
        .from("review_sessions")
        .insert({
          project_id: projectId,
          review_profile_id: profile.id,
          persona_id: persona.id,
          target_ref: tid,
          note_id: nid,
          status: "running",
        })
        .select("id")
        .single();
      if (insertError || !created) {
        throw new AppError(
          "internal",
          insertError?.message ?? "レビューセッションの作成に失敗しました",
        );
      }
      sessionId = created.id;
    }

    return {
      ok: true,
      data: { sessionId, feedbacks: await fetchFeedbacks(supabase, sessionId) },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** ノート編集画面からのキャラクターレビュー起動用: ノートが紐づく企画書の選択肢（Issue #47） */
export type LinkedProposalOption = {
  proposalId: string;
  projectTitle: string;
};

/** ノートが紐づく企画書一覧を返す（RLS越し＝自分のノート・企画書のみ。ごみ箱ノートでも一覧自体は引ける） */
export async function getLinkedProposalsForNote(
  noteId: string,
): Promise<ActionResult<LinkedProposalOption[]>> {
  try {
    const nid = uuidSchema.parse(noteId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("proposal_notes")
      .select("proposals (id, created_at, projects (title))")
      .eq("note_id", nid);
    if (error) throw new AppError("internal", error.message);
    const options = (data ?? [])
      .flatMap((row) => (row.proposals ? [row.proposals] : []))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => ({
        proposalId: p.id,
        projectTitle: p.projects?.title ?? "（無題の企画）",
      }));
    return { ok: true, data: options };
  } catch (error) {
    return toActionError(error);
  }
}

/** フィードバックへの返答メモを保存する（改稿の意図や反論を次のレビューに伝える） */
export async function saveFeedbackResponse(
  feedbackId: string,
  text: string,
): Promise<ActionResult> {
  try {
    const fid = uuidSchema.parse(feedbackId);
    const response = z.string().max(5000).parse(text);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("review_feedbacks")
      .update({ user_response: response.trim() === "" ? null : response })
      .eq("id", fid)
      .select("id");
    if (error) throw new AppError("internal", error.message);
    if (!data || data.length === 0)
      throw new AppError("not_found", "フィードバックが見つかりません");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * フィードバックをノートに転記して保存する（Issue #99・#173）。
 * レビュー指摘の対応状況をノート上でメモしながら追えるようにする。
 * ノートのタイトルにプロジェクトタイトルとプロファイル名・第何回のレビューかを付記し、
 * プロジェクトタイトルの仮タイトルタグを付与して作品単位で束ねる。
 * 本文はDBから読み直す＝クライアント改変の混入を防ぐ（saveChatMessageAsNote と同じ流儀）
 */
export async function saveFeedbackAsNote(
  feedbackId: string,
): Promise<ActionResult<{ noteId: string }>> {
  try {
    const fid = uuidSchema.parse(feedbackId);
    const supabase = await createClient();

    // RLS越しの取得＝所有確認を兼ねる。セッション経由でレビュー種別とプロジェクトタイトルを引く
    const { data: feedback, error: selectError } = await supabase
      .from("review_feedbacks")
      .select(
        "id, content, created_at, review_session_id, review_sessions (review_profiles (name, target_phase), projects (title))",
      )
      .eq("id", fid)
      .maybeSingle();
    if (selectError) throw new AppError("internal", selectError.message);
    if (!feedback)
      throw new AppError("not_found", "フィードバックが見つかりません");

    const session = feedback.review_sessions;
    // 転記を許可する種別: 企画書（Issue #99）・構成（Issue #173）
    if (
      session?.review_profiles?.target_phase !== "proposal" &&
      session?.review_profiles?.target_phase !== "structure"
    ) {
      throw new AppError(
        "validation",
        "企画書・構成レビューのフィードバックのみノートに転記できます",
      );
    }
    const projectTitle = session.projects?.title;
    if (!projectTitle)
      throw new AppError("internal", "プロジェクトが見つかりません");

    // 第何回か = 同一セッション内でこのフィードバック以前に作られた件数（パネルの「第N回」と同じ数え方）
    const { count, error: countError } = await supabase
      .from("review_feedbacks")
      .select("id", { count: "exact", head: true })
      .eq("review_session_id", feedback.review_session_id)
      .lte("created_at", feedback.created_at);
    if (countError) throw new AppError("internal", countError.message);
    const round = count ?? 1;

    const date = new Date(feedback.created_at).toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo",
    });
    const title = `「${projectTitle}」${session.review_profiles.name} 第${round}回（${date}）`;

    const { data: note, error: insertError } = await supabase
      .from("notes")
      .insert({ title, content: feedback.content })
      .select("id")
      .single();
    if (insertError || !note) {
      throw new AppError(
        "internal",
        insertError?.message ?? "ノートの作成に失敗しました",
      );
    }

    // 企画書タイトルの仮タイトルタグを get-or-create して付与（attachTag が /notes を revalidate する）
    const tagResult = await attachTag(note.id, {
      name: projectTitle,
      kind: "working_title",
    });
    if (!tagResult.ok) return tagResult;

    return { ok: true, data: { noteId: note.id } };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 「企画を通す」確定（SPEC-proposal-review §3.2）。
 * プロファイル並存で「対象の最新 running」が一意でなくなったため、
 * パネルが表示中のセッション id を明示的に受け取る（SPEC-dashboard-critique-settings §3.2）。
 * 最新フィードバックの判定が承認であることをサーバー側でも検証したうえで、
 * proposals.status = approved ＋セッション completed にする
 */
export async function approveProposal(
  sessionId: string,
): Promise<ActionResult> {
  try {
    const sid = uuidSchema.parse(sessionId);
    const supabase = await createClient();

    // RLS越しの取得＝所有確認を兼ねる
    const { data: session, error: sessionError } = await supabase
      .from("review_sessions")
      .select(
        "id, project_id, target_ref, status, review_profiles (target_phase)",
      )
      .eq("id", sid)
      .maybeSingle();
    if (sessionError) throw new AppError("internal", sessionError.message);
    if (!session)
      throw new AppError("not_found", "レビューセッションが見つかりません");
    if (session.status !== "running") {
      throw new AppError(
        "validation",
        "このレビューセッションは終了しています",
      );
    }
    // 企画書レビューのセッションであること（他フェーズのセッションで企画を通させない）
    if (session.review_profiles?.target_phase !== "proposal") {
      throw new AppError(
        "validation",
        "企画書レビューのセッションではありません",
      );
    }
    const proposalId = uuidSchema.safeParse(session.target_ref);
    if (!proposalId.success)
      throw new AppError("internal", "レビュー対象が不正です");

    const { data: latest, error: latestError } = await supabase
      .from("review_feedbacks")
      .select("verdict")
      .eq("review_session_id", session.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new AppError("internal", latestError.message);
    if (latest?.verdict !== "approved") {
      throw new AppError(
        "validation",
        "最新のレビューで承認が出ていないため、企画を通せません",
      );
    }

    const { data: updated, error: proposalError } = await supabase
      .from("proposals")
      .update({ status: "approved" })
      .eq("id", proposalId.data)
      .eq("project_id", session.project_id) // セッションと企画書の対応を担保
      .select("id");
    if (proposalError) throw new AppError("internal", proposalError.message);
    if (!updated || updated.length === 0)
      throw new AppError("not_found", "企画書が見つかりません");

    const { error: completeError } = await supabase
      .from("review_sessions")
      .update({ status: "completed" })
      .eq("id", session.id);
    if (completeError) throw new AppError("internal", completeError.message);

    revalidatePath("/projects");
    revalidatePath(`/projects/${session.project_id}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * 構成/シーンレビューの「通す」確定（Issue #57）。
 * approveProposal と同じ流儀: パネルが表示中のセッション id を受け取り、
 * 最新フィードバックの判定が承認であることをサーバー側でも検証したうえで、
 * 対象のステータスを approved ＋セッション completed にする。
 * 永続先は構成 = projects.structure_status / シーン = scenes.status（draft/approved の2状態）
 */
export async function approveBoardReview(
  sessionId: string,
): Promise<ActionResult> {
  try {
    const sid = uuidSchema.parse(sessionId);
    const supabase = await createClient();

    // RLS越しの取得＝所有確認を兼ねる
    const { data: session, error: sessionError } = await supabase
      .from("review_sessions")
      .select(
        "id, project_id, target_ref, status, review_profiles (target_phase)",
      )
      .eq("id", sid)
      .maybeSingle();
    if (sessionError) throw new AppError("internal", sessionError.message);
    if (!session)
      throw new AppError("not_found", "レビューセッションが見つかりません");
    if (session.status !== "running") {
      throw new AppError(
        "validation",
        "このレビューセッションは終了しています",
      );
    }
    // 構成/シーンレビューのセッションであること（他フェーズのセッションで通させない）
    const phase = session.review_profiles?.target_phase;
    if (phase !== "structure" && phase !== "scene") {
      throw new AppError(
        "validation",
        "構成・シーンレビューのセッションではありません",
      );
    }
    const targetRef = uuidSchema.safeParse(session.target_ref);
    if (!targetRef.success)
      throw new AppError("internal", "レビュー対象が不正です");

    const { data: latest, error: latestError } = await supabase
      .from("review_feedbacks")
      .select("verdict")
      .eq("review_session_id", session.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new AppError("internal", latestError.message);
    if (latest?.verdict !== "approved") {
      throw new AppError(
        "validation",
        "最新のレビューで承認が出ていないため、通せません",
      );
    }

    if (phase === "structure") {
      // 構成レビューの target_ref = プロジェクト id（セッションのプロジェクトと一致していること）
      if (targetRef.data !== session.project_id) {
        throw new AppError("not_found", "レビュー対象が見つかりません");
      }
      const { data: updated, error: updateError } = await supabase
        .from("projects")
        .update({ structure_status: "approved" })
        .eq("id", session.project_id)
        .select("id");
      if (updateError) throw new AppError("internal", updateError.message);
      if (!updated || updated.length === 0) {
        throw new AppError("not_found", "プロジェクトが見つかりません");
      }
    } else {
      const { data: updated, error: updateError } = await supabase
        .from("scenes")
        .update({ status: "approved" })
        .eq("id", targetRef.data)
        .eq("project_id", session.project_id) // セッションとシーンの対応を担保
        .select("id");
      if (updateError) throw new AppError("internal", updateError.message);
      if (!updated || updated.length === 0)
        throw new AppError("not_found", "シーンが見つかりません");
    }

    const { error: completeError } = await supabase
      .from("review_sessions")
      .update({ status: "completed" })
      .eq("id", session.id);
    if (completeError) throw new AppError("internal", completeError.message);

    revalidatePath(`/projects/${session.project_id}/board`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
