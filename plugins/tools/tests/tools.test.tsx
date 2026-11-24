import { expect, test } from 'claude-code/testing'

const OUTPUT = { plugin: 'tools', surface: 'terminal', component: 'CommandOutput' } as const
const props = (text: string) => ({ command: 'tools', args: '', text, isErrored: false })

test('each group is a row: label, then its tools', async $ => {
  const ui = await $.ui.mount({ ...OUTPUT, props: props('builtin  Bash, Read\nGmail    authenticate') })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(['builtin', 'Bash, Read', 'Gmail', 'authenticate'])
  await ui.unmount()
})

test("the engine's plugin label is dropped", async $ => {
  const ui = await $.ui.mount({ ...OUTPUT, props: props('tools+mid-prompt: builtin  Bash') })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(['builtin', 'Bash'])
  await ui.unmount()
})

test('text that is not the table draws as the engine would', async $ => {
  const ui = await $.ui.mount({ ...OUTPUT, props: props('no tools') })
  expect(await ui.find({ text: 'builtin' })).toBeUndefined()
  await ui.unmount()
})
