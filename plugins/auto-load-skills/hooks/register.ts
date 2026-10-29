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
//   $CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md   (default $HOME/.claude)
//   <dir>/.claude/skills/<name>/SKILL.md        (cwd, then each parent below $HOME)
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

/** The session's combined blocks, or null; undefined until a prompt first asks. */
let skillBlocks: Promise<string | null> | undefined

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The cwd and each parent, nearest first, stopping before $HOME and /. */
function projectDirs(cwd: string, home: string): string[] {
  const dirs: string[] = []
  for (let dir = cwd; dir && dir !== home; dir = dir.slice(0, dir.lastIndexOf('/'))) {
    dirs.push(dir)
  }
  return dirs
}

async function loadSkill($: EngineInterface, dirs: readonly string[], name: string): Promise<string> {
  let lastError: unknown
  for (const path of dirs.map((dir) => `${dir}/${name}/SKILL.md`)) {
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

/** Runs every rule; `retry` is set when a check failed to run, so the result is not kept. */
async function build($: EngineInterface): Promise<{ text: string | null; retry: boolean }> {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '')
  // Claude Code's order: personal skills ahead of project ones.
  const dirs = [
    ...(configDir ? [`${configDir}/skills`] : []),
    ...projectDirs(cwd, home).map((dir) => `${dir}/.claude/skills`),
    `${$.plugin.root}/skills`,
  ]
  const blocks: string[] = []
  let retry = false

  for (const rule of RULES) {
    let result: ProcessRunResult
    try {
      result = await $.process.run(['bash', '-c', rule.when], { cwd, timeoutMs: TIMEOUT_MS })
    } catch (err) {
      $.ui.log(`auto-load-skills: check failed for "${rule.skill}": ${errorMessage(err)}`)
      retry = true
      continue
    }
    if (result.exitCode !== 0) continue

    try {
      blocks.push(await loadSkill($, dirs, rule.skill))
    } catch (err) {
      $.ui.log(errorMessage(err))
    }
  }

  return { text: blocks.length > 0 ? blocks.join('\n\n') : null, retry }
}

/** Shares one build between overlapping prompts; a failed check runs again next prompt. */
function prepare($: EngineInterface): Promise<string | null> {
  skillBlocks ??= build($).then(
    ({ text, retry }) => {
      if (retry) skillBlocks = undefined
      return text
    },
    (err: unknown) => {
      skillBlocks = undefined
      throw err
    },
  )
  return skillBlocks
}

export const register: Register = (on) => {
  // Fires on exit, /clear and resume; the next prompt checks again.
  on('session.end', ($, e, next) => {
    skillBlocks = undefined
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    // A bare session asks for the one-line prompt; leave it alone.
    if (e.traits.includes('bare')) return result

    const text = await prepare($).catch((err) => {
      $.ui.log(errorMessage(err))
      return null
    })
    if (!text) return result

    return {
      ...result,
      sections: [...result.sections, { id: SECTION, text, scope: 'session' as const }],
    }
  })
}
