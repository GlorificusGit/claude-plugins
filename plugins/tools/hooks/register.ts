// tools
//
// /tools lists the tools the model can call in this session, grouped by where
// each comes from: "builtin" or its MCP server (a mod's registered tools count
// as one). List only. Change the selection with --tools, --disallowedTools or
// permission deny rules.

import type { Register } from 'claude-code'

const MCP = /^mcp__(.+?)__(.+)$/

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
}
