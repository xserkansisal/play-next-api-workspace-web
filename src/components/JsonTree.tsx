import { useMemo, useState } from 'react'

import {
  allContainerIds,
  buildRows,
  defaultExpanded,
  formatPrimitive,
  primitiveClass,
  summarise,
  type JsonRow,
} from '@/lib/json-tree'

/**
 * A collapsible view of a JSON response body.
 *
 * A pretty-printed body is fine until it is a few hundred lines, at which point finding one field
 * means scrolling past everything else. Collapsing is the cheap fix, and it pairs with capturing:
 * each row carries the path the capture form expects, so the value you found is the value you can
 * name without retyping a path by hand and hoping it matches.
 */

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Clipboard unavailable'))
}

function Row({ row, onToggle, onReveal, onCopyPath }: {
  row: JsonRow
  onToggle: (id: string) => void
  onReveal: (id: string) => void
  onCopyPath: (path: string) => void
}) {
  const indent = { paddingLeft: `${row.depth * 14 + 8}px` }

  if (row.hiddenCount !== undefined) {
    return (
      <div className="json-row json-row-more" style={indent}>
        <button type="button" className="json-more" onClick={() => onReveal(row.id.replace(/\u0000\u0000more$/, ''))}>
          {`Show ${row.hiddenCount} more`}
        </button>
      </div>
    )
  }

  const isContainer = row.kind !== 'primitive'
  const label = row.label === null ? null : <span className="json-key">{row.label}</span>

  return (
    <div className="json-row" style={indent}>
      {isContainer && row.childCount > 0 ? (
        <button
          type="button"
          className="json-toggle"
          aria-expanded={row.expanded}
          aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.path || 'the response body'}`}
          onClick={() => onToggle(row.id)}
        >
          {row.expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="json-toggle-spacer" />
      )}
      {label}
      {isContainer ? (
        <span className="json-summary">
          {row.kind === 'array' ? '[' : '{'}
          {!row.expanded && <span className="json-count">{summarise(row)}</span>}
          {!row.expanded && (row.kind === 'array' ? ']' : '}')}
        </span>
      ) : (
        <span className={primitiveClass(row.value)}>{formatPrimitive(row.value)}</span>
      )}
      {row.path && (
        <button
          type="button"
          className="json-copy-path"
          title={`Copy path ${row.path}`}
          aria-label={`Copy path ${row.path}`}
          onClick={() => onCopyPath(row.path!)}
        >
          path
        </button>
      )}
    </div>
  )
}

export function JsonTree({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(() => defaultExpanded(value))
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [copied, setCopied] = useState<string | null>(null)
  // The clipboard is refusable — an insecure origin, a denied permission, an unfocused document.
  // Reporting the path instead lets it be selected by hand, where a silent no-op would just look
  // like a dead button.
  const [copyFailed, setCopyFailed] = useState<string | null>(null)
  // A new response is a new document: carrying the previous expansion over would apply it to paths
  // that mean something different, or nothing at all. Reset during render rather than in an effect,
  // so the tree is never painted once with the old state.
  const [renderedValue, setRenderedValue] = useState(value)
  if (renderedValue !== value) {
    setRenderedValue(value)
    setExpanded(defaultExpanded(value))
    setRevealed(new Set())
    setCopied(null)
    setCopyFailed(null)
  }

  const rows = useMemo(() => buildRows(value, { expanded, revealed }), [value, expanded, revealed])
  // Computed once per body: whether expand-all is affordable is a property of the body, not of the
  // current expansion state.
  const everything = useMemo(() => allContainerIds(value), [value])

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const reveal = (id: string) => setRevealed((current) => new Set(current).add(id))

  const copyPath = (path: string) => {
    void copyToClipboard(path).then(
      () => { setCopied(path); setCopyFailed(null) },
      () => { setCopied(null); setCopyFailed(path) },
    )
  }

  return (
    <div className="json-tree-wrap">
      <div className="json-tree-bar">
        <button
          type="button"
          onClick={() => everything && setExpanded(everything)}
          disabled={!everything}
          title={everything ? undefined : 'This body is too large to expand at once. Open the branches you need instead.'}
        >
          Expand all
        </button>
        <button type="button" onClick={() => setExpanded(new Set())}>Collapse all</button>
        {copied && <span className="json-copied" role="status">{`Copied ${copied}`}</span>}
        {copyFailed && (
          <span className="json-copy-failed" role="alert">{`Could not reach the clipboard. The path is ${copyFailed}`}</span>
        )}
      </div>
      <div className="json-tree" role="tree" aria-label="Response body">
        {rows.map((row) => (
          <Row key={row.id} row={row} onToggle={toggle} onReveal={reveal} onCopyPath={copyPath} />
        ))}
      </div>
    </div>
  )
}
