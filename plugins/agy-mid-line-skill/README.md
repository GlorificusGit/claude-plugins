# agy-mid-line-skill

Stub: findings only, nothing runs yet. It is agy-only and deliberately left out
of `.claude-plugin/marketplace.json`. `agy plugin install <repo>` still picks it
up, because that scans `plugins/`.

Blocked: agy does not expose the same hooks as Claude. Without
`prompt.autocomplete`, a plugin cannot add autocomplete, so this waits on
[#971](https://github.com/google-antigravity/antigravity-cli/issues/971) or
[#1219](https://github.com/google-antigravity/antigravity-cli/issues/1219).

Goals:

1. Autocomplete every `/skill`, not just the first.
2. Load skills named mid-prompt.

Tested on agy 1.5.1 with Gemini Flash Low, mostly one run per case.

## What agy does

| Prompt            | Skills loaded |
| ----------------- | ------------- |
| `/a /b task`      | a, b          |
| `/a /b then /c`   | a, b          |
| `/a then /b`      | a             |
| `Use /a and /b`   | none          |
| `/nonexistent /b` | none          |

The `/` menu only opens at the start of the prompt. `@` path completion works
anywhere.

## Why mid-prompt does not port

agy reads Claude's plugin layout, not Claude's hooks. It has no
`prompt.autocomplete` or `prompt.submit`, and `agy plugin validate` rejects a
`hooks.json` with `modules`, though `agy plugin list` reports 2 hooks. So
mid-prompt and auto-load-skills do nothing in agy.

agy's hook events are `SessionStart`, `PreInvocation`, `PostInvocation`,
`PreToolUse`, `PostToolUse` and `Stop`. None sees keystrokes or rewrites the
prompt.

## Goal 2: possible with a hook

A prototype `PreInvocation` hook, run as a workspace hook, did the following:

1. Act only when `invocationNum` is 0, the first model call of each turn.
2. Find `/name` tokens in `lastUserInput` that resolve to a `SKILL.md`.
3. Skip names the last `USER_INPUT` in `transcriptPath` already holds as
   `(name) skill`, so agy's parser needs no copy.
4. Inject the rest in agy's own format, frontmatter stripped:

```json
{
  "injectSteps": [
    {
      "systemMessage": {
        "systemMessage": "/name is a [Slash Command]:\n<SKILL>The user has explicitly invoked the (name) skill. You must strictly follow the instructions in this skill to process their request. Here are its contents:\n...</SKILL>"
      }
    }
  ]
}
```

| Step type                          | Reaches model | Survives tool call | In the TUI      |
| ---------------------------------- | ------------- | ------------------ | --------------- |
| `systemMessage`                    | yes           | yes                | hidden          |
| `systemMessage` + `user_markdown`  | no            | no                 | not checked     |
| `userMessage`                      | yes           | yes                | prints the body |
| `ephemeralMessage`                 | yes           | no                 | not checked     |

`systemMessage` and `userMessage` also lasted into the next turn. The docs say
`user_markdown` keeps the text visible to the model; it did not.

Still to do:

- Use mid-prompt's `TOKEN_RE` and trailing `.:` trim. Unlike the prototype's
  regex, it matches `(/name)` and backticked names.
- Cover the other skill paths; only `<workspace>/.agents/skills` was tested:
  parent `.agents/skills` up to the repo root, `~/.gemini/config/skills`,
  `~/.gemini/skills`, `~/.gemini/antigravity-cli/skills`, and plugin skills as
  `/<plugin>:<skill>`.
- Test as an installed plugin. Plugin hooks load only from `hooks.json` at the
  plugin root, and the docs say they run from that directory.
- Run on bun, since node is not installed. If bun is not on `PATH`, the hook
  does nothing and the TUI shows no message.

A hook cannot show which skills it loaded.

## Goal 1: not possible from a plugin

The `/` menu is built in with no plugin API, and agy is closed source.

| Option             | Result                                                  |
| ------------------ | ------------------------------------------------------- |
| `Ctrl+G` picker    | Works, see below. Inserts at the end of the prompt.     |
| `@` path           | `@~/.agents/skills/fa` opens a menu mid-line, but inserts a path. A hook could map it to a skill; untested. `--add-dir` with `@fav-d` showed no matches. |
| Context providers  | Undocumented, with triggers and `Search`/`ResolveUri` RPCs. No TUI symbols, and the docs say the CLI `@` adds only files and directories. Likely App-only; untested. |

The picker is a script set as `editor` in
`~/.gemini/antigravity-cli/settings.json` (tested through `--settings`):

```sh
#!/bin/sh
pick=$(ls "$HOME/.agents/skills" | fzf --height=12 --prompt='skill> ' 2>/dev/tty) || exit 0
text=$(cat "$1")
printf '%s/%s ' "$text" "$pick" > "$1"
```

Without `2>/dev/tty`, `fzf` is invisible and ignores typing. `editor` also opens
artifacts and files, so a real script must hand those to a real editor; untested.

## Upstream

- [#971](https://github.com/google-antigravity/antigravity-cli/issues/971),
  opened 2026-09-08: skills and `/` autocomplete anywhere in the prompt.
- [#1219](https://github.com/google-antigravity/antigravity-cli/issues/1219),
  opened 2026-10-13: no menu on the second `/` of a stack.
