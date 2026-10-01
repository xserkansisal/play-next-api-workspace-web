import { useEffect, useMemo, useState } from 'react'

import { CompareDiff } from '@/components/CompareDiff'
import { Button } from '@/components/ui/button'
import { describeApiError, workspaceApi } from '@/lib/api'
import type {
  CollectionResource,
  CollectionVersionSnapshot,
  ItemVersionSnapshot,
  ResourceDraft,
  ResourceVersion,
  WorkspaceItem,
} from '@/lib/workspace-types'

type VersionEntry =
  | ResourceVersion<CollectionVersionSnapshot>
  | ResourceVersion<ItemVersionSnapshot>

interface VersionHistoryDialogProps {
  draft: Exclude<ResourceDraft, { kind: 'environment' }>
  dirty: boolean
  onClose: () => void
  onRestored: (resource: CollectionResource | WorkspaceItem) => void
}

function applySnapshot(draft: VersionHistoryDialogProps['draft'], snapshot: VersionEntry['snapshot']): ResourceDraft {
  if (draft.kind === 'collection') {
    if ('type' in snapshot) throw new Error('The API returned an item snapshot for a collection.')
    return { ...draft, resource: { ...draft.resource, ...snapshot } }
  }
  if (!('type' in snapshot)) {
    throw new Error('The API returned a version for a different resource type.')
  }
  if (draft.kind === 'folder') {
    if (snapshot.type !== 'folder') throw new Error('The API returned a request snapshot for a folder.')
    return { ...draft, resource: { ...draft.resource, ...snapshot } }
  }
  if (snapshot.type !== 'request') throw new Error('The API returned a folder snapshot for a request.')
  return { ...draft, resource: { ...draft.resource, ...snapshot } }
}

export function VersionHistoryDialog({ draft, dirty, onClose, onRestored }: VersionHistoryDialogProps) {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const resourceId = draft.resource.id
  const collectionId = draft.kind === 'collection' ? draft.resource.id : draft.collectionId

  async function loadVersions() {
    setLoading(true)
    setError(null)
    try {
      const result = draft.kind === 'collection'
        ? await workspaceApi.collectionVersions(collectionId)
        : await workspaceApi.itemVersions(collectionId, resourceId)
      setVersions(result)
      setSelectedId((current) => current && result.some(({ id }) => id === current) ? current : result[0]?.id ?? null)
    } catch (reason) {
      setError(describeApiError(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = draft.kind === 'collection'
          ? await workspaceApi.collectionVersions(collectionId)
          : await workspaceApi.itemVersions(collectionId, resourceId)
        if (cancelled) return
        setVersions(result)
        setSelectedId(result[0]?.id ?? null)
      } catch (reason) {
        if (!cancelled) setError(describeApiError(reason))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [collectionId, draft.kind, resourceId])

  const selected = versions.find(({ id }) => id === selectedId)
  const preview = useMemo(
    () => selected ? applySnapshot(draft, selected.snapshot) : null,
    [draft, selected],
  )

  async function restoreSelected() {
    if (!selected) return
    setRestoring(true)
    setError(null)
    setNotice(null)
    try {
      const resource = draft.kind === 'collection'
        ? await workspaceApi.restoreCollectionVersion(collectionId, selected.id)
        : await workspaceApi.restoreItemVersion(collectionId, resourceId, selected.id)
      onRestored(resource)
      setConfirming(false)
      setSelectedId(null)
      setNotice('Version restored. The replaced state was added to history.')
      await loadVersions()
    } catch (reason) {
      setError(describeApiError(reason))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="version-history-title">
        <header className="modal-heading">
          <div>
            <h2 id="version-history-title">Version history</h2>
            <p>{draft.resource.name} · prior saved states</p>
          </div>
          <button aria-label="Close version history" onClick={onClose} disabled={restoring}>×</button>
        </header>
        {loading && <p role="status">Loading versions…</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {notice && <p className="version-history-notice" role="status">{notice}</p>}
        {!loading && !error && versions.length === 0 && (
          <p className="version-history-empty">No saved versions yet. History starts after the first successful edit.</p>
        )}
        {versions.length > 0 && (
          <div className="version-history-content">
            <nav className="version-history-list" aria-label="Saved versions">
              {versions.map((version) => (
                <button
                  className={`version-history-entry ${selectedId === version.id ? 'selected' : ''}`}
                  key={version.id}
                  onClick={() => {
                    setSelectedId(version.id)
                    setConfirming(false)
                    setNotice(null)
                  }}
                >
                  <strong>{new Date(version.createdAt).toLocaleString()}</strong>
                  <span>Saved by {version.createdBy || 'unknown'}</span>
                </button>
              ))}
            </nav>
            <div className="version-history-preview">
              {preview && (
                <>
                  <p>Selected saved version compared with the current editor:</p>
                  <CompareDiff
                    local={draft}
                    latest={preview}
                    localLabel="Current editor"
                    latestLabel="Selected saved version"
                    snapshotOnly
                  />
                </>
              )}
              {confirming && (
                <p className="version-history-confirm" role="alert">
                  Restore this snapshot?{dirty ? ' This will replace your unsaved editor changes.' : ''}
                </p>
              )}
            </div>
          </div>
        )}
        <footer className="modal-actions">
          <Button variant="outline" onClick={onClose} disabled={restoring}>Close</Button>
          {confirming ? (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={restoring}>Cancel restore</Button>
              <Button onClick={() => void restoreSelected()} disabled={restoring || !selected}>
                {restoring ? 'Restoring…' : 'Confirm restore'}
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)} disabled={loading || restoring || !selected}>
              Restore selected version
            </Button>
          )}
        </footer>
      </section>
    </div>
  )
}
