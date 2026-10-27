// Mid-prompt prompt-template autocomplete and expansion.
//
// Reads Markdown prompt templates from ~/.agents/prompts (override with
// MID_PROMPT_DIR). A mid-prompt `/name` token opens a suggestion row and is
// replaced with the template body on submit. Leading `/name` belongs to
// Claude Code's own command namespace and is left alone.

const NAME = "[A-Za-z0-9_.:-]+"
const TOKEN_RE = new RegExp(`(^|[\\s\\t([{<\`"'])\\/(${NAME})`, "g")
const AUTOCOMPLETE_RE = /^\/([A-Za-z0-9_.:-]*)$/
const MAX_SUGGESTIONS = 20

let prompts = new Map()
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

  return { name, description, body }
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

export function register(on) {
  on("session.start", async ($, e, next) => {
    await loadPrompts($, /*force*/ true).catch(() => {})
    await $.command.register({
      name: "mid-prompt-reload",
      description: "Reload mid-prompt templates from ~/.agents/prompts",
    })
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

  on("command.run", { command: "mid-prompt-reload" }, async ($) => {
    await loadPrompts($, /*force*/ true).catch(() => {})
    return { text: `mid-prompt: loaded ${prompts.size} prompt(s)` }
  })
}
