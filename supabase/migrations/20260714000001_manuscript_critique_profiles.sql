-- 講評基盤（SPEC-dashboard-critique-settings §5）: target_phase に 'manuscript' を追加＋講評プロファイル2種シード
-- スキーマの新テーブル・新列はなし。RLS 変更なし（既存のハイブリッド所有ポリシーがそのまま効く）

-- ========================================
-- review_profiles.target_phase CHECK制約の張り替え
-- 講評（作品全体への評価）のフェーズとして 'manuscript' を追加する
-- ========================================

alter table public.review_profiles
  drop constraint review_profiles_target_phase_check;

alter table public.review_profiles
  add constraint review_profiles_target_phase_check
  check (target_phase in ('proposal', 'character', 'structure', 'scene', 'proofreading', 'manuscript'));

-- ========================================
-- 講評プロファイル2種シード（review-profiles スキル準拠）
-- 標準5種（20260713000002）と同じ流儀: user_id null / is_default true / 固定UUID
-- 固定UUIDは lib/ai/personas.ts の定数と対応させる
-- 講評に合否はないため判定行なし（review_feedbacks.verdict は null 運用）
-- ========================================

insert into public.review_profiles (id, user_id, name, target_phase, prompt_template, default_persona_id, is_default) values
(
  'e5a1c0de-1006-4000-8000-000000001006',
  null,
  '読者講評',
  'manuscript',
  E'# 今回の仕事: 読者講評\n渡された原稿（作品全体）を、ターゲット層の一読者として最初から最後まで読んだときの体験を講評として伝える。\n\n## 講評の観点\n1. 読書体験の流れ: どこで惹き込まれ、どこで飽き、どこで置いていかれたか。体験した順に語る\n2. 刺さったところ: 好きな場面・キャラクター・台詞と、その理由（理屈ではなく感覚でよい）\n3. 引っかかったところ: 退屈した箇所、わからなかった箇所、気持ちが離れた箇所\n4. 続きへの気持ち: 続きを読みたいか。人に薦めたくなるか\n\n## 進め方\n- 企画のジャンル・ターゲット層になりきり、その読者の目線を最後まで維持する\n- 作品を読んだ順（冒頭→中盤→結末）に体験を語り、最後に全体の気持ちをまとめる\n- 創作理論や技術用語で分析しない。感想として率直に語る。合否の判定はしない\n\n## 出力形式\n- Markdown の講評文書（見出し・箇条書きを使ってよい）。分量は全体で800〜1500字程度',
  'e5a1c0de-0005-4000-8000-000000000005',
  true
),
(
  'e5a1c0de-1007-4000-8000-000000001007',
  null,
  '書店員講評',
  'manuscript',
  E'# 今回の仕事: 書店員講評\n渡された原稿（作品全体）を、店頭に並ぶ一冊として客観的に評価する。\n\n## 講評の観点\n1. 売れそうか: 手に取られる引きがあるか。冒頭で客を掴めるか\n2. 小説として優れているか: 同じ棚の商業作品と比べたときの完成度・強み・弱み\n3. どの層に受けそうか: どの棚に置き、どんな客に薦めるか。想定読者とのずれがあれば指摘する\n4. 推すならどこか: 帯やPOPに書くならどの要素か\n\n## 進め方\n- 作者の事情は考慮せず、商品としての評価に徹する。辛辣な指摘も遠慮なく、ただし根拠を必ず添える\n- 良い点と売れない理由の両方を、具体的な箇所を挙げて語る。合否の判定はしない\n\n## 出力形式\n- Markdown の講評文書（見出し・箇条書きを使ってよい）。分量は全体で800〜1500字程度',
  'e5a1c0de-0006-4000-8000-000000000006',
  true
);
