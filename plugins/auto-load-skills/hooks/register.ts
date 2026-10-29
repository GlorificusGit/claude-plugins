// Auto-load skills from shell rules.
//
// Each rule runs its shell check in the session working directory when the
// first prompt of a conversation is submitted. An exit code of 0 attaches that
// rule's skill to the prompt in the shape of a typed `/<name>` (the engine
// labels it hook context), so the model treats the skill as loaded and does
// not invoke it again. Subagents start without a submitted prompt, so they do
// not inherit it.
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

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/
const TIMEOUT_MS = 5000

/** Whether this conversation's first prompt has run the rules. */
let checked = false

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

/** The skill as a typed `/<name>` reaches the model. */
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
    return [
      `<command-message>${name}</command-message>`,
      `<command-name>/${name}</command-name>`,
      '',
      `Base directory for this skill: ${baseDir}`,
      '',
      body,
    ].join('\n')
  }

  throw new Error(`auto-load-skills: cannot read skill "${name}": ${errorMessage(lastError)}`)
}

/** Runs the rules once per conversation and returns the skills they load. */
async function load($: EngineInterface): Promise<string[]> {
  if (checked) return []
  // Set before the first await, so an overlapping prompt does not run them too.
  checked = true

  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '')
  // Claude Code's order: personal skills ahead of project ones.
  const dirs = [
    ...(configDir ? [`${configDir}/skills`] : []),
    ...projectDirs(cwd, home).map((dir) => `${dir}/.claude/skills`),
    `${$.plugin.root}/skills`,
  ]
  const skills: string[] = []

  for (const rule of RULES) {
    let result: ProcessRunResult
    try {
      result = await $.process.run(['bash', '-c', rule.when], { cwd, timeoutMs: TIMEOUT_MS })
    } catch (err) {
      $.ui.log(`auto-load-skills: check failed for "${rule.skill}": ${errorMessage(err)}`)
      continue
    }
    if (result.exitCode !== 0) continue

    try {
      skills.push(await loadSkill($, dirs, rule.skill))
    } catch (err) {
      $.ui.log(errorMessage(err))
    }
  }

  return skills
}

export const register: Register = (on) => {
  // Fires on exit, /clear and resume; the next conversation checks again.
  on('session.end', ($, e, next) => {
    checked = false
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const skills = await load($).catch((err) => {
      $.ui.log(errorMessage(err))
      return []
    })
    if (skills.length === 0) return next(e)
    return next({ ...e, context: [...(e.context ?? []), ...skills] })
  })
}
