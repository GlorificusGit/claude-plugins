# codex-prompts

Codex only.

```bash
codex plugin marketplace add GlorificusGit/claude-plugins
codex plugin add codex-prompts@glory-plugins
```

On session start, rebuilds `~/.codex/skills/prompts` from the Markdown templates
in `~/.agents/prompts` (override with `MID_PROMPT_DIR`). Each becomes a skill
only you can invoke, with `$name`; the model does not see it in its skill list.
Codex asks you to trust the hook on first run. Codex reads skills before the
hook runs, so changes apply from your next message; it warns when that happens.
`codex plugin remove` leaves `~/.codex/skills/prompts` behind; delete it by hand.

Edit the templates, never the generated skills. Argument placeholders (`$1`,
`$ARGUMENTS`) are left as typed.
