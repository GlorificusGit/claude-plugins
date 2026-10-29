# claude-plugins

Personal Claude Code plugins, distributed as a marketplace.

## Install

```bash
claude plugin marketplace add GlorificusGit/claude-plugins
claude plugin install mid-prompt@glory-plugins
claude plugin install auto-load-skills@glory-plugins
```

## Update

Marketplaces auto-update on startup by default. To update manually:

```bash
claude plugin marketplace update glory-plugins
claude plugin update mid-prompt@glory-plugins
claude plugin update auto-load-skills@glory-plugins
```

Restart or run `/reload-plugins` to apply.

## Plugins

- **mid-prompt** — mid-prompt autocomplete and inline expansion for the prompt
  templates in `~/.agents/prompts`.
- **auto-load-skills** — loads a skill into the first prompt when a shell rule
  matches (the `git` skill inside a git repository, by default).

## Local testing

Load a plugin from the working tree:

```bash
claude --plugin-dir ./plugins/mid-prompt
```

If it is also installed, disable the installed copy so both do not load:

```bash
claude plugin disable mid-prompt@glory-plugins
claude --plugin-dir ./plugins/mid-prompt
# when done
claude plugin enable mid-prompt@glory-plugins
```

Or add the local marketplace. If `glory-plugins` is already configured, remove it
first; removing a marketplace also uninstalls its plugins and deletes their data,
options, and secrets:

```bash
claude plugin marketplace remove glory-plugins
claude plugin marketplace add ~/coding/claude-plugins
claude plugin install mid-prompt@glory-plugins
```

## Layout

```text
.claude-plugin/marketplace.json   marketplace definition
plugins/<name>/                   one plugin per directory
```

Each plugin contains `.claude-plugin/plugin.json` and, for a mod, a
`hooks/hooks.json` pointing at its hooks module.
