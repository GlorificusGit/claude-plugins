import { test, expect, describe, mock } from 'claude-code/testing'

const CWD = '/repo'
const HOME = '/home/me'
const CWD_SKILL = `${CWD}/.claude/skills/git/SKILL.md`
const HOME_SKILL = `${HOME}/.claude/skills/git/SKILL.md`
const RAW = '---\nname: git\ndescription: Git\n---\nAlways use SSH.\n'
const PROMPT = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null }

type Run = {
  argv: readonly string[]
  init?: { cwd?: string; timeoutMs?: number }
}

function fixtures(
  on: Parameters<typeof mock.env>[0],
  options: { exitCode?: number; files?: Record<string, string> } = {},
) {
  const runs: Run[] = []
  const logs: string[] = []

  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('process.run', ($, e) => {
    runs.push(e)
    return {
      value: {
        exitCode: options.exitCode ?? 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('fs.read', ($, e) => {
    const text = options.files?.[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })

  const start = ($: any) => $.session.start({ cwd: CWD, surface: null, isInteractive: false })

  return { runs, logs, start }
}

describe('auto-load-skills', () => {
  test('loads a skill when its shell check passes', async ($, on) => {
    const { runs, start } = fixtures(on, { files: { [CWD_SKILL]: RAW } })
    await start($)

    const { sections } = await $.prompt.compose({ ...PROMPT, traits: [] })

    expect(sections).toHaveLength(1)
    expect(sections[0]?.id).toBe('auto-load-skills:skills')
    const text = sections[0]?.text ?? ''
    expect(text).toContain('<skill name="git"')
    expect(text).toContain(`location="${CWD_SKILL}"`)
    expect(text).toContain('References are relative to /repo/.claude/skills/git.')
    expect(text).toContain('Always use SSH.')
    expect(text).not.toContain('description: Git')

    expect(runs).toHaveLength(1)
    expect(runs[0]?.argv).toEqual(['bash', '-c', 'git rev-parse --show-toplevel >/dev/null 2>&1'])
    expect(runs[0]?.init?.cwd).toBe(CWD)
    expect(runs[0]?.init?.timeoutMs).toBe(5000)
  })

  test('injects nothing when the shell check fails', async ($, on) => {
    const { start } = fixtures(on, { exitCode: 1, files: { [CWD_SKILL]: RAW } })
    await start($)

    const { sections } = await $.prompt.compose({ ...PROMPT, traits: [] })
    expect(sections).toEqual([])
  })

  test('falls back to the user skill directory', async ($, on) => {
    const { start } = fixtures(on, { files: { [HOME_SKILL]: RAW } })
    await start($)

    const { sections } = await $.prompt.compose({ ...PROMPT, traits: [] })
    expect(sections[0]?.text).toContain(`location="${HOME_SKILL}"`)
  })

  test('warns and skips a missing skill', async ($, on) => {
    const { logs, start } = fixtures(on)
    await start($)

    const { sections } = await $.prompt.compose({ ...PROMPT, traits: [] })
    expect(sections).toEqual([])
    expect(logs.some((line) => line.includes('cannot read skill "git"'))).toBe(true)
  })

  test('leaves a bare session alone', async ($, on) => {
    const { runs, start } = fixtures(on, { files: { [CWD_SKILL]: RAW } })
    await start($)

    const { sections } = await $.prompt.compose({ ...PROMPT, traits: ['bare'] })
    expect(sections).toEqual([])
    expect(runs).toEqual([])
  })

  test('checks once per session', async ($, on) => {
    const { runs, start } = fixtures(on, { files: { [CWD_SKILL]: RAW } })
    await start($)

    await $.prompt.compose({ ...PROMPT, traits: [] })
    await $.prompt.compose({ ...PROMPT, traits: [] })
    expect(runs).toHaveLength(1)
  })
})
