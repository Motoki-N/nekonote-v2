-- 構成テンプレート（Issue #54・SPEC-structure-templates）:
-- ビートボードの構成手法を4部構成固定から6テンプレート制に拡張する。
-- テンプレート定義（レーン・転換点・順序・レビュー観点）は lib/board-templates.ts の宣言的定数が正
-- （draft-to-clean-model 判断基準2: DBにはテンプレート用テーブルを作らず、
--   画面・AIが構造参照する「プロジェクトの選択テンプレート」と part/anchor の語彙だけを持つ）。
-- part がプロジェクトの現テンプレートのレーンに属するかはアプリロジックで担保する
-- （CHECK は全テンプレートの和集合。scenes.anchor の part 整合の担保方法と同じ流儀）。
-- RLS 変更なし（既存テーブルへのカラム・CHECK 変更のみ）

-- ========================================
-- 1. projects.structure_template（選択中の構成テンプレート）
-- ========================================

alter table public.projects
  add column structure_template text not null default 'four_part'
    check (structure_template in (
      'four_part', 'three_act', 'structure', 'save_the_cat', 'heros_journey', 'story_anatomy'
    ));

-- ========================================
-- 2. scenes.part の CHECK を全テンプレートのレーン語彙に拡張
-- （drop→add は 20260725000004 の前例踏襲）
-- ========================================

alter table public.scenes drop constraint scenes_part_check;
alter table public.scenes
  add constraint scenes_part_check
  check (part in (
    -- 4部構成（既存）＋目次ボードの章
    'setup', 'response', 'attack', 'resolution', 'chapter',
    -- 三幕構成
    'act1', 'act2_first', 'act2_second', 'act3',
    -- ストラクチャー式
    'reaction1', 'reaction2', 'action1', 'action2',
    -- Save The Cat式
    'stc_part1', 'stc_part2', 'stc_part3', 'stc_part4',
    -- ヒーローズジャーニー式
    'hj_separation', 'hj_descent', 'hj_initiation', 'hj_return',
    -- ストーリー解剖学式
    'sa_part1', 'sa_part2', 'sa_part3', 'sa_part4'
  ));

-- ========================================
-- 3. scenes.anchor の CHECK を全テンプレートの転換点語彙に拡張
-- ========================================

alter table public.scenes drop constraint scenes_anchor_check;
alter table public.scenes
  add constraint scenes_anchor_check
  check (anchor in (
    -- 4部構成（既存）
    'pp1', 'pinch1', 'midpoint', 'pinch2', 'pp2',
    -- 三幕構成
    'ta_pp1', 'ta_midpoint', 'ta_pp2',
    -- ストラクチャー式
    'st_hook', 'st_inciting', 'st_key_event', 'st_pp1',
    'st_pinch1', 'st_midpoint', 'st_pinch2', 'st_pp2', 'st_climax', 'st_resolution',
    -- Save The Cat式
    'stc_opening_image', 'stc_theme', 'stc_setup', 'stc_catalyst', 'stc_debate', 'stc_tp1',
    'stc_b_story', 'stc_fun', 'stc_midpoint',
    'stc_bad_guys', 'stc_all_is_lost', 'stc_dark_night', 'stc_tp2',
    'stc_finale', 'stc_final_image',
    -- ヒーローズジャーニー式
    'hj_ordinary', 'hj_call', 'hj_refusal', 'hj_mentor', 'hj_threshold',
    'hj_tests', 'hj_ordeal', 'hj_reward', 'hj_road_back', 'hj_resurrection', 'hj_elixir',
    -- ストーリー解剖学式
    'sa_self_discovery', 'sa_ghost', 'sa_weakness', 'sa_inciting', 'sa_desire',
    'sa_ally', 'sa_opponent', 'sa_fake_ally', 'sa_revelation1',
    'sa_plan', 'sa_opponent_plan', 'sa_drive', 'sa_ally_attack',
    'sa_apparent_defeat', 'sa_revelation2', 'sa_audience_revelation', 'sa_revelation3',
    'sa_gauntlet', 'sa_battle', 'sa_self_revelation', 'sa_moral_decision', 'sa_new_equilibrium'
  ));

-- ========================================
-- 4. 標準シード「構成レビュー」をテンプレート汎用化（update の前例=20260721000001）
-- 4部構成固定のチェックリスト節を「user 入力の『採用中の構成テンプレート』節に従う」旨へ差し替える
-- （テンプレート別の観点は lib/ai/prompts.ts が user 入力に動的注入する）。
-- 判定行の書式は parseVerdict（app/api/review/route.ts）が構造参照するため一字一句維持。
-- 技術書構成レビュー（e5a1c0de-1013）は対象外・無変更
-- ========================================

update public.review_profiles
set prompt_template = E'# 今回の仕事: 構成レビュー\n渡された構成（シーン並び）をレビューする。\n\n## レビュー観点\n- 入力の「採用中の構成テンプレート」節に、この作品が採用する構成手法のレーン構成・転換点の定義と、手法固有のレビュー観点が示されている。必ずその定義と観点に沿ってレビューする\n- 転換点がテンプレートの定義どおりの位置・機能を果たしているか（欠落・位置のずれ・機能不全）を優先的に指摘する\n- 全体: 感情の起伏（プラス⇄マイナス）に単調な区間がないか\n\n## 進め方\n- 良い点を先に認め、指摘には作者が考えるための問いを添える\n- 過去のフィードバックと返答メモがある場合は、前回指摘の改善確認から始める\n\n## 出力形式\n- Markdown のフィードバック文書（見出し・箇条書きを使ってよい）\n- 最終行に、全体の判定を次のどちらか一方のみで必ず出力する。判定行の後に文を続けない:\n判定: 承認\n判定: 差し戻し\n- 「承認」は、転換点の欠落や機能不全がなく、シーンの執筆に進んでよい水準に達しているときのみ出す'
where id = 'e5a1c0de-1003-4000-8000-000000001003';
