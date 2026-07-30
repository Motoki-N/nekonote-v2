// VFM原稿 → 青空文庫形式の変換（SPEC-aozora-export §3）。
// 変換対象は入力補助ツールバー由来の記法に閉じる（Issue #133 調査メモ）。
// クライアントで実行される純関数のみを置く。段落構造（空行区切り）は変換で変えない

/** 開いている章のVFM本文を青空文庫形式のプレーンテキストへ変換する */
export function toAozoraText(source: string): string {
  let text = source.replace(/\r\n/g, '\n')

  // 1. フロントマター（先頭の --- ブロック。直後の空行ごと除去）
  text = text.replace(/^---\n[\s\S]*?\n---(?:\n(?:[ \t]*\n)*|$)/, '')

  // 2. HTMLコメント（作者メモ）。行全体がコメントの行は、除去跡が余計な空行に
  //    ならないよう行ごと＋後続の空行1つまで除去する（前後を空行で挟まれた
  //    コメント行を消しても段落間の空行が1つに保たれる）。
  //    コメント本体は `(?:(?!-->)[\s\S])*` で最初の `--> ` 止まりを保証する
  //    （`[\s\S]*?` だと行末条件を満たすため後方の別コメントまで伸び、間の本文を巻き込む）
  text = text.replace(/^[ \t]*(?:<!--(?:(?!-->)[\s\S])*-->[ \t]*)+(?:\n(?:[ \t]*\n)?|$)/gm, '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // 3. 画像記法（キャプション・クラス指定ごと。行全体が画像の行は 2. と同じ規則で行ごと除去）
  const imagePattern = /!\[[^\]\n]*\]\([^)\n]*\)(?:\{[^}\n]*\})?/
  text = text.replace(
    new RegExp(`^[ \\t]*${imagePattern.source}[ \\t]*(?:\\n(?:[ \\t]*\\n)?|$)`, 'gm'),
    '',
  )
  text = text.replace(new RegExp(imagePattern.source, 'g'), '')

  // 4. 改ページ
  text = text.replace(/^[ \t]*<div class="page-break"><\/div>[ \t]*$/gm, '［＃改ページ］')

  // 5. 割注（前半のみ＝1行の小書きは ［＃改行］ を挟まない）
  text = text.replace(
    /<span class="warichu"><span>([^<]*)<\/span>(?:<span>([^<]*)<\/span>)?<\/span>/g,
    (_whole, first: string, second: string | undefined) =>
      second === undefined
        ? `［＃割り注］${first}［＃割り注終わり］`
        : `［＃割り注］${first}［＃改行］${second}［＃割り注終わり］`,
  )

  // 6. 傍点・7. 縦中横。ツールバー操作で作れるネスト（傍点の中に縦中横等）を
  //    内側から順に変換するため、変化がなくなるまで繰り返す（`[^<]+` は最内側のみに
  //    マッチし、内側が変換されると外側の中身からタグが消えて次の周回でマッチする）
  let prev: string
  do {
    prev = text
    text = text.replace(
      /<span class="tenten">([^<]+)<\/span>/g,
      (_whole, inner: string) => `${inner}［＃「${annotationTarget(inner)}」に傍点］`,
    )
    text = text.replace(
      /<span class="tcy">([^<]+)<\/span>/g,
      (_whole, inner: string) => `${inner}［＃「${annotationTarget(inner)}」は縦中横］`,
    )
  } while (text !== prev)

  // 8. ルビ `{親文字|よみ}` → `｜親文字《よみ》`（常に ｜ 付きの安全形）
  text = text.replace(/\{([^{}|\n]+)\|([^{}|\n]+)\}/g, '｜$1《$2》')

  // 9. 見出しは記号を外してプレーン行にする（話タイトルはサイト側で入力する運用）。
  //    `\s+` は改行を跨いで行構造を壊すため空白・タブに限定する
  text = text.replace(/^#{1,6}[ \t]+/gm, '')

  // 末尾は改行1つに整える（.txt として自然な形）
  return `${text.replace(/\n+$/, '')}\n`
}

/**
 * 傍点・縦中横の注記が参照する対象文字列（＝表示文字）を得る。
 * 青空文庫の注記は直前の表示文字列を参照するため、中身にルビ記法や
 * 内側の変換済み注記が混ざったままだと処理系がマッチできない——
 * ルビは親文字のみ残し、`［＃…］` 注記は取り除く
 */
function annotationTarget(inner: string): string {
  return inner.replace(/\{([^{}|\n]+)\|[^{}|\n]+\}/g, '$1').replace(/［＃[^［］]*］/g, '')
}

/** ダウンロード用ファイル名（章ファイル名の拡張子を .txt へ置換） */
export function aozoraFileName(chapterFileName: string): string {
  return `${chapterFileName.replace(/\.[^.]+$/, '')}.txt`
}
