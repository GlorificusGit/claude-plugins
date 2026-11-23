#!/usr/bin/env bash
# Rebuilds ~/.codex/skills/prompts from the templates in ~/.agents/prompts, as
# skills only the user can invoke ($name). Prints only hook JSON: SessionStart
# plain stdout is model context.
set -euo pipefail
shopt -s nullglob

src="${MID_PROMPT_DIR:-$HOME/.agents/prompts}"
dst="${CODEX_HOME:-$HOME/.codex}/skills/prompts"
mark=.codex-prompts

mkdir -p "${dst%/*}"
# Sessions starting together take turns.
exec 9> "${dst%/*}/$mark.lock"
flock 9

# Leave a skills/prompts directory this script did not make alone.
[[ -e $dst && ! -e $dst/$mark ]] && exit 0

# Staged in a hidden directory, which skill discovery skips.
tmp=$(mktemp -d "${dst%/*}/.prompts.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
touch "$tmp/$mark"

for file in "$src"/*.md; do
  name=$(basename "$file" .md)
  dir="$tmp/$name"
  mkdir -p "$dir/agents"
  printf 'policy:\n  allow_implicit_invocation: false\n' > "$dir/agents/openai.yaml"
  # Description from frontmatter, else the first body line; an empty body is skipped.
  awk -v name="$name" -v q="'" '
    NR == 1 && /^---[[:space:]]*$/ { fm = 1; next }
    fm && /^---[[:space:]]*$/ { fm = 0; next }
    fm { if (sub(/^description:[[:space:]]*/, "")) desc = $0; next }
    !started && !/[^[:space:]]/ { next }
    { started = 1; if (desc == "") desc = $0; body = body $0 "\n" }
    END {
      if (!started) exit 1
      gsub("^[\"" q "]|[\"" q "][[:space:]]*$", "", desc)
      gsub(/\\/, "\\\\", desc); gsub(/"/, "\\\"", desc)
      printf "---\nname: %s\ndescription: \"%s\"\n---\n\n%s", name, desc, body
    }
  ' "$file" > "$dir/SKILL.md" || rm -rf "$dir"
done

# Unchanged: leave the live skills alone.
diff -rq "$dst" "$tmp" &> /dev/null && exit 0
rm -rf "$dst"
mv "$tmp" "$dst"
trap - EXIT
# Codex reads its skills before this hook runs, so changes miss the first message.
echo '{"systemMessage":"codex-prompts: prompt skills changed; they apply from your next message"}'
