# claude-plugins

Personal Claude Code plugins, distributed as a marketplace.

## Install

```bash
claude plugin marketplace add GlorificusGit/claude-plugins
claude plugin install mid-prompt@glory-tools
```

## Plugins

- **mid-prompt** — mid-prompt autocomplete and inline expansion for the prompt
  templates in `~/.agents/prompts`.

## Local testing

```bash
claude --plugin-dir ./plugins/mid-prompt
```

Or add the local marketplace:

```bash
claude plugin marketplace add ~/coding/claude-plugins
```

## Layout

```text
.claude-plugin/marketplace.json   marketplace definition
plugins/<name>/                   one plugin per directory
```

Each plugin contains `.claude-plugin/plugin.json` and, for a mod, a
`hooks/hooks.json` pointing at its hooks module.
