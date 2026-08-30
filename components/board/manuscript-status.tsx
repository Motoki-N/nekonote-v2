"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { getManuscriptFileStatus } from "@/lib/actions/manuscripts";

/**
 * 執筆進捗の状態（SPEC-manuscript-bridge §4.3）。
 * 'unwritten' = 雛形のまま / 'writing' = 書き始めている / 'missing' = ツリーにない
 */
export type ManuscriptStatus = "unwritten" | "writing" | "missing";

/**
 * 「雛形のまま」と見なす blob サイズの上限（バイト）。
 * 雛形は frontmatter ＋ 見出し（章扉）か VFM コメント1行（シーン）だけ。
 * 章扉は `21 + タイトルのバイト数 × 2`（タイトルが frontmatter と見出しの2箇所に出る）で
 * 全角29文字まで、シーンは `17 + タイトルのバイト数 + シーン番号の桁数` で全角60文字まで
 * がこの範囲に収まる。
 * それより長いタイトルの雛形は作成直後から「執筆中」と出る（判定を誤る向きは軽い方に倒している）
 */
const SCAFFOLD_MAX_BYTES = 200;

/** パス→バイト数。null = 未取得・取得失敗・前提未達（バッジを出さない） */
type SizeMap = Record<string, number> | null;

/** 生成直後のファイルを「未執筆」として扱うためのサイズ表（実サイズは次回取得で入る） */
function scaffoldSizes(paths: string[]): Record<string, number> {
  return Object.fromEntries(paths.map((path) => [path, 0]));
}

const ManuscriptSizeContext = createContext<SizeMap>(null);

/** ボード配下のカードへ進捗の判定材料を配る（カード階層が深く props で通しにくいため） */
export function ManuscriptStatusProvider({
  sizes,
  children,
}: {
  sizes: SizeMap;
  children: React.ReactNode;
}) {
  return (
    <ManuscriptSizeContext.Provider value={sizes}>
      {children}
    </ManuscriptSizeContext.Provider>
  );
}

/** 原稿パスの進捗。null = 判定材料がない（＝現状どおりの「原稿」バッジを出す） */
export function useManuscriptStatus(
  path: string | null,
): ManuscriptStatus | null {
  const sizes = useContext(ManuscriptSizeContext);
  if (path === null || sizes === null) return null;
  const size = sizes[path];
  if (size === undefined) return "missing";
  return size <= SCAFFOLD_MAX_BYTES ? "unwritten" : "writing";
}

/**
 * 原稿ファイルのサイズ表をマウント後に取得する（SPEC §4.3）。
 * ボードの初期表示を GitHub のレイテンシと障害から切り離すための遅延取得。
 * 失敗・前提未達（repo未設定・PAT未登録）は null のままにして、バッジを出さないだけにする
 */
export function useManuscriptSizes(projectId: string): {
  sizes: SizeMap;
  /** 生成直後のファイルを雛形サイズとして反映する（再取得せずに「未執筆」を出す） */
  addCreated: (paths: string[]) => void;
} {
  const [sizes, setSizes] = useState<SizeMap>(null);
  // 取得中に生成されたファイル。取得結果はそれ以前のツリーなので、あとから重ねる
  // （重ねないと、作成直後のファイルが「見つかりません」になる）
  const createdRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getManuscriptFileStatus(projectId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || result.data?.gate !== "ok") return;
        setSizes({
          ...result.data.sizes,
          ...scaffoldSizes(createdRef.current),
        });
      })
      .catch(() => {
        // 取得失敗はバッジを出さないだけ（フェイルソフト。SPEC §4.3）
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const addCreated = useCallback((paths: string[]) => {
    createdRef.current = [...createdRef.current, ...paths];
    // 取得前・前提未達（null）のときは何もしない——バッジを出さない状態を保つ
    // （取得中だった場合は、完了時に createdRef から重ねられる）
    setSizes((prev) =>
      prev === null ? prev : { ...prev, ...scaffoldSizes(paths) },
    );
  }, []);

  return { sizes, addCreated };
}
