// 目次ボードの定番構成テンプレ（Issue #96・SPEC-outline-board §3.4）。
// ノート挿入用途ではないため templates テーブルには入れず、コード内定数で管理する
// （proposal-template.ts と同じ方針）。UIのテンプレメニューと
// Server Action（applyOutlineTemplate）の zod 検証の両側から import する

export const outlineTemplateKeys = [
  "introduction",
  "problem_solving",
  "practical_knowhow",
] as const;
export type OutlineTemplateKey = (typeof outlineTemplateKeys)[number];

export const OUTLINE_TEMPLATE: Record<
  OutlineTemplateKey,
  { label: string; description: string; chapters: string[] }
> = {
  introduction: {
    label: "入門型",
    description: "技術を初めて学ぶ読者を段階的に導く構成",
    chapters: ["背景", "環境構築", "基本操作", "小さな実装", "応用", "まとめ"],
  },
  problem_solving: {
    label: "問題解決型",
    description: "ひとつの課題を掘り下げて解決まで導く構成",
    chapters: ["ある課題", "原因の整理", "解決策の比較", "実装方法", "注意点"],
  },
  practical_knowhow: {
    label: "実践ノウハウ型",
    description: "現場の経験知を体系化して伝える構成",
    chapters: [
      "前提知識",
      "現場での判断ポイント",
      "設計例",
      "失敗例",
      "ベストプラクティス",
    ],
  },
};
