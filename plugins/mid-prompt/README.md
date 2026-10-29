# mid-prompt

```bash
claude plugin install mid-prompt@glory-plugins
```

Mid-prompt autocomplete and inline expansion for the Markdown prompt templates
in `~/.agents/prompts`.

Templates are available three ways: as leading slash commands (`/ask`, with
`argument-hint` and `$1`/`$@`/`$ARGUMENTS` substitution), as mid-prompt tokens
that expand on submit (`explain this /ask`), and through `/prompts`, which lists
them. Set `MID_PROMPT_DIR` to use a different template directory, or run
`/mid-prompt-reload` after editing templates.

A template whose name collides with a built-in or user command is left alone and
is only available mid-prompt.
