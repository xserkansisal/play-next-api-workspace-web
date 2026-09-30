import { useMemo, useState } from 'react'

import { extractVisible, filterJson } from '@/lib/json-filter'
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
 * A collapsible, filterable view of a JSON response body.
 *
 * A pretty-printed body is fine until it is a few hundred lines, at which point finding one field
 * means scrolling past everything else. Collapsing is the cheap fix, and it pairs with capturing:
 * each row carries the path the capture form expects, so the value you found is the value you can
 * name without retyping a path by hand and hoping it matches.
 *
 * Filtering covers what collapsing does not: the browser's own find cannot see into a collapsed
 * branch, because those rows are not in the DOM. Copying follows the filter, so the fragment you
 * narrowed down to is the fragment you can take away.
 */

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Clipboard unavailable'))
}

/** Pretty-printed, because the reason to copy a fragment is usually to read or edit it. */
function toJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value)
}

function Row({ row, matched, onToggle, onReveal, onCopyPath, onCopyValue }: {
  row: JsonRow
  matched: boolean
  onToggle: (id: string) => void
  onReveal: (id: string) => void
  onCopyPath: (path: string) => void
  onCopyValue: (row: JsonRow) => void
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
    <div className={matched ? 'json-row json-row-match' : 'json-row'} style={indent}>
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
      <button
        type="button"
        className="json-copy-value"
        title={`Copy the value at ${row.path || 'the response body'}`}
        aria-label={`Copy value ${row.path || 'the response body'}`}
        onClick={() => onCopyValue(row)}
      >
        value
      </button>
    </div>
  )
}

export function JsonTree({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(() => defaultExpanded(value))
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
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
    setQuery('')
    setCopied(null)
    setCopyFailed(null)
  }

  const filter = useMemo(() => filterJson(value, query), [value, query])

  // The filter's own expansion is unioned with the user's rather than replacing it, so clearing the
  // filter leaves the branches they had opened themselves exactly as they were.
  const effectiveExpanded = useMemo(
    () => (filter === null ? expanded : new Set([...expanded, ...filter.expand])),
    [expanded, filter],
  )

  const rows = useMemo(
    () => buildRows(value, { expanded: effectiveExpanded, revealed, visible: filter?.visible }),
    [value, effectiveExpanded, revealed, filter],
  )
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
      () => { setCopied(`path ${path}`); setCopyFailed(null) },
      // The path itself is short, so showing it lets it be selected by hand.
      () => { setCopied(null); setCopyFailed(`Could not reach the clipboard. The path is ${path}`) },
    )
  }

  /**
   * Copies the value as it is in the response, not as the filter narrowed it. The row shows the
   * real path beside it, and handing back a subtree with entries missing under that path would be
   * a fragment that does not match what the path resolves to. The bar's button is the one that
   * follows the filter.
   */
  const copyValue = (row: JsonRow) => {
    const where = row.path || 'the response body'
    void copyToClipboard(toJsonText(row.value)).then(
      () => { setCopied(`the value at ${where}`); setCopyFailed(null) },
      // Not shown inline the way a path is: a value can be the whole body.
      () => { setCopied(null); setCopyFailed(`Could not reach the clipboard, so the value at ${where} was not copied.`) },
    )
  }

  const copyBody = () => {
    const text = toJsonText(filter === null ? value : extractVisible(value, filter.visible))
    void copyToClipboard(text).then(
      () => { setCopied(filter === null ? 'the response body' : 'the filtered part'); setCopyFailed(null) },
      () => { setCopied(null); setCopyFailed('Could not reach the clipboard, so nothing was copied. Use the Raw tab to select the body by hand.') },
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
        <button type="button" onClick={copyBody} title={filter === null ? 'Copy the whole response body' : 'Copy only the part matching the filter'}>
          {filter === null ? 'Copy' : 'Copy filtered'}
        </button>
        <div className="json-filter">
          <input
            type="search"
            className="json-filter-input"
            aria-label="Filter response"
            placeholder="Filter keys and values"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {filter !== null && (
            <span className="json-filter-count" role="status">
              {filter.matchCount === 1 ? '1 match' : `${filter.matchCount} matches`}
            </span>
          )}
        </div>
        {copied && <span className="json-copied" role="status">{`Copied ${copied}`}</span>}
        {copyFailed && (
          <span className="json-copy-failed" role="alert">{copyFailed}</span>
        )}
      </div>
      <div className="json-tree" role="tree" aria-label="Response body">
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            matched={filter?.matches.has(row.id) ?? false}
            onToggle={toggle}
            onReveal={reveal}
            onCopyPath={copyPath}
            onCopyValue={copyValue}
          />
        ))}
        {filter !== null && filter.matchCount === 0 && (
          <p className="json-no-matches">No key or value matches that.</p>
        )}
      </div>
    </div>
  )
}
