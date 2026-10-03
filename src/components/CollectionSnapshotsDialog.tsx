import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { describeApiError, workspaceApi } from '@/lib/api'
import type {
  CollectionSnapshotDetail,
  CollectionSnapshotDiff,
  CollectionSnapshotNode,
  CollectionSnapshotSummary,
} from '@/lib/workspace-types'

interface CollectionSnapshotsDialogProps {
  collectionId: string
  collectionName: string
  dirty: boolean
  canRestore: boolean
  onClose: () => void
  onRestored: (collection: Awaited<ReturnType<typeof workspaceApi.restoreCollectionSnapshot>>) => void
}

function SnapshotTree({ items, depth = 0 }: { items: CollectionSnapshotNode[]; depth?: number }) {
  return (
    <ul className="snapshot-tree">
      {items.map((item) => (
        <li key={item.id}>
          <span style={{ paddingInlineStart: `${depth * 16}px` }}>
            <strong>{item.name}</strong>
            <small>{item.type === 'folder' ? 'Folder' : item.method}</small>
          </span>
          {item.type === 'folder' && item.items.length > 0 && <SnapshotTree items={item.items} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

function pathLabel(path: string[]): string {
  return path.join(' / ') || 'Collection'
}

function SnapshotDiff({ diff }: { diff: CollectionSnapshotDiff }) {
  const entries = useMemo(() => [
    ...diff.items.added.map((entry) => ({ key: `added-${entry.id}`, kind: 'Added', path: entry.path, detail: entry.node.type })),
    ...diff.items.removed.map((entry) => ({ key: `removed-${entry.id}`, kind: 'Removed', path: entry.path, detail: entry.node.type })),
    ...diff.items.moved.map((entry) => ({ key: `moved-${entry.id}`, kind: 'Moved', path: entry.toPath, detail: `From ${pathLabel(entry.fromPath)}` })),
    ...diff.items.changed.map((entry) => ({ key: `changed-${entry.id}`, kind: 'Changed', path: [`Item ${entry.id}`], detail: entry.fields.join(', ') })),
  ], [diff])

  if (!diff.collectionFields.length && entries.length === 0) {
    return <p className="version-history-empty">These snapshots are identical.</p>
  }

  return (
    <div className="snapshot-diff" aria-label="Snapshot differences">
      {diff.collectionFields.length > 0 && (
        <p><strong>Collection:</strong> {diff.collectionFields.join(', ')}</p>
      )}
      {entries.map((entry) => (
        <p key={entry.key}>
          <strong>{entry.kind}:</strong>{' '}
          {`${pathLabel(entry.path)} · ${entry.detail}`}
        </p>
      ))}
      <small>Field values are hidden because snapshots can contain credentials and other sensitive data.</small>
    </div>
  )
}

export function CollectionSnapshotsDialog({
  collectionId,
  collectionName,
  dirty,
  canRestore,
  onClose,
  onRestored,
}: CollectionSnapshotsDialogProps) {
  const [snapshots, setSnapshots] = useState<CollectionSnapshotSummary[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const nextOffsetRef = useRef<number | null>(null)
  const [selectedRestoreId, setSelectedRestoreId] = useState<string | null>(null)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('current')
  const [detail, setDetail] = useState<CollectionSnapshotDetail | null>(null)
  const [diff, setDiff] = useState<CollectionSnapshotDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function loadPage(offset: number, append: boolean) {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const result = await workspaceApi.collectionSnapshots(collectionId, 25, offset)
      setSnapshots((current) => append ? [...current, ...result.snapshots] : result.snapshots)
      nextOffsetRef.current = result.nextOffset
      setNextOffset(result.nextOffset)
      setSelectedRestoreId((current) => current ?? result.snapshots[0]?.id ?? null)
      setFromId((current) => current || result.snapshots[1]?.id || result.snapshots[0]?.id || '')
    } catch (reason) {
      setError(describeApiError(reason))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadPage(0, false)
    // Collection identity is stable for the lifetime of this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId])

  useEffect(() => {
    let cancelled = false
    if (!selectedRestoreId) {
      setDetail(null)
      return
    }
    setDetail(null)
    void workspaceApi.collectionSnapshot(collectionId, selectedRestoreId)
      .then((result) => { if (!cancelled) setDetail(result) })
      .catch((reason: unknown) => { if (!cancelled) setError(describeApiError(reason)) })
    return () => { cancelled = true }
  }, [collectionId, selectedRestoreId])

  useEffect(() => {
    let cancelled = false
    if (!fromId || !toId || (toId !== 'current' && toId === fromId)) {
      setDiff(null)
      setDiffLoading(false)
      return
    }
    setDiff(null)
    setDiffLoading(true)
    void workspaceApi.collectionSnapshotDiff(collectionId, fromId, toId)
      .then((result) => { if (!cancelled) setDiff(result) })
      .catch((reason: unknown) => { if (!cancelled) setError(describeApiError(reason)) })
      .finally(() => { if (!cancelled) setDiffLoading(false) })
    return () => { cancelled = true }
  }, [collectionId, fromId, toId])

  async function restoreSelected() {
    if (!canRestore || !selectedRestoreId || restoring) return
    setRestoring(true)
    setError(null)
    setNotice(null)
    try {
      const restored = await workspaceApi.restoreCollectionSnapshot(collectionId, selectedRestoreId)
      onRestored(restored)
      setConfirming(false)
      setNotice('Snapshot restored. The replaced state was added to snapshot history.')
      await loadPage(0, false)
    } catch (reason) {
      setError(describeApiError(reason))
    } finally {
      setRestoring(false)
    }
  }

  const selectedSnapshot = snapshots.find(({ id }) => id === selectedRestoreId)
  const fromOptions = snapshots
  const toOptions = snapshots.filter(({ id }) => id !== fromId)

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog version-history-dialog snapshots-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshots-title">
        <header className="modal-heading">
          <div>
            <h2 id="snapshots-title">Collection snapshots</h2>
            <p>{collectionName} · complete collection history</p>
          </div>
          <button aria-label="Close snapshots" onClick={onClose} disabled={restoring}>×</button>
        </header>
        {loading && <p role="status">Loading snapshots…</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {notice && <p className="version-history-notice" role="status">{notice}</p>}
        {!loading && snapshots.length === 0 && !error && (
          <p className="version-history-empty">No snapshots yet. History starts after the first successful collection change.</p>
        )}
        {snapshots.length > 0 && (
          <div className="snapshot-layout">
            <div className="snapshot-browser">
              <nav className="version-history-list" aria-label="Saved collection snapshots">
                {snapshots.map((snapshot) => (
                  <button
                    className={`version-history-entry ${selectedRestoreId === snapshot.id ? 'selected' : ''}`}
                    key={snapshot.id}
                    onClick={() => {
                      setSelectedRestoreId(snapshot.id)
                      setConfirming(false)
                      setNotice(null)
                    }}
                  >
                    <strong>{new Date(snapshot.createdAt).toLocaleString()}</strong>
                    <span>Saved by {snapshot.createdBy || 'Unknown user'} · {snapshot.itemCount} items</span>
                  </button>
                ))}
              </nav>
              {nextOffset !== null && (
                <Button variant="outline" onClick={() => {
                  const offset = nextOffsetRef.current
                  if (offset !== null) void loadPage(offset, true)
                }} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
              {detail && selectedSnapshot && (
                <div className="snapshot-tree-preview">
                  <h3>Snapshot contents</h3>
                  <p>{detail.snapshot.name} · {detail.itemCount} items</p>
                  <SnapshotTree items={detail.snapshot.items} />
                  <small>Request URLs, bodies, and authentication values are not shown.</small>
                </div>
              )}
            </div>
            <div className="snapshot-compare">
              <h3>Compare snapshots</h3>
              <div className="snapshot-selectors">
                <label>From
                  <select aria-label="Compare from snapshot" value={fromId} onChange={(event) => {
                    const id = event.target.value
                    setFromId(id)
                    setToId((current) => current === id ? 'current' : current)
                  }}>
                    {fromOptions.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{new Date(snapshot.createdAt).toLocaleString()}</option>)}
                  </select>
                </label>
                <label>To
                  <select aria-label="Compare to snapshot" value={toId} onChange={(event) => setToId(event.target.value)}>
                    <option value="current">Current collection</option>
                    {toOptions.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{new Date(snapshot.createdAt).toLocaleString()}</option>)}
                  </select>
                </label>
              </div>
              {diffLoading
                ? <p className="version-history-empty" role="status">Comparing snapshots…</p>
                : diff
                  ? <SnapshotDiff diff={diff} />
                  : <p className="version-history-empty">Select two different states to compare.</p>}
              {canRestore && confirming && (
                <p className="version-history-confirm" role="alert">
                  Restore this entire collection snapshot?{dirty ? ' This will replace unsaved editor changes.' : ''} Current changes will remain recoverable as a new snapshot.
                </p>
              )}
            </div>
          </div>
        )}
        <footer className="modal-actions">
          <Button variant="outline" onClick={onClose} disabled={restoring}>Close</Button>
          {canRestore && confirming ? (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={restoring}>Cancel restore</Button>
              <Button onClick={() => void restoreSelected()} disabled={restoring || !selectedRestoreId}>
                {restoring ? 'Restoring…' : 'Confirm restore'}
              </Button>
            </>
          ) : canRestore ? (
            <Button onClick={() => setConfirming(true)} disabled={loading || restoring || !selectedRestoreId}>
              Restore selected snapshot
            </Button>
          ) : null}
        </footer>
      </section>
    </div>
  )
}
