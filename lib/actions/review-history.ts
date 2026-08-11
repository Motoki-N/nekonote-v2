"use server";

import { z } from "zod";

import { AppError, toActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/errors";
import type { ReviewVerdict } from "@/lib/schemas/enums";
import { createClient } from "@/lib/supabase/server";
import {
  parseEnum,
  parseEnumOrNull,
  reviewSessionStatuses,
  reviewVerdicts,
} from "@/lib/schemas/enums";

// レビュー履歴の一覧・閲覧（SPEC-review-history）。
// review_sessions / review_feedbacks を RLS 越しに読むだけの読み取り専用アクション

const uuidSchema = z.uuid();

/** review_profiles.target_phase の値（プロファイル削除済みセッションは null） */
export type ReviewHistoryPhase =
  "proposal" | "structure" | "scene" | "character" | "manuscript";

export type ReviewSessionSummary = {
  sessionId: string;
  phase: ReviewHistoryPhase | null;
  /** 削除済みプロファイルは null（UIで「（削除済みプロファイル）」表示） */
  profileName: string | null;
  personaName: string | null;
  /** シーン名・ノート名など対象の補足（企画書・構成・講評は対象が自明のため null） */
  targetLabel: string | null;
  status: "running" | "completed" | "failed";
  createdAt: string;
  feedbackCount: number;
  latestVerdict: ReviewVerdict | null;
};

export type ReviewHistoryFeedback = {
  id: string;
  content: string;
  userResponse: string | null;
  verdict: ReviewVerdict | null;
  createdAt: string;
};

/**
 * プロジェクトの全レビューセッションのサマリ一覧（作成日時降順。SPEC-review-history §3.2）。
 * 本文は含めない＝一覧を軽く保つ（本文は getReviewHistoryFeedbacks で遅延取得）。
 * サーバーコンポーネントから呼ぶ想定
 */
export async function listReviewSessions(
  projectId: string,
): Promise<ActionResult<ReviewSessionSummary[]>> {
  try {
    const pid = uuidSchema.parse(projectId);
    const supabase = await createClient();

    const { data: sessions, error } = await supabase
      .from("review_sessions")
      .select(
        "id, target_ref, note_id, status, created_at, review_profiles (name, target_phase), personas (name), review_feedbacks (verdict, created_at)",
      )
      .eq("project_id", pid)
      .order("created_at", { ascending: false });
    if (error) throw new AppError("internal", error.message);

    // 対象ラベル解決: シーン名・ノート名をまとめて引く（削除済みはフォールバック表示）
    const sceneIds = (sessions ?? [])
      .filter(
        (s) =>
          s.review_profiles?.target_phase === "scene" && s.target_ref !== null,
      )
      .map((s) => s.target_ref as string)
      .filter((ref) => uuidSchema.safeParse(ref).success);
    const noteIds = (sessions ?? []).flatMap((s) =>
      s.note_id !== null ? [s.note_id] : [],
    );

    const [scenesResult, notesResult] = await Promise.all([
      sceneIds.length > 0
        ? supabase.from("scenes").select("id, title").in("id", sceneIds)
        : Promise.resolve({ data: [], error: null }),
      noteIds.length > 0
        ? supabase.from("notes").select("id, title").in("id", noteIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (scenesResult.error)
      throw new AppError("internal", scenesResult.error.message);
    if (notesResult.error)
      throw new AppError("internal", notesResult.error.message);
    const sceneTitles = new Map(
      (scenesResult.data ?? []).map((s) => [s.id, s.title]),
    );
    const noteTitles = new Map(
      (notesResult.data ?? []).map((n) => [n.id, n.title]),
    );

    const summaries: ReviewSessionSummary[] = (sessions ?? []).map(
      (session) => {
        const phase = (session.review_profiles?.target_phase ??
          null) as ReviewHistoryPhase | null;

        let targetLabel: string | null = null;
        if (phase === "scene" && session.target_ref !== null) {
          const title = sceneTitles.get(session.target_ref);
          targetLabel =
            title === undefined
              ? "（削除済みシーン）"
              : title || "（無題のシーン）";
        } else if (session.note_id !== null) {
          const title = noteTitles.get(session.note_id);
          targetLabel =
            title === undefined
              ? "（削除済みノート）"
              : title || "（無題のノート）";
        }

        // 回数と最新判定はフィードバックの作成順から導出する
        const feedbacks = [...session.review_feedbacks].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
        return {
          sessionId: session.id,
          phase,
          profileName: session.review_profiles?.name ?? null,
          personaName: session.personas?.name ?? null,
          targetLabel,
          status: parseEnum(
            reviewSessionStatuses,
            session.status,
            "review_sessions.status",
          ),
          createdAt: session.created_at,
          feedbackCount: feedbacks.length,
          latestVerdict: parseEnumOrNull(
            reviewVerdicts,
            feedbacks.at(-1)?.verdict ?? null,
            "review_feedbacks.verdict",
          ),
        };
      },
    );

    return { ok: true, data: summaries };
  } catch (error) {
    return toActionError(error);
  }
}

/** セッションのフィードバック往復を取得する（行を開いたときの遅延取得。RLS越し＝所有確認） */
export async function getReviewHistoryFeedbacks(
  sessionId: string,
): Promise<ActionResult<ReviewHistoryFeedback[]>> {
  try {
    const sid = uuidSchema.parse(sessionId);
    const supabase = await createClient();

    // RLS越しの存在確認（他人のセッションは0件になり not_found）
    const { data: session, error: sessionError } = await supabase
      .from("review_sessions")
      .select("id")
      .eq("id", sid)
      .maybeSingle();
    if (sessionError) throw new AppError("internal", sessionError.message);
    if (!session)
      throw new AppError("not_found", "レビューセッションが見つかりません");

    const { data, error } = await supabase
      .from("review_feedbacks")
      .select("id, content, user_response, verdict, created_at")
      .eq("review_session_id", sid)
      .order("created_at");
    if (error) throw new AppError("internal", error.message);

    return {
      ok: true,
      data: (data ?? []).map((f) => ({
        id: f.id,
        content: f.content,
        userResponse: f.user_response,
        verdict: parseEnumOrNull(
          reviewVerdicts,
          f.verdict,
          "review_feedbacks.verdict",
        ),
        createdAt: f.created_at,
      })),
    };
  } catch (error) {
    return toActionError(error);
  }
}
