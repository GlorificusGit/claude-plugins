// Prompt-template slash commands, mid-prompt autocomplete and expansion.
//
// Reads Markdown prompt templates from ~/.agents/prompts (override with
// MID_PROMPT_DIR). Each template is registered as a slash command, `/prompts`
// lists them, and a mid-prompt `/name` token opens a suggestion row and is
// replaced with the template body on submit.

const NAME = "[A-Za-z0-9_.:-]+"
const TOKEN_RE = new RegExp(`(^|[\\s\\t([{<\`"'])\\/(${NAME})`, "g")
const AUTOCOMPLETE_RE = /^\/([A-Za-z0-9_.:-]*)$/
const COMMAND_RE = /^[A-Za-z0-9_-]{1,64}$/
const RESERVED = new Set(["prompts", "mid-prompt-reload"])
const MAX_SUGGESTIONS = 20

let prompts = new Map()
let commands = new Set()
let loaded = false
let loading

function parsePrompt(filename, raw) {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const meta = frontmatter ? frontmatter[1] : ""
  const body = (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim()
  const name = filename.replace(/\.md$/i, "")

  let description = ""
  const match = meta.match(/^description:\s*(.*)$/m)
  if (match) description = match[1].replace(/^['"]|['"]$/g, "").trim()
  if (!description) description = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ""
  if (description.length > 120) description = `${description.slice(0, 117)}...`

  const hint = meta.match(/^argument-hint:\s*(.*)$/m)
  const argumentHint = hint ? hint[1].replace(/^['"]|['"]$/g, "").trim() : ""

  return { name, description, argumentHint, body }
}

async function loadPrompts($, force = false) {
  if (loaded && !force) return
  if (loading) return loading

  loading = (async () => {
    const home = await $.env.get("HOME")
    const override = await $.env.get("MID_PROMPT_DIR")
    const dir = override || (home ? `${home}/.agents/prompts` : "")
    if (!dir) return

    let entries
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }

    const next = new Map()
    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".md")) continue
      try {
        const prompt = parsePrompt(entry.name, await $.fs.read(`${dir}/${entry.name}`))
        if (prompt.body) next.set(prompt.name, prompt)
      } catch {
        // A missing or unreadable template is skipped.
      }
    }
    prompts = next
    loaded = true
  })().finally(() => {
    loading = undefined
  })

  return loading
}

function matches(token) {
  const query = token.slice(1).toLowerCase()
  return [...prompts.values()]
    .filter((prompt) => !query || prompt.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
}

function expandArgs(body, args) {
  if (!args) return body

  const argv = (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((arg) =>
    arg.replace(/^['"]|['"]$/g, ""),
  )
  const nth = (n) => argv[Number(n) - 1] ?? ""
  const hasPlaceholder = /\$ARGUMENTS|\$\{\d+:-|\$\{@:\d+\}|\$@|\$\d/.test(body)

  let text = body
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$\{(\d+):-([^}]*)\}/g, (_, n, fallback) => nth(n) || fallback)
    .replace(/\$\{@:(\d+)\}/g, (_, n) => argv.slice(Number(n) - 1).join(" "))
    .replace(/\$(\d+)/g, (_, n) => nth(n))
    .replace(/\$@/g, args)

  if (!hasPlaceholder) text = `${text}\n\n${args}`
  return text
}

function expand(text) {
  if (!prompts.size || !text.includes("/")) return text
  return text.replace(TOKEN_RE, (whole, boundary, name, offset) => {
    if (offset === 0 && boundary === "") return whole
    let prompt = prompts.get(name)
    let trailing = ""
    if (!prompt) {
      const trimmed = name.replace(/[.:]+$/, "")
      if (trimmed !== name) {
        prompt = prompts.get(trimmed)
        if (prompt) trailing = name.slice(trimmed.length)
      }
    }
    return prompt ? `${boundary}${prompt.body}${trailing}` : whole
  })
}

async function registerCommands($) {
  await $.command.register({
    name: "prompts",
    description: "List prompt templates",
  })
  await $.command.register({
    name: "mid-prompt-reload",
    description: "Reload mid-prompt templates from ~/.agents/prompts",
  })
  commands.add("prompts")
  commands.add("mid-prompt-reload")

  // Leave names Claude Code, another plugin or the person already owns alone.
  const existing = new Set((await $.command.list()).map((command) => command.name))
  for (const prompt of prompts.values()) {
    if (!COMMAND_RE.test(prompt.name) || RESERVED.has(prompt.name)) continue
    if (!commands.has(prompt.name) && existing.has(prompt.name)) continue
    try {
      await $.command.register({
        name: prompt.name,
        description: prompt.description,
        ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
      })
      commands.add(prompt.name)
    } catch {
      // A name the engine refuses (a built-in, say) stays mid-prompt only.
    }
  }
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    await loadPrompts($, /*force*/ true).catch(() => {})
    await registerCommands($).catch(() => {})
    return next(e)
  })

  on("prompt.autocomplete", async ($, e, next) => {
    await loadPrompts($).catch(() => {})
    const token = typeof e.token === "string" ? e.token : ""
    if (!AUTOCOMPLETE_RE.test(token)) return next(e)
    // At the start of the message, `/name` is Claude Code's command space.
    if (typeof e.cursor === "number" && typeof e.text === "string" && e.cursor === token.length) {
      return next(e)
    }

    const suggestions = matches(token).map((prompt) => ({
      text: `/${prompt.name} `,
      label: prompt.name,
      ...(prompt.description ? { description: prompt.description } : {}),
    }))
    return suggestions.length ? { suggestions } : next(e)
  })

  on("prompt.submit", async ($, e, next) => {
    await loadPrompts($).catch(() => {})
    const text = expand(e.text)
    return text === e.text ? next(e) : next({ ...e, text })
  })

  on("command.run", async ($, e, next) => {
    if (!commands.has(e.command)) return next(e)
    await loadPrompts($).catch(() => {})

    if (e.command === "prompts") {
      const rows = [...prompts.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((prompt) => {
          const hint = prompt.argumentHint ? ` ${prompt.argumentHint}` : ""
          return `/${prompt.name}${hint} - ${prompt.description}`
        })
      return { text: rows.length ? rows.join("\n") : "mid-prompt: no templates found" }
    }

    const prompt = prompts.get(e.command)
    if (!prompt) return next(e)

    // command.run holds the turn, so submit once its answer has landed.
    setTimeout(() => {
      const text = expand(expandArgs(prompt.body, e.args))
      void $.prompt.submit({ text, asUser: true }).catch(() => {})
    }, 0)
    return {}
  })

  on("command.run", { command: "mid-prompt-reload" }, async ($) => {
    await loadPrompts($, /*force*/ true).catch(() => {})
    await registerCommands($).catch(() => {})
    return { text: `mid-prompt: loaded ${prompts.size} prompt(s)` }
  })
}
