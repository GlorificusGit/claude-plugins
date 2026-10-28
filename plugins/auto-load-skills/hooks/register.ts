// Auto-load skills from shell rules.
//
// Each rule runs its shell check in the session working directory. An exit
// code of 0 loads that rule's skill into the system prompt, so the model does
// not have to notice the skill listing or an AGENTS.md line first.
//
// Rules live in RULES below. A check is any shell command; redirect its output
// if it is noisy:
//
//   { skill: "git", when: "git rev-parse --show-toplevel >/dev/null 2>&1" }
//
// Skills are read from the first SKILL.md found in:
//
//   <cwd>/.claude/skills/<name>/SKILL.md
//   $HOME/.claude/skills/<name>/SKILL.md
//   <plugin>/skills/<name>/SKILL.md
//
// A skill supplied by another installed plugin is not searched: the hooks API
// lists skill names but not the paths behind them.

import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

interface Rule {
  /** Skill name, the directory holding SKILL.md. */
  skill: string
  /** Shell condition; exit code 0 loads the skill. */
  when: string
}

const RULES: readonly Rule[] = [
  { skill: 'git', when: 'git rev-parse --show-toplevel >/dev/null 2>&1' },
]

const SECTION = 'auto-load-skills:skills'
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/
const TIMEOUT_MS = 5000

/** Cached for the session: undefined until prepared, otherwise the combined blocks or null. */
let skillBlocks: string | null | undefined

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function warn($: EngineInterface, message: string): void {
  $.ui.log(message)
}

function skillPaths($: EngineInterface, cwd: string, home: string, name: string): string[] {
  return [
    `${cwd}/.claude/skills/${name}/SKILL.md`,
    ...(home ? [`${home}/.claude/skills/${name}/SKILL.md`] : []),
    `${$.plugin.root}/skills/${name}/SKILL.md`,
  ]
}

async function loadSkill($: EngineInterface, cwd: string, home: string, name: string): Promise<string> {
  let lastError: unknown
  for (const path of skillPaths($, cwd, home, name)) {
    let raw: string
    try {
      raw = await $.fs.read(path)
    } catch (err) {
      lastError = err
      continue
    }

    const body = raw.replace(FRONTMATTER, '').trim()
    const baseDir = path.slice(0, path.lastIndexOf('/'))
    return `<skill name="${name}" location="${path}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`
  }

  throw new Error(`auto-load-skills: cannot read skill "${name}": ${errorMessage(lastError)}`)
}

async function prepare($: EngineInterface): Promise<string | null> {
  if (skillBlocks !== undefined) return skillBlocks

  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const blocks: string[] = []

  for (const rule of RULES) {
    let result: ProcessRunResult
    try {
      result = await $.process.run(['bash', '-c', rule.when], { cwd, timeoutMs: TIMEOUT_MS })
    } catch (err) {
      warn($, `auto-load-skills: check failed for "${rule.skill}": ${errorMessage(err)}`)
      continue
    }
    if (result.exitCode !== 0) continue

    try {
      blocks.push(await loadSkill($, cwd, home, rule.skill))
    } catch (err) {
      warn($, errorMessage(err))
    }
  }

  skillBlocks = blocks.length > 0 ? blocks.join('\n\n') : null
  return skillBlocks
}

export const register: Register = (on) => {
  on('session.start', ($, e, next) => {
    skillBlocks = undefined
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    // A bare session asks for the one-line prompt; leave it alone.
    if (e.traits.includes('bare')) return result

    const text = await prepare($).catch((err) => {
      warn($, errorMessage(err))
      return null
    })
    if (!text) return result

    return {
      ...result,
      sections: [...result.sections, { id: SECTION, text, scope: 'session' as const }],
    }
  })
}
