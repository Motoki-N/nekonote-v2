#!/bin/bash
# マージ済み（またはクローズ済み）PRのブランチへの git push を止める PreToolUse フック。
# マージ後のブランチに push しても PR にも main にも入らず、エラーも出ないため（#367 → #368）。
# 自動削除されたリモートブランチも push で黙って再作成されるので、GitHub 側の設定では防げない。

cmd=$(jq -r '.tool_input.command // empty')
# git push を含まないコマンドは対象外
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([[:space:]]|$)' || exit 0

dir="${CLAUDE_PROJECT_DIR:-.}"
branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in main | HEAD) exit 0 ;; esac

# 同名ブランチの PR を全状態で取得。gh が使えない・失敗したときは止めない
states=$(cd "$dir" && gh pr list --head "$branch" --state all --json number,state \
  -q '.[] | "\(.number) \(.state)"' 2>/dev/null) || exit 0
[ -z "$states" ] && exit 0
# 開いている PR があれば通常の追加 push
printf '%s\n' "$states" | grep -q ' OPEN$' && exit 0

pr=$(printf '%s\n' "$states" | head -1)
reason="ブランチ ${branch} の PR #${pr% *} は ${pr#* } 済みです。このまま push しても PR にも main にも入りません。最新の origin/main から新しいブランチを切り（必要なら git cherry-pick で修正を移し）、新しい PR を作ってください。"
jq -n --arg r "$reason" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
