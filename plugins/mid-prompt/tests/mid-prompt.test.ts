import { test, expect, mock, describe } from 'claude-code/testing'

const DIR = '/tmp/mid-prompt-test-prompts'
const HOME = '/tmp/mid-prompt-test-home'

function fixtures(on: Parameters<typeof mock.env>[0], files: Record<string, string>) {
  const submitted: string[] = []
  const registered: string[] = []

  mock.env(on, { HOME, MID_PROMPT_DIR: DIR })
  on('fs.list', { path: DIR }, () => ({
    value: Object.keys(files).map((name) => ({
      name,
      kind: 'file' as const,
      size: files[name]!.length,
      mtimeMs: 0,
      isLink: false,
    })),
  }))
  on('fs.read', ($, e) => {
    const text = files[e.path.slice(DIR.length + 1)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text, origin: e.origin }
  })
  on('command.list', () => ({ value: [] }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })

  return { submitted, registered }
}

const PRESENTATION = { surface: 'main' as const, width: 80 }
const run = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'sdk' }, presentation: PRESENTATION })

describe('mid-prompt', () => {
  test('suggests and expands a template mid-prompt', async ($, on) => {
    fixtures(on, {
      'ask.md': '---\ndescription: Ask first\n---\nDo not modify anything.',
      'cat.md': 'your favorite cat is a maine coon\n',
    })

    expect(await run($, 'mid-prompt-reload')).toEqual({
      text: 'mid-prompt: loaded 2 prompt(s)',
    })

    const ac = await $.prompt.autocomplete({
      text: 'explain this /as',
      cursor: 16,
      token: '/as',
      start: 13,
    })
    expect(ac.suggestions.map((s) => s.label)).toEqual(['ask'])

    const submit = await $.prompt.submit({
      text: 'explain this /ask',
      wait: false,
      origin: { kind: 'sdk' },
    })
    expect(submit).toEqual({ text: 'explain this Do not modify anything.', origin: { kind: 'sdk' } })
  })

  test('leaves a leading slash alone in plain prompt text', async ($, on) => {
    fixtures(on, { 'ask.md': 'Do not modify anything.' })

    const ac = await $.prompt.autocomplete({
      text: '/ask',
      cursor: 4,
      token: '/ask',
      start: 0,
    })
    expect(ac.suggestions).toEqual([])

    const submit = await $.prompt.submit({
      text: '/ask',
      wait: false,
      origin: { kind: 'sdk' },
    })
    expect(submit.text).toBe('/ask')
  })

  test('registers leading slash commands and lists them', async ($, on) => {
    const { registered } = fixtures(on, {
      'ask.md': '---\ndescription: Ask first\nargument-hint: "[topic]"\n---\nDo not modify anything.',
      'bad name.md': 'not a command name',
    })

    await run($, 'mid-prompt-reload')
    expect(registered).toEqual(['prompts', 'mid-prompt-reload', 'ask'])
  })

  test('runs a leading slash template with arguments', async ($, on) => {
    const { submitted } = fixtures(on, {
      'doctor.md': '---\ndescription: Medical advice\nargument-hint: "[symptom]"\n---\nplease give me medical advice about',
      'args.md': '$1=[$1] $@=[$@] ${1:-DEF}=[${1:-DEF}] ${@:2}=[${@:2}]',
    })

    await run($, 'mid-prompt-reload')
    await run($, 'doctor', 'a headache')
    await run($, 'args', 'one two three')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(submitted).toEqual([
      'please give me medical advice about\n\na headache',
      'one=[one] one two three=[one two three] one=[one] two three=[two three]',
    ])
  })


  test('expands later tokens in a leading command line', async ($, on) => {
    const { submitted } = fixtures(on, {
      'ask.md': 'talk only',
      'cat.md': 'favorite cat',
      'color.md': 'favorite color',
    })

    await run($, 'mid-prompt-reload')
    await run($, 'ask', '/cat /color')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(submitted).toEqual(['talk only\n\nfavorite cat favorite color'])
  })


  test('expands several mid-prompt tokens in one line', async ($, on) => {
    fixtures(on, {
      'ask.md': 'talk only',
      'cat.md': 'favorite cat',
      'color.md': 'favorite color',
    })

    const submit = await $.prompt.submit({
      text: 'mix /ask /cat /color',
      wait: false,
      origin: { kind: 'sdk' },
    })
    expect(submit.text).toBe('mix talk only favorite cat favorite color')
  })

  test('/prompts lists templates', async ($, on) => {
    fixtures(on, {
      'ask.md': '---\ndescription: Ask first\n---\nDo not modify anything.',
      'doctor.md': '---\ndescription: Medical advice\n---\nGive advice.',
    })

    await run($, 'mid-prompt-reload')
    const result = await run($, 'prompts')
    expect(result.text).toBe('/ask - Ask first\n/doctor - Medical advice')
  })
})
