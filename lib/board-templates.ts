// 構成テンプレートのレジストリ（Issue #54・SPEC-structure-templates §3）。
// レーン構成・転換点（定義順=レーン内の並び順制約の正）・レビュー観点をテンプレートごとに宣言する。
// draft-to-clean-model 準拠: テンプレートはDBテーブルではなくコード内の宣言的定数として持つ。
// スラッグはテンプレート横断で一意（lib/schemas/enums.ts・20260731000001 の CHECK と対応）。
// 語彙を変更するときは enums.ts・マイグレーションと同時に更新すること

import type { SceneAnchor, ScenePart, StructureTemplate } from '@/lib/schemas/enums'
import { structureTemplates } from '@/lib/schemas/enums'

export type TurningPointDef = {
  id: SceneAnchor
  /** 編集ダイアログ・アンカースロット等のフルラベル */
  label: string
  /** シーンカード上のバッジ用短縮ラベル */
  badge: string
  /** 境界アンカー（レーン末尾の固定スロットに表示。レーンの定義順の最後に置くこと） */
  boundary?: boolean
}

export type LaneDef = {
  id: ScenePart
  label: string
  /** レーンヘッダーの短い説明 */
  description: string
  /** レーン内の転換点（配列順=並び順制約の正。SPEC-structure-templates §5） */
  turningPoints: TurningPointDef[]
}

export type StructureTemplateDef = {
  id: StructureTemplate
  label: string
  /** 構成レビューの user 入力に注入するテンプレート固有のレビュー観点（SPEC-structure-templates §7） */
  reviewChecklist: string
  lanes: LaneDef[]
}

export const BOARD_TEMPLATES: Record<StructureTemplate, StructureTemplateDef> = {
  four_part: {
    id: 'four_part',
    label: '4部構成',
    // 旧・構成レビューシード（20260721000001）のチェックリスト文言を移植（レビュー品質を維持）
    reviewChecklist: [
      '- パート1「設定」: 出だしにフックがあるか。主人公の日常と危機感が醸成されているか。プロットポイント1で「旅」が始まるか',
      '- プロットポイント1: 位置は適切か。主人公をどう変えるか。新たな必要性と危機は何か',
      '- パート2「反応」: 新しい状況への反応・逃避・模索が描かれているか',
      '- ミッドポイント: 新情報が提示され、流れが転換し、テンションが上がるか',
      '- パート3「攻撃」: 主人公が主導権を握り、問題に攻勢をかけているか',
      '- プロットポイント2: 主人公の積極化・内面の悪魔の克服につながっているか',
      '- パート4「解決」: 内面の悪魔を克服した主人公による決着になっているか',
    ].join('\n'),
    lanes: [
      {
        id: 'setup',
        label: '設定',
        description: '主人公の日常と危機の醸成。フックで引き込む',
        turningPoints: [
          { id: 'pp1', label: 'PP1: プロットポイント1', badge: 'PP1', boundary: true },
        ],
      },
      {
        id: 'response',
        label: '反応',
        description: '一変した状況への反応・逃避・模索',
        turningPoints: [
          { id: 'pinch1', label: 'ピンチポイント1', badge: 'ピンチ1' },
          { id: 'midpoint', label: 'ミッドポイント', badge: 'ミッド', boundary: true },
        ],
      },
      {
        id: 'attack',
        label: '攻撃',
        description: '主導権を握り、問題へ攻勢をかける',
        turningPoints: [
          { id: 'pinch2', label: 'ピンチポイント2', badge: 'ピンチ2' },
          { id: 'pp2', label: 'PP2: プロットポイント2', badge: 'PP2', boundary: true },
        ],
      },
      {
        id: 'resolution',
        label: '解決',
        description: '内面の悪魔を克服した主人公による決着',
        turningPoints: [],
      },
    ],
  },
  three_act: {
    id: 'three_act',
    label: '三幕構成',
    reviewChecklist: [
      '- 第一幕: 人物・世界・トーンが簡潔に提示されているか。日常に亀裂を入れる事件が早めに起きるか',
      '- プロットポイント1: 主人公が後戻りできない選択をし、物語の中心的な葛藤が確定するか',
      '- 第二幕 前半: 葛藤が段階的に深まっているか。主人公の試行錯誤が受け身になりすぎていないか',
      '- ミッドポイント: 新情報や事件で物語の方向が転換し、緊張が一段上がるか',
      '- 第二幕 後半: 敗北や喪失で主人公が追い詰められ、結末への必然が積み上がっているか',
      '- プロットポイント2: 解決に向かう最後の材料が出そろい、第三幕への推進力が生まれているか',
      '- 第三幕: クライマックスが中心的な葛藤に正面から答え、解決が主人公の変化を示しているか',
      '- 全体: 三幕の分量バランス（目安1:2:1）が大きく崩れていないか',
    ].join('\n'),
    lanes: [
      {
        id: 'act1',
        label: '第一幕（発端）',
        description: '人物と世界を提示し、事件で物語を動かす',
        turningPoints: [
          { id: 'ta_pp1', label: 'プロットポイント1', badge: 'PP1', boundary: true },
        ],
      },
      {
        id: 'act2_first',
        label: '第二幕 前半（葛藤）',
        description: '新状況での葛藤と試行錯誤',
        turningPoints: [
          { id: 'ta_midpoint', label: 'ミッドポイント', badge: 'ミッド', boundary: true },
        ],
      },
      {
        id: 'act2_second',
        label: '第二幕 後半（葛藤）',
        description: '深まる危機とクライマックスへの助走',
        turningPoints: [
          { id: 'ta_pp2', label: 'プロットポイント2', badge: 'PP2', boundary: true },
        ],
      },
      {
        id: 'act3',
        label: '第三幕（結末）',
        description: 'クライマックスと解決',
        turningPoints: [],
      },
    ],
  },
  structure: {
    id: 'structure',
    label: 'ストラクチャー式',
    reviewChecklist: [
      '- 掴み・フック: 冒頭で読者を引き込む仕掛けがあるか',
      '- インサイティング・イベント: 主人公の日常を乱す出来事が早い段階で起きているか',
      '- キー・イベント: 主人公が物語の中心的な葛藤に個人的に巻き込まれているか',
      '- プロットポイント1: ここで「旅」が始まり、主人公が後戻りできなくなるか',
      '- ピンチポイント1: 敵対勢力の力・脅威が読者に直接示されているか',
      '- ミッドポイント: 新情報の提示で、主人公が反応から行動へ転換するか',
      '- ピンチポイント2: 敵対勢力の圧力が再提示され、緊張が最高潮へ向かうか',
      '- プロットポイント2: 最後の材料が出そろい、主人公が積極化するか',
      '- クライマックス: 中心的な葛藤に決着がつくか',
      '- 解決: 決着後の新しい日常と主人公の変化が示されているか',
    ].join('\n'),
    lanes: [
      {
        id: 'reaction1',
        label: 'リアクション1',
        description: 'フックから物語の起動まで。主人公と日常の設定',
        turningPoints: [
          { id: 'st_hook', label: '掴み・フック', badge: 'フック' },
          { id: 'st_inciting', label: 'インサイティング・イベント', badge: '発端' },
          { id: 'st_key_event', label: 'キー・イベント', badge: 'キー' },
          { id: 'st_pp1', label: 'プロットポイント1', badge: 'PP1', boundary: true },
        ],
      },
      {
        id: 'reaction2',
        label: 'リアクション2',
        description: '一変した状況への反応・模索',
        turningPoints: [
          { id: 'st_pinch1', label: 'ピンチポイント1', badge: 'ピンチ1' },
          { id: 'st_midpoint', label: 'ミッドポイント', badge: 'ミッド', boundary: true },
        ],
      },
      {
        id: 'action1',
        label: 'アクション1',
        description: '主導権を握り、反撃に転じる',
        turningPoints: [
          { id: 'st_pinch2', label: 'ピンチポイント2', badge: 'ピンチ2' },
          { id: 'st_pp2', label: 'プロットポイント2', badge: 'PP2', boundary: true },
        ],
      },
      {
        id: 'action2',
        label: 'アクション2',
        description: 'クライマックスから解決へ',
        turningPoints: [
          { id: 'st_climax', label: 'クライマックス', badge: '山場' },
          { id: 'st_resolution', label: '解決', badge: '解決' },
        ],
      },
    ],
  },
  save_the_cat: {
    id: 'save_the_cat',
    label: 'Save The Cat式',
    reviewChecklist: [
      '- オープニング・イメージ: 変化前の主人公と世界を象徴する画で始まっているか',
      '- テーマの提示: 物語が問うテーマがさりげなく示されているか',
      '- セットアップ: 主人公の欠落と直すべきものが提示されているか',
      '- きっかけ: 日常を壊す出来事が起きているか',
      '- 悩みのとき: 変化への一歩をためらう葛藤が描かれているか',
      '- ターニングポイント1: 主人公が自らの意思で新しい世界へ踏み出しているか',
      '- サブプロット: テーマを支える別筋（多くは関係性）が動き出しているか',
      '- お楽しみ: この作品の「売り」となる場面が展開されているか',
      '- ミッドポイント: 見せかけの勝利または敗北で賭け金がつり上がるか',
      '- 迫りくる悪い奴ら: 外圧と内なる敵が同時に強まっているか',
      '- すべてを失って: どん底の喪失（死の気配）があるか',
      '- 心の暗闇: 主人公が絶望の中でテーマの答えに向き合っているか',
      '- ターニングポイント2: 解決策の発見で最終幕へ踏み出しているか',
      '- フィナーレ: 学んだことを実行してクライマックスを制しているか',
      '- ファイナルイメージ: オープニングと対になる、変化後を象徴する画で終わっているか',
    ].join('\n'),
    lanes: [
      {
        id: 'stc_part1',
        label: 'パート1',
        description: '主人公と世界の提示、テーマの種まき',
        turningPoints: [
          { id: 'stc_opening_image', label: 'オープニング・イメージ', badge: '開幕' },
          { id: 'stc_theme', label: 'テーマの提示', badge: 'テーマ' },
          { id: 'stc_setup', label: 'セットアップ', badge: 'セットアップ' },
          { id: 'stc_catalyst', label: 'きっかけ', badge: 'きっかけ' },
          { id: 'stc_debate', label: '悩みのとき', badge: '悩み' },
          { id: 'stc_tp1', label: 'ターニングポイント1', badge: 'TP1', boundary: true },
        ],
      },
      {
        id: 'stc_part2',
        label: 'パート2',
        description: '新しい世界でのお楽しみとサブプロット',
        turningPoints: [
          { id: 'stc_b_story', label: 'サブプロット', badge: 'サブ' },
          { id: 'stc_fun', label: 'お楽しみ', badge: '楽しみ' },
          { id: 'stc_midpoint', label: 'ミッドポイント', badge: 'ミッド', boundary: true },
        ],
      },
      {
        id: 'stc_part3',
        label: 'パート3',
        description: '外圧が強まり、どん底と暗闇をくぐる',
        turningPoints: [
          { id: 'stc_bad_guys', label: '迫りくる悪い奴ら', badge: '悪い奴ら' },
          { id: 'stc_all_is_lost', label: 'すべてを失って', badge: '喪失' },
          { id: 'stc_dark_night', label: '心の暗闇', badge: '暗闇' },
          { id: 'stc_tp2', label: 'ターニングポイント2', badge: 'TP2', boundary: true },
        ],
      },
      {
        id: 'stc_part4',
        label: 'パート4',
        description: '学びを実行するフィナーレと幕引き',
        turningPoints: [
          { id: 'stc_finale', label: 'フィナーレ', badge: '終幕' },
          { id: 'stc_final_image', label: 'ファイナルイメージ', badge: '幕引き' },
        ],
      },
    ],
  },
  heros_journey: {
    id: 'heros_journey',
    label: 'ヒーローズジャーニー式',
    reviewChecklist: [
      '- 日常世界: 冒険前の主人公の世界が対比として描かれているか',
      '- 冒険への誘い: 主人公を旅へ促す呼びかけが明確か',
      '- 冒険の拒否: ためらい・恐れが人物に厚みを与えているか',
      '- 師との出会い: 助言や道具を与える存在との出会いがあるか',
      '- 最初の戸口の通過: 主人公が特別な世界へ踏み込み、後戻りできなくなるか',
      '- 試練、仲間、敵: 特別な世界のルールの中で試練と人間関係が描かれているか',
      '- 最大の苦難: 死と再生に相当する最大の危機があるか',
      '- 報酬: 苦難を越えて得たもの（剣）が明確か',
      '- 帰路: 帰還への転換と、その代償・追跡が描かれているか',
      '- 復活: 最後の試練で主人公の変化が証明されるか',
      '- 宝を持っての帰還: 持ち帰った宝が日常世界を潤すか',
    ].join('\n'),
    lanes: [
      {
        id: 'hj_separation',
        label: '別離',
        description: '日常世界から冒険への旅立ちまで',
        turningPoints: [
          { id: 'hj_ordinary', label: '日常世界', badge: '日常' },
          { id: 'hj_call', label: '冒険への誘い', badge: '誘い' },
          { id: 'hj_refusal', label: '冒険の拒否', badge: '拒否' },
          { id: 'hj_mentor', label: '師との出会い', badge: '師' },
          { id: 'hj_threshold', label: '最初の戸口の通過', badge: '戸口', boundary: true },
        ],
      },
      {
        id: 'hj_descent',
        label: '試練への降下',
        description: '特別な世界の試練と最大の苦難',
        turningPoints: [
          { id: 'hj_tests', label: '試練、仲間、敵', badge: '試練' },
          { id: 'hj_ordeal', label: '最大の苦難', badge: '苦難', boundary: true },
        ],
      },
      {
        id: 'hj_initiation',
        label: 'イニシエーション',
        description: '報酬を手にし、帰路につく',
        turningPoints: [
          { id: 'hj_reward', label: '報酬（剣を手に入れる）', badge: '報酬' },
          { id: 'hj_road_back', label: '帰路', badge: '帰路', boundary: true },
        ],
      },
      {
        id: 'hj_return',
        label: '帰還',
        description: '復活を遂げ、宝を持ち帰る',
        turningPoints: [
          { id: 'hj_resurrection', label: '復活', badge: '復活' },
          { id: 'hj_elixir', label: '宝を持っての帰還', badge: '帰還' },
        ],
      },
    ],
  },
  story_anatomy: {
    id: 'story_anatomy',
    label: 'ストーリー解剖学式',
    reviewChecklist: [
      '- 自己発見、欠陥、欲求: 物語の最後に起きる自己発見から逆算して冒頭が設計されているか',
      '- 亡霊/ストーリーワールド: 主人公を縛る過去と、それを映す世界が提示されているか',
      '- 弱点、欠陥: 内面的・道徳的な欠陥が主人公の人生を損なうレベルで示されているか',
      '- 誘引の出来事: 主人公を欲求へ駆り立てる出来事が起きているか',
      '- 欲求: 主人公の具体的なゴールが明確か',
      '- 仲間と対抗者: 主人公を助ける仲間と、同じゴールを争う最強の対抗者が配置されているか。仲間のふりをした対抗者などの複雑さが仕込まれているか',
      '- 真実の発見と決断（1〜3）: 発見のたびに欲求と動機が更新され、物語が段階的に深まっているか',
      '- プランと駆動: 主人公のプランが対抗者のプラン・反撃と衝突し、攻防のエスカレーションで物語が加速しているか',
      '- 擬似的敗北: 主人公が敗北したと思える瞬間があるか',
      '- 門・ガントレット・死の国: 決戦前の最後の試練で圧力が最大化しているか',
      '- 決戦: 葛藤の最終決着が主人公と対抗者の価値観の衝突になっているか',
      '- 自己発見と道徳的決断: 主人公が真実に到達し、行動でそれを証明しているか',
      '- 新たなバランス状態: 自己発見後の新しい均衡が示されているか',
    ].join('\n'),
    lanes: [
      {
        id: 'sa_part1',
        label: 'パート1',
        description: '主人公の欠陥・欲求と対抗者の提示',
        turningPoints: [
          { id: 'sa_self_discovery', label: '自己発見、欠陥、欲求', badge: '起点' },
          { id: 'sa_ghost', label: '亡霊/ストーリーワールド', badge: '亡霊' },
          { id: 'sa_weakness', label: '弱点、欠陥', badge: '弱点' },
          { id: 'sa_inciting', label: '誘引の出来事', badge: '誘引' },
          { id: 'sa_desire', label: '欲求', badge: '欲求' },
          { id: 'sa_ally', label: '仲間（仲間たち）', badge: '仲間' },
          { id: 'sa_opponent', label: '対抗者/謎', badge: '対抗者' },
          { id: 'sa_fake_ally', label: '仲間のふりをした対抗者', badge: '偽仲間' },
          { id: 'sa_revelation1', label: '最初の真実の発見と決断', badge: '真実1', boundary: true },
        ],
      },
      {
        id: 'sa_part2',
        label: 'パート2',
        description: 'プランと反撃の応酬で駆動する',
        turningPoints: [
          { id: 'sa_plan', label: 'プラン', badge: 'プラン' },
          { id: 'sa_opponent_plan', label: '対抗者のプランとメインの反撃', badge: '敵プラン' },
          { id: 'sa_drive', label: '駆動', badge: '駆動' },
          { id: 'sa_ally_attack', label: '仲間による攻撃', badge: '仲間攻撃' },
        ],
      },
      {
        id: 'sa_part3',
        label: 'パート3',
        description: '擬似的敗北と真実の発見',
        turningPoints: [
          { id: 'sa_apparent_defeat', label: '擬似的敗北', badge: '偽敗北' },
          { id: 'sa_revelation2', label: '第二の真実の発見と決断', badge: '真実2' },
          { id: 'sa_audience_revelation', label: '観客による真実の発見', badge: '観客' },
          { id: 'sa_revelation3', label: '第三の真実の発見と決断', badge: '真実3', boundary: true },
        ],
      },
      {
        id: 'sa_part4',
        label: 'パート4',
        description: '決戦、自己発見、新たな均衡',
        turningPoints: [
          { id: 'sa_gauntlet', label: '門、ガントレット、死の国への訪問', badge: '死の国' },
          { id: 'sa_battle', label: '決戦', badge: '決戦' },
          { id: 'sa_self_revelation', label: '自己発見', badge: '自己発見' },
          { id: 'sa_moral_decision', label: '道徳的決断', badge: '決断' },
          { id: 'sa_new_equilibrium', label: '新たなバランス状態', badge: '均衡' },
        ],
      },
    ],
  },
}

/** テンプレート定義の一覧（structureTemplates の宣言順） */
export const boardTemplateList: StructureTemplateDef[] = structureTemplates.map(
  (id) => BOARD_TEMPLATES[id],
)
