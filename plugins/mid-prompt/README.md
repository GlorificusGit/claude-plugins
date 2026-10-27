# mid-prompt

```bash
/plugin install mid-prompt --marketplace GlorificusGit/claude-plugins
```

Mid-prompt autocomplete and inline expansion for the Markdown prompt templates
in `~/.agents/prompts`.

Type `/ask` partway through a message and the composer offers matching template
names. Choosing one inserts the token; sending the message replaces it with the
template body. Set `MID_PROMPT_DIR` to use a different template directory, or
run `/mid-prompt-reload` after editing templates.

Leading `/ask` is left to Claude Code's own command namespace; use the token
mid-message, for example `explain this /ask`.
