import { useRef, useState } from 'react'

import { OpenApiFilePicker, OpenApiWarningList } from '@/components/OpenApiShared'
import { Button } from '@/components/ui/button'
import { apiErrorCode, describeOpenApiError } from '@/lib/api'
import {
  buildSyncApplyInput,
  canSelectForRemoval,
  changesByKind,
  emptySyncDecisions,
  syncChangeLabel,
  unresolvedConflictKeys,
  type OpenApiConflictResolution,
  type OpenApiSpecFile,
  type OpenApiSyncApplyInput,
  type OpenApiSyncApplyResult,
  type OpenApiSyncChange,
  type OpenApiSyncChangeKind,
  type OpenApiSyncDecisions,
  type OpenApiSyncPreview,
  type OpenApiWarning,
} from '@/lib/openapi'
import type { CollectionResource, WorkspaceItem } from '@/lib/workspace-types'

interface OpenApiSyncDialogProps {
  collections: CollectionResource[]
  initialCollectionId?: string
  onCancel: () => void
  onPreview: (collectionId: string, spec: string) => Promise<OpenApiSyncPreview>
  onApply: (collectionId: string, input: OpenApiSyncApplyInput) => Promise<{ result: OpenApiSyncApplyResult; refreshError?: string }>
  onComplete: (collectionId: string) => void
}

type Stage = 'select' | 'review' | 'done'

const SECTIONS: Array<{ kind: OpenApiSyncChangeKind; title: string; help: string }> = [
  { kind: 'conflict', title: 'Conflicts', help: 'The document and the local request both changed since the last sync. Choose which version to keep for each one.' },
  { kind: 'adopt', title: 'Possible matches', help: 'Untracked requests with the same method and path. Adopting one replaces its fields with the document version; otherwise a separate request is created.' },
  { kind: 'delete-conflict', title: 'Removed from the document (edited locally)', help: 'These requests stay in the collection unless you select them for Trash.' },
  { kind: 'delete', title: 'Removed from the document', help: 'These requests stay in the collection unless you select them for Trash.' },
  { kind: 'missing', title: 'Tracked requests missing from the collection', help: 'Recreate them from the document, or stop tracking them when the operation no longer exists.' },
  { kind: 'add', title: 'New requests', help: 'Created and tracked when you apply.' },
  { kind: 'update', title: 'Updated from the document', help: 'These requests have no local edits and are updated automatically.' },
  { kind: 'move', title: 'Moved to a new folder', help: 'The source folder (first tag or path) changed. These requests move automatically.' },
  { kind: 'local-edit', title: 'Local edits kept', help: 'Edited locally since the last sync, but the document did not change those fields.' },
]

const SUMMARY: Array<{ kind: OpenApiSyncChangeKind; label: string }> = [
  { kind: 'add', label: 'new' },
  { kind: 'update', label: 'updated' },
  { kind: 'conflict', label: 'conflicts' },
  { kind: 'delete', label: 'removed' },
]

function findRequest(items: WorkspaceItem[], id: string, path: string[] = []): { name: string; path: string[] } | null {
  for (const item of items) {
    if (item.id === id) return { name: item.name, path }
    if (item.type === 'folder') {
      const found = findRequest(item.items, id, [...path, item.name])
      if (found) return found
    }
  }
  return null
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return value || '(empty)'
  return JSON.stringify(value, null, 2)
}

function FieldDiff({ change }: { change: OpenApiSyncChange }) {
  const fields = (change.changedFields ?? []).filter((field) => field !== 'folderPath')
  if (fields.length === 0 || (!change.before && !change.after)) return null
  return (
    <details className="openapi-sync-diff">
      <summary>Show differences</summary>
      <p className="openapi-sync-redacted">Sensitive values are hidden in this preview.</p>
      {fields.map((field) => (
        <div className="openapi-sync-diff-field" key={field}>
          <strong>{field}</strong>
          <div>
            <pre aria-label={`${field} before`}>{formatValue(change.before?.[field as keyof typeof change.before])}</pre>
            <pre aria-label={`${field} after`}>{formatValue(change.after?.[field as keyof typeof change.after])}</pre>
          </div>
        </div>
      ))}
    </details>
  )
}

export function OpenApiSyncDialog({ collections, initialCollectionId, onCancel, onPreview, onApply, onComplete }: OpenApiSyncDialogProps) {
  const [collectionId, setCollectionId] = useState(
    collections.find((entry) => entry.id === initialCollectionId)?.id ?? collections[0]?.id ?? '',
  )
  const [file, setFile] = useState<OpenApiSpecFile | null>(null)
  const [stage, setStage] = useState<Stage>('select')
  const [preview, setPreview] = useState<OpenApiSyncPreview | null>(null)
  const [decisions, setDecisions] = useState<OpenApiSyncDecisions>(emptySyncDecisions)
  const [result, setResult] = useState<OpenApiSyncApplyResult | null>(null)
  const [resultWarnings, setResultWarnings] = useState<OpenApiWarning[]>([])
  const [refreshError, setRefreshError] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [highlightConflicts, setHighlightConflicts] = useState(false)
  const [busy, setBusy] = useState(false)
  // State updates are async, so a ref is what actually blocks a double submission.
  const inFlight = useRef(false)

  const collection = collections.find((entry) => entry.id === collectionId)
  const unresolved = preview ? unresolvedConflictKeys(preview, decisions) : []
  const groups = preview ? changesByKind(preview.changes) : new Map<OpenApiSyncChangeKind, OpenApiSyncChange[]>()
  const unchanged = groups.get('unchanged') ?? []

  async function loadPreview(nextNotice = '') {
    if (!collection || !file || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice(nextNotice)
    setHighlightConflicts(false)
    setPreview(null)
    setDecisions(emptySyncDecisions())
    setStage('review')
    try {
      setPreview(await onPreview(collection.id, file.text))
    } catch (cause) {
      setError(describeOpenApiError(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function apply() {
    if (!collection || !file || !preview || inFlight.current) return
    if (unresolved.length > 0) {
      setHighlightConflicts(true)
      setError(`Choose a version for ${unresolved.length} conflict(s) before applying.`)
      return
    }
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    let refreshReason = ''
    try {
      const response = await onApply(collection.id, buildSyncApplyInput(file.text, preview, decisions))
      // A successful apply invalidates the preview token; drop it so it can never be resent.
      setResultWarnings(preview.warnings)
      setPreview(null)
      setDecisions(emptySyncDecisions())
      setResult(response.result)
      setRefreshError(response.refreshError ?? '')
      setStage('done')
    } catch (cause) {
      const code = apiErrorCode(cause)
      if (code === 'OPENAPI_SYNC_PREVIEW_STALE') {
        refreshReason = 'The collection or its sync source changed after this preview. Your choices were cleared; review the refreshed changes and confirm again.'
      } else if (code === 'OPENAPI_SYNC_INVALID_CHOICE') {
        refreshReason = 'Some choices no longer match the preview. The preview was refreshed and your choices were cleared; review them again.'
      } else if (code === 'OPENAPI_SYNC_RESOLUTION_REQUIRED') {
        setHighlightConflicts(true)
        setError(`${describeOpenApiError(cause)} Choose a version for every conflict.`)
      } else {
        setError(describeOpenApiError(cause))
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
    if (refreshReason) await loadPreview(refreshReason)
  }

  function setConflict(key: string, resolution: OpenApiConflictResolution) {
    setDecisions((current) => ({ ...current, conflicts: { ...current.conflicts, [key]: resolution } }))
  }

  function setAdopt(key: string, candidateId: string) {
    setDecisions((current) => {
      const adopt = { ...current.adopt }
      if (candidateId) adopt[key] = candidateId
      else delete adopt[key]
      return { ...current, adopt }
    })
  }

  function toggleRemoval(itemId: string, selected: boolean) {
    setDecisions((current) => ({
      ...current,
      deleteItemIds: selected ? [...current.deleteItemIds.filter((id) => id !== itemId), itemId] : current.deleteItemIds.filter((id) => id !== itemId),
    }))
  }

  function toggleRecreate(key: string, selected: boolean) {
    setDecisions((current) => ({
      ...current,
      recreate: selected ? [...current.recreate.filter((entry) => entry !== key), key] : current.recreate.filter((entry) => entry !== key),
    }))
  }

  function requestName(itemId: string | undefined) {
    if (!itemId || !collection) return null
    const found = findRequest(collection.items, itemId)
    return found ? [...found.path, found.name].join(' / ') : null
  }

  function renderDecision(change: OpenApiSyncChange) {
    const label = syncChangeLabel(change)
    if (change.kind === 'conflict') {
      return (
        <div className="openapi-sync-choice" role="radiogroup" aria-label={`Resolve conflict for ${label}`}>
          {(['keep', 'spec'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`conflict-${change.key}`}
                checked={decisions.conflicts[change.key] === value}
                disabled={busy}
                onChange={() => setConflict(change.key, value)}
              />
              {value === 'keep' ? 'Keep local request' : 'Use document version'}
            </label>
          ))}
        </div>
      )
    }
    if (change.kind === 'adopt') {
      return (
        <label className="openapi-sync-choice">
          <span>Match</span>
          <select
            className="text-field"
            aria-label={`Adopt existing request for ${label}`}
            value={decisions.adopt[change.key] ?? ''}
            disabled={busy}
            onChange={(event) => setAdopt(change.key, event.target.value)}
          >
            <option value="">Create a separate request</option>
            {(change.candidateItemIds ?? []).map((id) => (
              <option key={id} value={id}>Adopt {requestName(id) ?? id}</option>
            ))}
          </select>
        </label>
      )
    }
    if (change.kind === 'missing' && change.recreatable) {
      return (
        <label className="openapi-sync-choice">
          <input type="checkbox" checked={decisions.recreate.includes(change.key)} disabled={busy} onChange={(event) => toggleRecreate(change.key, event.target.checked)} />
          Recreate request
        </label>
      )
    }
    if (canSelectForRemoval(change)) {
      const isMissing = change.kind === 'missing'
      return (
        <label className="openapi-sync-choice">
          <input
            type="checkbox"
            checked={decisions.deleteItemIds.includes(change.itemId!)}
            disabled={busy}
            onChange={(event) => toggleRemoval(change.itemId!, event.target.checked)}
          />
          {isMissing ? 'Stop tracking' : 'Move to Trash'}
        </label>
      )
    }
    return null
  }

  function renderChange(change: OpenApiSyncChange) {
    const name = requestName(change.itemId)
    const folderChanged = change.afterFolderPath && change.beforeFolderPath
      && change.afterFolderPath.join('/') !== change.beforeFolderPath.join('/')
    const needsChoice = highlightConflicts && change.kind === 'conflict' && !decisions.conflicts[change.key]
    return (
      <li className={`openapi-sync-change${needsChoice ? ' needs-choice' : ''}`} key={`${change.kind}-${change.key}-${change.itemId ?? ''}`}>
        <div className="openapi-sync-change-head">
          <span className={`bulk-import-method ${change.method.toLowerCase()}`}>{change.method}</span>
          <span className="openapi-sync-path">{change.path}</span>
          {change.operationId && <span className="openapi-sync-operation">{change.operationId}</span>}
        </div>
        {name && <p className="openapi-sync-meta">Request: {name}</p>}
        {folderChanged && <p className="openapi-sync-meta">Folder: {change.beforeFolderPath!.join(' / ') || 'Collection root'} → {change.afterFolderPath!.join(' / ') || 'Collection root'}</p>}
        {(change.changedFields?.length ?? 0) > 0 && (
          <p className="openapi-sync-meta">Changed: {change.changedFields!.join(', ')}</p>
        )}
        <FieldDiff change={change} />
        {renderDecision(change)}
      </li>
    )
  }

  function renderPending(change: OpenApiSyncChange) {
    return (
      <div className="bulk-import-result-row" key={`${change.kind}-${change.key}-${change.itemId ?? ''}`}>
        <span>{syncChangeLabel(change)}</span>
        <strong>{change.kind === 'missing' ? 'Missing, still tracked' : 'Removed from document, kept'}</strong>
      </div>
    )
  }

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog bulk-import-dialog openapi-dialog openapi-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="openapi-sync-title">
        <header className="modal-heading">
          <div>
            <h2 id="openapi-sync-title">
              {stage === 'select' ? 'Sync a collection with OpenAPI' : stage === 'review' ? 'Review sync changes' : 'Sync applied'}
            </h2>
            <p>
              {stage === 'done'
                ? `${collection?.name ?? 'The collection'} is now tracking this OpenAPI document.`
                : 'Compare a collection with an OpenAPI document. The preview changes nothing; applying links the collection to the document (one source per collection) and updates its requests. The collection name, description, and auth are not changed.'}
            </p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>

        {stage !== 'done' && (
          <div className="bulk-import-steps" aria-label="Sync steps">
            <span className={stage === 'select' ? 'active' : 'done'}>1&nbsp; Collection and file</span>
            <span className={stage === 'review' ? 'active' : ''}>2&nbsp; Review and apply</span>
          </div>
        )}

        <div className="bulk-import-content">
          {stage === 'select' && (
            <>
              <label className="field-label" htmlFor="openapi-sync-collection">Collection</label>
              <select
                id="openapi-sync-collection"
                className="text-field"
                value={collectionId}
                disabled={busy || collections.length === 0}
                onChange={(event) => setCollectionId(event.target.value)}
              >
                {collections.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
              </select>
              <OpenApiFilePicker file={file} disabled={busy} onFile={(next) => { setFile(next); setError('') }} onError={(message) => { setFile(null); setError(message) }} />
              {!collection && <p className="inline-error" role="alert">Create a collection before syncing.</p>}
              {error && <p className="inline-error" role="alert">{error}</p>}
            </>
          )}

          {stage === 'review' && (
            <>
              {file && <p className="bulk-import-file-name">{file.fileName} · {collection?.name}</p>}
              {notice && <p className="openapi-sync-notice" role="status">{notice}</p>}
              {busy && !preview && <p role="status">Comparing with the API…</p>}
              {error && <div className="bulk-import-api-error" role="alert"><strong>Sync failed</strong><p>{error}</p></div>}
              {preview && (
                <>
                  <p className="bulk-import-policy-summary">
                    Source: <strong>{preview.source.title || 'Untitled'}</strong>{preview.source.version ? ` (${preview.source.version})` : ''}
                    {' · '}
                    {preview.linked ? 'This collection already tracks an OpenAPI source; applying updates it.' : 'Not linked yet; applying links this collection to the document.'}
                  </p>
                  <div className="bulk-import-stats openapi-sync-stats">
                    {SUMMARY.map(({ kind, label }) => {
                      const count = kind === 'delete'
                        ? (groups.get('delete')?.length ?? 0) + (groups.get('delete-conflict')?.length ?? 0)
                        : groups.get(kind)?.length ?? 0
                      return <div key={kind}><strong>{count}</strong><span>{label}</span></div>
                    })}
                  </div>
                  {preview.changes.length === unchanged.length && <p className="bulk-import-no-warnings">The collection already matches this document.</p>}
                  {SECTIONS.map(({ kind, title, help }) => {
                    const changes = groups.get(kind)
                    if (!changes?.length) return null
                    return (
                      <section className={`openapi-sync-section ${kind}`} key={kind} aria-label={title}>
                        <h3>{title} ({changes.length})</h3>
                        <p>{help}</p>
                        <ul>{changes.map(renderChange)}</ul>
                      </section>
                    )
                  })}
                  {unchanged.length > 0 && (
                    <details className="openapi-sync-section unchanged">
                      <summary>Unchanged ({unchanged.length})</summary>
                      <ul>{unchanged.map(renderChange)}</ul>
                    </details>
                  )}
                  <OpenApiWarningList warnings={preview.warnings} />
                </>
              )}
            </>
          )}

          {stage === 'done' && result && (
            <>
              <div className="bulk-import-success-mark">✓</div>
              <div className="bulk-import-result-list">
                <div className="bulk-import-result-row"><span>Added</span><strong>{result.applied.added}</strong></div>
                <div className="bulk-import-result-row"><span>Adopted</span><strong>{result.applied.adopted}</strong></div>
                <div className="bulk-import-result-row"><span>Updated</span><strong>{result.applied.updated}</strong></div>
                <div className="bulk-import-result-row"><span>Moved</span><strong>{result.applied.moved}</strong></div>
                <div className="bulk-import-result-row"><span>Moved to Trash or untracked</span><strong>{result.applied.deleted}</strong></div>
                <div className="bulk-import-result-row"><span>Recreated</span><strong>{result.applied.recreated}</strong></div>
              </div>
              {result.pending.length > 0 && (
                <div className="bulk-import-result-list">
                  <h3>Still pending ({result.pending.length})</h3>
                  {result.pending.map(renderPending)}
                </div>
              )}
              {resultWarnings.length > 0 && <OpenApiWarningList warnings={resultWarnings} />}
              {refreshError
                ? <p className="bulk-import-refresh-error" role="alert">{refreshError}</p>
                : <p className="bulk-import-dry-run">The collection has been refreshed.</p>}
            </>
          )}
        </div>

        <footer className="modal-actions">
          {stage === 'select' && (
            <>
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
              <Button disabled={!collection || !file || busy} onClick={() => void loadPreview()}>Preview changes</Button>
            </>
          )}
          {stage === 'review' && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => { setStage('select'); setPreview(null); setError(''); setNotice('') }}>Back</Button>
              {!preview && error && <Button variant="outline" disabled={busy} onClick={() => void loadPreview()}>Retry preview</Button>}
              {preview && (
                <Button disabled={busy} onClick={() => void apply()}>
                  {busy ? 'Applying…' : unresolved.length > 0 ? `Resolve ${unresolved.length} conflict(s)` : 'Apply sync'}
                </Button>
              )}
            </>
          )}
          {stage === 'done' && (
            <>
              <Button variant="outline" onClick={() => void loadPreview()}>Compare again</Button>
              <Button onClick={() => onComplete(collectionId)}>View collection</Button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
