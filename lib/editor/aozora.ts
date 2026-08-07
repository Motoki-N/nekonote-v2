// VFM原稿 → 青空文庫形式の変換（SPEC-aozora-export §3）と、
// 投稿サイト別方言へのポストプロセス（同 §3.1、Issue #137）。
// 変換対象は入力補助ツールバー由来の記法に閉じる（Issue #133 調査メモ）。
// クライアントで実行される純関数のみを置く。段落構造（空行区切り）は変換で変えない

/** 書き出し先サイト。aozora は純粋な青空文庫注記のまま出力する */
export type ExportSite = 'aozora' | 'kakuyomu' | 'narou'

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

/** 開いている章のVFM本文を、選択サイトが解釈できる形式のテキストへ変換する */
export function toSiteText(source: string, site: ExportSite): string {
  const aozora = toAozoraText(source)
  if (site === 'aozora') return aozora
  const stripped = stripUnsupportedNotes(aozora)
  return site === 'kakuyomu'
    ? convertTenten(stripped, (target) => `《《${target}》》`)
    : convertTenten(stripped, narouTentenRuby)
}

/**
 * カクヨム・なろうのどちらも解釈できない注記（縦中横・改ページ・割注）を除去する。
 * 対象の本文（縦中横の数字・割注の中身）はそのまま本文として残す
 */
function stripUnsupportedNotes(text: string): string {
  // 注記対象の文字クラスは ［］ の排除のみ（対象に「」は含まれ得るが、annotationTarget が
  // ［］ を除去するため注記対象には現れない——「」で排除すると対象にカギ括弧を含む注記を取りこぼす）
  text = text.replace(/［＃「[^［］]*」は縦中横］/g, '')
  // 改ページは行ごと除去（後続の空行1つまで巻き取り、段落間の空行を1つに保つ）
  text = text.replace(/^［＃改ページ］(?:\n(?:[ \t]*\n)?|$)/gm, '')
  // 割注はマーカーだけ外して中身を本文化（［＃改行］は割注内でのみ生成される）
  text = text.replace(/［＃割り注］|［＃改行］|［＃割り注終わり］/g, '')
  return text
}

/**
 * 傍点注記 `対象［＃「対象」に傍点］` をサイト方言へ置き換える。
 * 注記は直前の表示文字列を参照するため、注記直前のテキストが対象と一致する場合のみ
 * wrap で置換し、一致しない場合（傍点対象にルビが含まれる等——カクヨムは傍点とルビの
 * 併用不可・なろうはルビの入れ子不可）は注記だけを落として本文とルビを残す
 */
function convertTenten(text: string, wrap: (target: string) => string): string {
  let result = ''
  let last = 0
  for (const match of text.matchAll(/［＃「([^［］]+)」に傍点］/g)) {
    const target = match[1]
    const chunk = text.slice(last, match.index)
    result += chunk.endsWith(target)
      ? chunk.slice(0, chunk.length - target.length) + wrap(target)
      : chunk
    last = match.index + match[0].length
  }
  return result + text.slice(last)
}

/**
 * なろうの傍点代用（慣習的な中黒ルビ）。ルビは最大10文字のため、
 * 対象が10文字を超える場合は1文字ずつ `｜対《・》｜象《・》` に分割する
 */
function narouTentenRuby(target: string): string {
  const chars = Array.from(target)
  return chars.length <= 10
    ? `｜${target}《${'・'.repeat(chars.length)}》`
    : chars.map((char) => `｜${char}《・》`).join('')
}

/** ルビの文字数上限（超過するとサイト側でルビとして解釈されない。Issue #137 調査） */
const RUBY_LIMITS: Record<Exclude<ExportSite, 'aozora'>, { parent: number; ruby: number }> = {
  kakuyomu: { parent: 20, ruby: 50 },
  narou: { parent: 10, ruby: 10 },
}

/**
 * 変換後テキストから、選択サイトの文字数上限を超えるルビを検出して警告文を返す。
 * 変換結果自体は変えない（ダイアログでの注意喚起のみ）
 */
export function collectRubyWarnings(converted: string, site: ExportSite): string[] {
  if (site === 'aozora') return []
  const limits = RUBY_LIMITS[site]
  const siteName = site === 'kakuyomu' ? 'カクヨム' : 'なろう'
  const warnings: string[] = []
  for (const match of converted.matchAll(/｜([^《》｜\n]+)《([^《》\n]+)》/g)) {
    const [, parent, ruby] = match
    const parentLength = Array.from(parent).length
    const rubyLength = Array.from(ruby).length
    if (parentLength > limits.parent) {
      warnings.push(
        `｜${parent}《${ruby}》: 親文字が${siteName}の上限${limits.parent}文字を超えています（${parentLength}文字）`,
      )
    } else if (rubyLength > limits.ruby) {
      warnings.push(
        `｜${parent}《${ruby}》: ルビが${siteName}の上限${limits.ruby}文字を超えています（${rubyLength}文字）`,
      )
    }
  }
  // 同じルビが繰り返し使われた章では同一警告が並ぶため重複を除く（表示用のリスト）
  return [...new Set(warnings)]
}

/** ダウンロード用ファイル名（章ファイル名の拡張子を .txt へ置換） */
export function aozoraFileName(chapterFileName: string): string {
  return `${chapterFileName.replace(/\.[^.]+$/, '')}.txt`
}
