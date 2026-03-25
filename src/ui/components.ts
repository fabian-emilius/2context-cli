import { Box, Static, Text } from 'ink'
import { type ComponentType, createElement as h, type ReactNode, useEffect, useState } from 'react'

/** Static component typed for OutputLine items (helps createElement infer generics). */
const StaticLines = Static as ComponentType<{
  items: OutputLine[]
  children: (item: OutputLine, index: number) => ReactNode
}>

// ── Types ──────────────────────────────────────────────────────────────────────

export type LineType =
  | 'log'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'dim'
  | 'header'
  | 'divider'
  | 'kv'
  | 'list'
  | 'blank'
  | 'step'
  | 'tree'

export interface OutputLine {
  id: number
  type: LineType
  text: string
  data?: Record<string, unknown>
}

export interface AppProps {
  lines: OutputLine[]
  spinner: { message: string } | null
}

export interface TreeItem {
  label: string
  children?: TreeItem[]
}

// ── Spinner ────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function Spinner({ message }: { message: string }): ReactNode {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  return h(Text, null, h(Text, { color: 'yellow' }, SPINNER_FRAMES[frame]), ` ${message}`)
}

// ── Line renderers ─────────────────────────────────────────────────────────────

function HeaderLine({ text, subtitle }: { text: string; subtitle?: string }): ReactNode {
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(Text, { bold: true, color: 'cyan' }, text),
    subtitle ? h(Text, { dimColor: true }, subtitle) : null,
  )
}

function KeyValueBlock({ pairs }: { pairs: [string, string][] }): ReactNode {
  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length))
  return h(
    Box,
    { flexDirection: 'column' },
    ...pairs.map(([key, value], i) =>
      h(Text, { key: i }, h(Text, null, `  ${key.padEnd(maxKeyLen)}  `), h(Text, { bold: true }, value)),
    ),
  )
}

function ListBlock({
  items,
  indent = 0,
  bullet = '•',
}: {
  items: string[]
  indent?: number
  bullet?: string
}): ReactNode {
  return h(
    Box,
    { flexDirection: 'column' },
    ...items.map((item, i) =>
      h(Text, { key: i }, `${' '.repeat(indent)}`, h(Text, { dimColor: true }, bullet), ` ${item}`),
    ),
  )
}

function TreeBlock({ items, depth = 0 }: { items: TreeItem[]; depth?: number }): ReactNode {
  const children: ReactNode[] = []
  items.forEach((item, i) => {
    const connector = i === items.length - 1 ? '└─' : '├─'
    children.push(
      h(
        Box,
        { key: i, flexDirection: 'column' },
        h(Text, null, `${'  '.repeat(depth)}`, h(Text, { dimColor: true }, connector), ` ${item.label}`),
        item.children && item.children.length > 0 ? h(TreeBlock, { items: item.children, depth: depth + 1 }) : null,
      ),
    )
  })
  return h(Box, { flexDirection: 'column' }, ...children)
}

function LineRenderer({ line }: { line: OutputLine }): ReactNode {
  switch (line.type) {
    case 'header':
      return h(HeaderLine, {
        text: line.text,
        subtitle: line.data?.subtitle as string | undefined,
      })

    case 'success':
      return h(Text, null, h(Text, { color: 'green' }, '✔'), ` ${line.text}`)

    case 'error':
      return h(Text, null, h(Text, { color: 'red' }, '✖'), ` ${line.text}`)

    case 'warning':
      return h(Text, null, h(Text, { color: 'yellow' }, '⚠'), ` ${line.text}`)

    case 'info':
      return h(Text, null, h(Text, { color: 'blue' }, 'ℹ'), ` ${line.text}`)

    case 'dim':
      return h(Text, { dimColor: true }, line.text)

    case 'divider':
      if (line.text) {
        return h(Text, { dimColor: true }, `─── ${line.text} ───`)
      }
      return h(Text, { dimColor: true }, '─'.repeat(40))

    case 'kv':
      return h(KeyValueBlock, { pairs: line.data?.pairs as [string, string][] })

    case 'list':
      return h(ListBlock, {
        items: line.data?.items as string[],
        indent: line.data?.indent as number | undefined,
        bullet: line.data?.bullet as string | undefined,
      })

    case 'tree':
      return h(TreeBlock, { items: line.data?.items as TreeItem[] })

    case 'step': {
      const { current, total } = line.data as { current: number; total: number }
      return h(Text, null, h(Text, { dimColor: true }, `[${current}/${total}]`), ` ${line.text}`)
    }

    case 'blank':
      return h(Text, null, ' ')

    default:
      return h(Text, null, line.text)
  }
}

// ── Root App ───────────────────────────────────────────────────────────────────

export function App({ lines, spinner }: AppProps): ReactNode {
  return h(
    Box,
    { flexDirection: 'column' },
    h(StaticLines, {
      items: lines,
      children: (line: OutputLine) => h(Box, { key: line.id }, h(LineRenderer, { line })),
    }),
    spinner ? h(Spinner, { message: spinner.message }) : null,
  )
}
