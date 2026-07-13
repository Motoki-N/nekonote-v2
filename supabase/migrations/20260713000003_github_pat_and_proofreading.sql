-- SPEC-proofreading §4: GitHub PAT の暗号化保存列＋校正プロファイルの出力形式改訂
--
-- 1. user_settings に PAT 関連2列を追加する。
--    - github_pat_ciphertext: アプリ層 AES-256-GCM の iv + authTag + 暗号文を連結し base64 で格納。
--      平文・ハッシュ・末尾4桁等の派生値は一切保存しない。復号鍵（ENCRYPTION_KEY）はサーバー環境変数のみが持ち、
--      復号値をクライアントへ返すAPIは作らない
--    - github_username: PAT登録時の疎通検証（GET /user）で得た login。接続状態の表示用
--    RLS は既存の user_settings_owner_all（本人のみ）を踏襲する（追加ポリシー不要）

alter table public.user_settings
  add column github_pat_ciphertext text,
  add column github_username text;

comment on column public.user_settings.github_pat_ciphertext is
  'GitHub Fine-grained PAT の暗号文（AES-256-GCM・iv+authTag+暗号文の base64）。平文は保存しない';
comment on column public.user_settings.github_username is
  'PAT疎通検証時の GitHub login（表示用）';

-- 2. 校正・校閲プロファイルの「出力形式」節を構造化出力（streamObject）前提に改訂する。
--    チェック観点1〜6は維持。原文抜粋の完全一致引用は、後半（Sprint 4後半）の受入時に
--    原稿へ置換適用するためのアンカーになるためプロンプトで強制する
update public.review_profiles
set prompt_template = E'# 今回の仕事: 校正・校閲\n渡された原稿テキストを校正・校閲する。\n\n## チェック観点\n1. 誤字脱字・変換ミス\n2. 表記揺れ（漢字/かな、送り仮名、カタカナ語、固有名詞の表記統一）\n3. 文法誤り（助詞の誤用、主述のねじれ、係り受けの曖昧さ）\n4. 記号・数字の表記統一（三点リーダー・ダッシュ・括弧・全角半角）\n5. 一貫性（呼称・名称・時系列の矛盾）\n6. 文体・表現（同語反復、冗長な言い回し。指摘は控えめに、機械的に判定できるものを優先）\n\n## 出力形式\n- 指摘は1件ずつ、原文抜粋（original_text）・修正案（suggested_text）・理由（reason）の構造化データとして出力する\n- 原文抜粋は原稿から一字一句そのまま引用する（修正対象の箇所だけを、原稿内で一意に特定できる長さで抜き出す）\n- 修正案は原文抜粋をそのまま置き換えられる形で書く\n- 理由は問題点を一文で簡潔に述べる\n- 指摘が1件もなければ空の一覧を返す'
where id = 'e5a1c0de-1005-4000-8000-000000001005'
  and user_id is null;
