import { useMemo, useState } from 'react'

import { countChanges, diffLines, type DiffLine } from '@/lib/json-diff'
import type { ResourceDraft } from '@/lib/workspace-types'

const CONTEXT = 3

/**
 * What the comparison shows: the resource itself, without the client-only draft wrapper, and with
 * a request body split into lines so a whitespace or line-ending change is visible instead of
 * hiding inside one long escaped string.
 */
export function comparableText(draft: ResourceDraft | undefined, snapshotOnly = false): string {
  if (!draft) return ''
  if (draft.kind === 'collection') {
    const { items: _items, ...resource } = draft.resource
    return JSON.stringify(snapshotOnly
      ? { name: resource.name, description: resource.description, auth: resource.auth ?? null }
      : resource, null, 2)
  }
  if (snapshotOnly && draft.kind === 'folder') {
    return JSON.stringify({ type: 'folder', name: draft.resource.name, description: draft.resource.description, auth: draft.resource.auth ?? null }, null, 2)
  }
  if (draft.kind === 'request') {
    const { body, ...rest } = draft.resource
    const resource = snapshotOnly
      ? {
          type: 'request',
          name: rest.name,
          description: rest.description,
          method: rest.method,
          url: rest.url,
          queryParams: rest.queryParams,
          headers: rest.headers,
          auth: rest.auth,
        }
      : rest
    return JSON.stringify({ ...resource, body: body ? { type: body.type, content: body.content.split('\n') } : null }, null, 2)
  }
  return JSON.stringify(draft.resource, null, 2)
}

type Row = DiffLine | { type: 'gap'; hidden: number; key: string }

function collapse(lines: readonly DiffLine[]): Row[] {
  const keep = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.type === 'same') return
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(lines.length - 1, index + CONTEXT); k++) keep[k] = true
  })
  const rows: Row[] = []
  let hidden = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden) rows.push({ type: 'gap', hidden, key: `gap-${index}` })
      hidden = 0
      rows.push(line)
    } else {
      hidden++
    }
  })
  if (hidden) rows.push({ type: 'gap', hidden, key: 'gap-end' })
  return rows
}

export function CompareDiff({
  local,
  latest,
  localLabel = 'Your local draft',
  latestLabel = 'Latest on server',
  snapshotOnly = false,
}: {
  local: ResourceDraft | undefined
  latest: ResourceDraft
  localLabel?: string
  latestLabel?: string
  snapshotOnly?: boolean
}) {
  const [changesOnly, setChangesOnly] = useState(true)
  const lines = useMemo(() => diffLines(comparableText(local, snapshotOnly), comparableText(latest, snapshotOnly)), [local, latest, snapshotOnly])
  const { added, removed } = countChanges(lines)
  const rows = changesOnly ? collapse(lines) : lines

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-legend"><span className="diff-swatch removed" />{localLabel}</span>
        <span className="diff-legend"><span className="diff-swatch added" />{latestLabel}</span>
        <span className="diff-summary">
          {added + removed === 0 ? 'No differences' : <><span className="diff-count removed">−{removed}</span><span className="diff-count added">+{added}</span></>}
        </span>
        <label className="diff-toggle">
          <input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} />
          Changes only
        </label>
      </div>
      {added + removed === 0 ? (
        <p className="diff-empty">Your draft and the server version are identical. You can keep working safely.</p>
      ) : (
        <div
          className="diff-body"
          role="table"
          aria-label={snapshotOnly
            ? `Changes between ${localLabel.toLowerCase()} and ${latestLabel.toLowerCase()}`
            : 'Changes between your draft and the server version'}
        >
          {rows.map((row, index) => {
            if (row.type === 'gap') {
              return <div key={row.key} className="diff-row gap" role="row"><span role="cell">⋯ {row.hidden} unchanged line{row.hidden === 1 ? '' : 's'}</span></div>
            }
            const leftNo = row.type === 'added' ? '' : row.leftNo
            const rightNo = row.type === 'removed' ? '' : row.rightNo
            const text = row.type === 'added' ? row.right : row.left
            const sign = row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '
            return (
              <div key={index} className={`diff-row ${row.type}`} role="row">
                <span className="diff-no" role="cell">{leftNo}</span>
                <span className="diff-no" role="cell">{rightNo}</span>
                <span className="diff-sign" role="cell">{sign}</span>
                <span className="diff-text" role="cell">{text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
