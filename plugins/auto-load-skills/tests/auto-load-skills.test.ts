import { test, expect, describe, mock } from 'claude-code/testing'

const CWD = '/repo'
const HOME = '/home/me'
const CWD_SKILL = `${CWD}/.claude/skills/git/SKILL.md`
const HOME_SKILL = `${HOME}/.claude/skills/git/SKILL.md`
const CONFIG_SKILL = '/config/skills/git/SKILL.md'
const RAW = '---\nname: git\ndescription: Git\n---\nAlways use SSH.\n'
const PROMPT = { text: 'hi', wait: false, origin: { kind: 'sdk' } } as const

type Run = {
  argv: readonly string[]
  init?: { cwd?: string; timeoutMs?: number }
}

function fixtures(
  on: Parameters<typeof mock.env>[0],
  options: {
    cwd?: string
    env?: Record<string, string>
    exitCode?: number
    files?: Record<string, string>
    /** Number of checks that throw before they start passing. */
    failures?: number
  } = {},
) {
  const runs: Run[] = []
  const logs: string[] = []
  let failures = options.failures ?? 0

  mock.env(on, { HOME, ...options.env })
  on('session.cwd', () => ({ value: options.cwd ?? CWD }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('process.run', ($, e) => {
    runs.push(e)
    if (failures > 0) {
      failures--
      throw new Error('timed out')
    }
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
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })

  const submit = async ($: any): Promise<readonly string[]> => (await $.prompt.submit(PROMPT)).context ?? []
  const end = ($: any) => $.session.end({ reason: 'clear', sessionId: 's', resume: {} })

  return { runs, logs, submit, end }
}

describe('auto-load-skills', () => {
  test('attaches a skill as a typed command when its shell check passes', async ($, on) => {
    const { runs, submit } = fixtures(on, { files: { [CWD_SKILL]: RAW } })

    const context = await submit($)

    expect(context).toHaveLength(1)
    const text = context[0] ?? ''
    expect(text).toContain('<command-message>git</command-message>')
    expect(text).toContain('<command-name>/git</command-name>')
    expect(text).toContain('Base directory for this skill: /repo/.claude/skills/git')
    expect(text).toContain('Always use SSH.')
    expect(text).not.toContain('description: Git')

    expect(runs).toHaveLength(1)
    expect(runs[0]?.argv).toEqual(['bash', '-c', 'git rev-parse --show-toplevel >/dev/null 2>&1'])
    expect(runs[0]?.init?.cwd).toBe(CWD)
    expect(runs[0]?.init?.timeoutMs).toBe(5000)
  })

  test('attaches nothing when the shell check fails', async ($, on) => {
    const { submit } = fixtures(on, { exitCode: 1, files: { [CWD_SKILL]: RAW } })
    expect(await submit($)).toEqual([])
  })

  test('prefers the personal skill over the project one', async ($, on) => {
    const { submit } = fixtures(on, { files: { [CWD_SKILL]: RAW, [HOME_SKILL]: RAW } })
    expect((await submit($))[0]).toContain(`${HOME}/.claude/skills/git`)
  })

  test('reads personal skills from CLAUDE_CONFIG_DIR', async ($, on) => {
    const files = { [CONFIG_SKILL]: RAW, [HOME_SKILL]: RAW }
    const { submit } = fixtures(on, { env: { CLAUDE_CONFIG_DIR: '/config' }, files })
    expect((await submit($))[0]).toContain('Base directory for this skill: /config/skills/git')
  })

  test('finds a project skill in a parent directory', async ($, on) => {
    const { submit } = fixtures(on, { cwd: `${CWD}/packages/web`, files: { [CWD_SKILL]: RAW } })
    expect((await submit($))[0]).toContain('Base directory for this skill: /repo/.claude/skills/git')
  })

  test('warns and skips a missing skill', async ($, on) => {
    const { logs, submit } = fixtures(on)
    expect(await submit($)).toEqual([])
    expect(logs.some((line) => line.includes('cannot read skill "git"'))).toBe(true)
  })

  test('attaches once per conversation', async ($, on) => {
    const { runs, submit } = fixtures(on, { files: { [CWD_SKILL]: RAW } })

    expect(await submit($)).toHaveLength(1)
    expect(await submit($)).toEqual([])
    expect(runs).toHaveLength(1)
  })

  test('attaches once between overlapping prompts', async ($, on) => {
    const { runs, submit } = fixtures(on, { files: { [CWD_SKILL]: RAW } })

    const [a, b] = await Promise.all([submit($), submit($)])
    expect(a.length + b.length).toBe(1)
    expect(runs).toHaveLength(1)
  })

  test('warns and does not retry a check that fails to run', async ($, on) => {
    const { runs, logs, submit } = fixtures(on, { failures: 1, files: { [CWD_SKILL]: RAW } })

    expect(await submit($)).toEqual([])
    expect(logs.some((line) => line.includes('check failed for "git"'))).toBe(true)
    expect(await submit($)).toEqual([])
    expect(runs).toHaveLength(1)
  })

  test('attaches again after the session ends', async ($, on) => {
    const { runs, submit, end } = fixtures(on, { files: { [CWD_SKILL]: RAW } })

    await submit($)
    await end($)
    expect(await submit($)).toHaveLength(1)
    expect(runs).toHaveLength(2)
  })
})
