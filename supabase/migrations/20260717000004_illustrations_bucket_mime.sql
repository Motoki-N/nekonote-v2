-- 画像生成モデルの出力形式はモデル依存（Gemini系は jpeg を返すことがある。PR②のE2Eで確認）。
-- png 決め打ちをやめ、一般的な画像形式を許可する（サイズ上限 10MB は据え置き）

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'illustrations';
