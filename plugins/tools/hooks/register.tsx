// tools
//
// /tools lists the tools the model can call in this session, grouped by where
// each comes from: "builtin" or its MCP server (a mod's registered tools count
// as one). List only. Change the selection with --tools, --disallowedTools or
// permission deny rules.
//
// The output row is drawn as a table, each group's tools wrapping beside its
// label. Drawing it also drops the engine's label naming every plugin that
// hooks the command (mid-prompt hooks them all).

import type { Register } from 'claude-code'

const MCP = /^mcp__(.+?)__(.+)$/
// One output line: group label, then its tools.
const ROW = /^(\S+)\s{2,}(.+)$/
// The engine's label ahead of the text, naming every plugin hooking the command.
const LABEL = /^[^\s:]+: /

/** The tool's group and its name within it. */
function source(name: string): [string, string] {
  const [, server, tool] = MCP.exec(name) ?? []
  return server && tool ? [server, tool] : ['builtin', name]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tools', description: 'List the tools the model can call' })
    return next(e)
  })

  on('command.run', { command: 'tools' }, async $ => {
    const groups = new Map<string, string[]>()
    for (const tool of await $.tool.list()) {
      const [label, name] = source(tool.name)
      groups.set(label, [...(groups.get(label) ?? []), name])
    }
    const width = Math.max(0, ...[...groups.keys()].map(label => label.length))
    const lines = [...groups].map(([label, names]) => `${label.padEnd(width)}  ${names.join(', ')}`)
    return { text: lines.join('\n') || 'no tools', isTextDisplayOnly: true }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'tools' } }, ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const rows: [string, string][] = []
    for (const line of e.props.text.replace(LABEL, '').split('\n')) {
      const [, label, names] = ROW.exec(line) ?? []
      if (!label || !names) return next(e)
      rows.push([label, names])
    }
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(...rows.map(([label]) => label.length)) + 2
    return (
      <Box flexDirection="column">
        {rows.map(([label, names]) => (
          <Box flexDirection="row">
            <Box width={width} flexShrink={0}>
              <Text bold>{label}</Text>
            </Box>
            <Text>{names}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
