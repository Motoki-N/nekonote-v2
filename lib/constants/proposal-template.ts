import type { WritingGenre } from "@/lib/schemas/enums";

// 執筆ジャンルの表示ラベル。UI（作成ダイアログ・企画書エディタ）と
// AIプロンプト（lib/ai/prompts.ts）の両側から import するため、
// ディレクティブなしの純定数ファイルであるここに置く（SPEC-genre §ラベル）
export const WRITING_GENRE_LABEL: Record<WritingGenre, string> = {
  novel: "小説",
  tech_book: "技術書",
  other: "その他",
};

// 企画書の初期本文（執筆ジャンル別。SPEC-proposal-review §3.2 / SPEC-genre §テンプレ）。
// ノート挿入用途ではないため templates テーブルには入れず、コード内定数で管理する。
// 小説は story-engineering の企画3要素（コンセプト/キャラクター/テーマ）準拠。
// 「その他」は汎用ジャンルのため雛形を押し付けず空にする
export const PROPOSAL_INITIAL_CONTENT: Record<WritingGenre, string> = {
  novel: `## コンセプト

「もし〜だったら」の一文で書いてみましょう。

## キャラクター

主人公は誰で、何を求め、なぜ求めるのか。失敗したら何を失うのか。

## テーマ

この物語が語る意味・問いかけ。
`,
  tech_book: `## テーマ

この本で何を伝えるのかを一文で書いてみましょう。

## 参加イベント

頒布予定のイベントと入稿締切。

## ターゲット読者

どんな読者に向けた本か。想定する前提知識のレベルも。

## 本のゴール

読み終えた読者が何を得て、何ができるようになるのか。
`,
  other: "",
};
