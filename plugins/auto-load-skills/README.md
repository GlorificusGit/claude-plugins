# auto-load-skills

```bash
/plugin install auto-load-skills --marketplace GlorificusGit/claude-plugins
```

Loads a skill into the system prompt when a shell rule matches, before the
first model response. This removes reliance on the model noticing a skill
description or on a project `CLAUDE.md` telling it to load the skill.

Rules live in `hooks/register.ts`. The default loads the `git` skill whenever
the session's working directory is a git repository. Checks run once per
session, again after `/clear` or a resume; a rule whose check exits non-zero
injects nothing. A check that fails to run (a timeout, say) logs a warning and
runs again on the next prompt.

Skills are read from the first match, in Claude Code's order:

```text
$CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md   (default $HOME/.claude)
<dir>/.claude/skills/<name>/SKILL.md        (cwd, then each parent below $HOME)
<plugin>/skills/<name>/SKILL.md
```

Frontmatter is stripped before the body is wrapped:

```text
<skill name="git" location="/home/you/.claude/skills/git/SKILL.md">
References are relative to /home/you/.claude/skills/git.

...body...
</skill>
```

A skill supplied by another installed plugin is not searched: the hooks API
lists skill names but not the paths behind them. A missing or unreadable skill
logs a warning and is skipped.
