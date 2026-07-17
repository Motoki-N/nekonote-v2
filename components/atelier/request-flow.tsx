"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { getManuscriptTree, type ManuscriptTreeData } from "@/lib/actions/manuscripts";
import { illustrationKinds, type IllustrationKind } from "@/lib/schemas/enums";
import {
  COLOR_MODE_LABEL,
  colorModes,
  DEFAULT_ASPECT_RATIO,
  ILLUSTRATION_KIND_LABEL,
  illustrationAspectRatios,
  type ColorMode,
  type IllustrationAspectRatio,
  type IllustrationItem,
  type IllustrationProposal,
} from "@/lib/schemas/illustration";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { selectClass, type AtelierProject } from "@/components/atelier/atelier-workspace";

const ASPECT_LABEL: Record<IllustrationAspectRatio, string> = {
  "2:3": "縦（2:3）",
  "16:9": "横（16:9）",
  "1:1": "正方形",
};

/** API の errorResponse（JSON）からユーザー向けメッセージを取り出す（critique-panel と同じ流儀） */
async function toDisplayError(res: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await res.json()) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // JSON でなければ汎用文言にフォールバック
  }
  return fallback;
}

/**
 * 依頼フォーム＋2段階生成フロー（SPEC-illustrator §4.2〜4.3）。
 * 案出しで埋まるプロンプト欄は直接編集も可能＝参照画像つきの編集依頼（文字入れ・修正）は
 * 案出しを飛ばしてそのまま生成できる
 */
export function RequestFlow({
  project,
  reference,
  deletedId,
  onSetReference,
  onGenerated,
}: {
  project: AtelierProject;
  reference: IllustrationItem | null;
  /** ギャラリーで削除されたイラストid（生成結果パネルの後始末用） */
  deletedId: string | null;
  onSetReference: (item: IllustrationItem | null) => void;
  onGenerated: (item: IllustrationItem) => void;
}) {
  const [kind, setKind] = useState<IllustrationKind>("cover");
  const [colorMode, setColorMode] = useState<ColorMode>("color");
  const [aspectRatio, setAspectRatio] = useState<IllustrationAspectRatio>(
    DEFAULT_ASPECT_RATIO.cover,
  );
  const [instructions, setInstructions] = useState("");
  const [manuscriptPath, setManuscriptPath] = useState("");
  const [sceneNote, setSceneNote] = useState("");

  // 挿絵の対象ファイル一覧（kind=insert かつ repo 設定済みのときだけ取得）。
  // fetch_failed は一時エラー（GitHub API 失敗等）＝再試行ボタンで tree を null に戻して取り直す
  const [tree, setTree] = useState<ManuscriptTreeData | { gate: "fetch_failed" } | null>(null);

  const [proposals, setProposals] = useState<IllustrationProposal[] | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"propose" | "generate" | null>(null);
  const [result, setResult] = useState<IllustrationItem | null>(null);

  useEffect(() => {
    if (kind !== "insert" || tree !== null || !project.hasRepo) return;
    let cancelled = false;
    void getManuscriptTree(project.id).then((res) => {
      if (cancelled) return;
      setTree(res.ok && res.data ? res.data : { gate: "fetch_failed" });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, tree, project.id, project.hasRepo]);

  // ギャラリーで削除された画像は結果パネルからも消す（削除済みidへの参照依頼を防ぐ）
  if (result && result.id === deletedId) {
    setResult(null);
  }

  // 参照画像が設定されたら、そのプロンプトを下敷きにする（SPEC §4.4「引き継ぎ」）
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (reference && prefilledFor !== reference.id) {
    setPrefilledFor(reference.id);
    setPrompt(reference.prompt);
    setProposals(null);
    setSelectedProposal(null);
  }
  if (!reference && prefilledFor !== null) {
    setPrefilledFor(null);
  }

  function buildRequest() {
    return {
      projectId: project.id,
      kind,
      colorMode,
      aspectRatio,
      instructions,
      manuscriptPath: kind === "insert" ? manuscriptPath || undefined : undefined,
      sceneNote: kind === "insert" ? sceneNote || undefined : undefined,
      referenceIllustrationId: reference?.id,
    };
  }

  function validate(): string | null {
    if (instructions.trim() === "") return "描いてほしい内容を入力してください";
    if (kind === "insert" && manuscriptPath === "") return "挿絵は対象の原稿ファイルを選択してください";
    return null;
  }

  async function handlePropose() {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy("propose");
    setProposals(null);
    setSelectedProposal(null);
    try {
      const res = await fetch("/api/illustration/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: buildRequest() }),
      });
      if (!res.ok) {
        toast.error(await toDisplayError(res, "案出しに失敗しました。時間をおいて再試行してください"));
        return;
      }
      const data = (await res.json()) as { proposals: IllustrationProposal[] };
      setProposals(data.proposals);
    } catch {
      toast.error("案出しに失敗しました。通信環境を確認してください");
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    if (prompt.trim() === "") {
      toast.error("プロンプトが空です。案を選ぶか、直接入力してください");
      return;
    }
    setBusy("generate");
    try {
      const res = await fetch("/api/illustration/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: buildRequest(), prompt }),
      });
      if (!res.ok) {
        toast.error(await toDisplayError(res, "生成に失敗しました。時間をおいて再試行してください"));
        return;
      }
      const data = (await res.json()) as { illustration: IllustrationItem };
      setResult(data.illustration);
      onGenerated(data.illustration);
      toast("イラストを生成しました");
    } catch {
      toast.error("生成に失敗しました。通信環境を確認してください");
    } finally {
      setBusy(null);
    }
  }

  const treeFiles = tree?.gate === "ok" ? tree.files : [];
  const treePrefix =
    tree?.gate === "ok" && tree.basePath !== ""
      ? tree.basePath.replace(/\/$/, "").length + 1
      : 0;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold text-card-foreground">イラスト依頼</h2>

      {/* 依頼フォーム（§4.2） */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          種別
          <select
            className={selectClass}
            value={kind}
            disabled={busy !== null}
            onChange={(e) => {
              const next = e.target.value as IllustrationKind;
              setKind(next);
              setAspectRatio(DEFAULT_ASPECT_RATIO[next]);
            }}
          >
            {illustrationKinds.map((value) => (
              <option key={value} value={value}>
                {ILLUSTRATION_KIND_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          色
          <select
            className={selectClass}
            value={colorMode}
            disabled={busy !== null}
            onChange={(e) => setColorMode(e.target.value as ColorMode)}
          >
            {colorModes.map((value) => (
              <option key={value} value={value}>
                {COLOR_MODE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          縦横比
          <select
            className={selectClass}
            value={aspectRatio}
            disabled={busy !== null}
            onChange={(e) => setAspectRatio(e.target.value as IllustrationAspectRatio)}
          >
            {illustrationAspectRatios.map((value) => (
              <option key={value} value={value}>
                {ASPECT_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kind === "insert" && (
        <div className="flex flex-col gap-2">
          {!project.hasRepo ? (
            <p className="text-xs text-destructive">
              挿絵にはリポジトリの設定が必要です（プロジェクト設定）
            </p>
          ) : tree === null ? (
            <p className="text-xs text-muted-foreground">原稿ファイルを読み込み中…</p>
          ) : tree.gate === "fetch_failed" ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-destructive">原稿ファイルの取得に失敗しました</p>
              <Button size="sm" variant="outline" onClick={() => setTree(null)}>
                再試行
              </Button>
            </div>
          ) : tree.gate === "ok" ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              対象の原稿ファイル
              <select
                className={selectClass}
                value={manuscriptPath}
                disabled={busy !== null}
                onChange={(e) => setManuscriptPath(e.target.value)}
              >
                <option value="">（選択してください）</option>
                {treeFiles.map((path) => (
                  <option key={path} value={path}>
                    {path.slice(treePrefix)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-destructive">
              {tree.gate === "no_repo"
                ? "挿絵にはリポジトリの設定が必要です（プロジェクト設定）"
                : "挿絵にはGitHub PATの登録が必要です（設定画面）"}
            </p>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            場面の補足（どのあたりの場面か）
            <Textarea
              value={sceneNote}
              disabled={busy !== null}
              onChange={(e) => setSceneNote(e.target.value)}
              placeholder="例: 主人公が卵を初めて見つける場面"
              className="min-h-16 text-sm"
            />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        描いてほしい内容（対象・構図・雰囲気）
        <Textarea
          value={instructions}
          disabled={busy !== null}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="例: 主人公と竜が対峙する象徴的な場面を、表紙らしい印象的な構図で"
          className="min-h-20 text-sm"
        />
      </label>

      {reference && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- 署名URL（短寿命・外部最適化不可）のため素の img を使う */}
          <img
            src={reference.signedUrl}
            alt={reference.title}
            className="h-10 w-10 rounded object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">
              参照画像: {reference.title}
            </p>
            <p className="text-xs text-muted-foreground">
              この画像を添付して依頼します（文字入れ・修正・キャラ維持）
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="参照画像を外す"
            disabled={busy !== null}
            onClick={() => onSetReference(null)}
          >
            <X />
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void handlePropose()}>
          {busy === "propose" && <Loader2 className="animate-spin" data-icon="inline-start" />}
          案を出してもらう
        </Button>
        <span className="text-xs text-muted-foreground">
          イラストレーターが資料を読んで2〜3案を提案します
        </span>
      </div>

      {/* 案カード（§4.3）。クリックでプロンプト欄へ反映 */}
      {proposals && (
        <ul className="flex flex-col gap-2">
          {proposals.map((proposal, index) => (
            <li key={index}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setSelectedProposal(index);
                  setPrompt(proposal.imagePrompt);
                }}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  selectedProposal === index
                    ? "border-ring bg-accent"
                    : "border-border bg-card hover:bg-accent/50"
                }`}
              >
                <p className="text-sm font-medium text-card-foreground">{proposal.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{proposal.description}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* プロンプト欄: 案の反映先＝微調整の場。参照画像つきなら直接編集して生成もできる */}
      {(proposals || reference || prompt !== "") && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          画像生成プロンプト（編集できます）
          <Textarea
            value={prompt}
            disabled={busy !== null}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="案を選ぶとここに入ります。直接書いてもかまいません"
            className="min-h-28 text-sm"
          />
        </label>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy !== null || prompt.trim() === ""}
          onClick={() => void handleGenerate()}
        >
          {busy === "generate" && <Loader2 className="animate-spin" data-icon="inline-start" />}
          この内容で描いてもらう
        </Button>
        {busy === "generate" && (
          <span className="text-xs text-muted-foreground">生成中（10〜30秒ほど）…</span>
        )}
      </div>

      {/* 生成結果（§4.3）。直下から編集依頼へつなげる */}
      {result && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium text-card-foreground">{result.title}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- 署名URLのため素の img を使う */}
          <img
            src={result.signedUrl}
            alt={result.title}
            className="max-h-96 w-full rounded object-contain"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => onSetReference(result)}
            >
              この画像を参照して修正を依頼
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
