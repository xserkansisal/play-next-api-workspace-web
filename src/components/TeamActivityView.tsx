import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'

import { Button } from '@/components/ui/button'
import { apiErrorCode, describeApiError, workspaceApi } from '@/lib/api'
import type { ActivityEntry } from '@/lib/api'
import type { CollectionResource, EnvironmentResource, OpenResource, WorkspaceItem } from '@/lib/workspace-types'

const actionLabels: Record<string, string> = {
  'collection.created': 'created a collection',
  'collection.updated': 'updated collection details',
  'collection.version_restored': 'restored a collection version',
  'collection.cloned': 'cloned a collection',
  'collection.trashed': 'moved a collection to Trash',
  'collection.restored': 'restored a collection',
  'collection.imported': 'imported items',
  'collection.openapi_synced': 'synced a collection from OpenAPI',
  'item.created': 'created an item',
  'item.updated': 'updated an item',
  'item.version_restored': 'restored an item version',
  'item.cloned': 'cloned an item',
  'item.moved': 'moved an item',
  'item.trashed': 'moved an item to Trash',
  'item.restored': 'restored an item',
  'environment.created': 'created an environment',
  'environment.updated': 'updated an environment',
  'environment.variable_added': 'added an environment variable',
  'environment.cloned': 'cloned an environment',
  'environment.trashed': 'moved an environment to Trash',
  'environment.restored': 'restored an environment',
  'variable.created': 'created a shared variable',
  'variable.updated': 'updated a shared variable',
  'variable.renamed': 'renamed a shared variable',
  'variable.deleted': 'deleted a shared variable',
}

const safeDetailLabels: Record<string, string> = {
  changedFields: 'Changed fields',
  itemCount: 'Items',
  restoredItemCount: 'Restored items',
  renamedItemCount: 'Renamed items',
  folders: 'Folders',
  requests: 'Requests',
  renamedFolders: 'Renamed folders',
  added: 'Added',
  adopted: 'Adopted',
  updated: 'Updated',
  moved: 'Moved',
  deleted: 'Deleted',
  recreated: 'Recreated',
  pendingCount: 'Pending',
  variableCount: 'Variables',
  subtreeItemCount: 'Items in subtree',
  sourceCollectionId: 'Source collection',
  sourceItemId: 'Source item',
  sourceEnvironmentId: 'Source environment',
  parentId: 'Parent',
  targetParentId: 'Target parent',
  targetCollectionId: 'Target collection',
  variableKey: 'Variable',
}

const safeCountKeys = new Set([
  'itemCount', 'restoredItemCount', 'renamedItemCount', 'folders', 'requests', 'renamedFolders',
  'added', 'adopted', 'updated', 'moved', 'deleted', 'recreated', 'pendingCount', 'variableCount',
  'subtreeItemCount',
])
const safeIdKeys = new Set([
  'sourceCollectionId', 'sourceItemId', 'sourceEnvironmentId', 'parentId', 'targetParentId', 'targetCollectionId',
])

function safeDetails(details: ActivityEntry['details']): Array<{ label: string; value: string }> {
  return Object.entries(safeDetailLabels).flatMap(([key, label]) => {
    const value = details[key]
    if (key === 'changedFields' && Array.isArray(value)) {
      const fields = value.filter((field): field is string => typeof field === 'string')
      return fields.length ? [{ label, value: fields.join(', ') }] : []
    }
    if (safeCountKeys.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return [{ label, value: String(value) }]
    }
    if (safeIdKeys.has(key) && typeof value === 'string') return [{ label, value }]
    if (key === 'variableKey' && typeof value === 'string') return [{ label, value }]
    return []
  })
}

function findItem(items: WorkspaceItem[], id: string, type: 'folder' | 'request'): boolean {
  return items.some((item) => item.id === id && item.type === type ||
    item.type === 'folder' && findItem(item.items, id, type))
}

function availableResource(
  entry: ActivityEntry,
  collections: CollectionResource[],
  environments: EnvironmentResource[],
): OpenResource | null {
  if (entry.resourceType === 'collection') {
    return collections.some(({ id }) => id === entry.resourceId)
      ? { kind: 'collection', collectionId: entry.resourceId }
      : null
  }
  if (entry.resourceType === 'environment') {
    return environments.some(({ id }) => id === entry.resourceId)
      ? { kind: 'environment', environmentId: entry.resourceId }
      : null
  }
  if (entry.resourceType !== 'folder' && entry.resourceType !== 'request') return null
  const collection = collections.find(({ id }) => id === entry.collectionId)
  return collection && findItem(collection.items, entry.resourceId, entry.resourceType)
    ? {
        kind: entry.resourceType,
        collectionId: collection.id,
        itemId: entry.resourceId,
      }
    : null
}

interface TeamActivityViewProps {
  teamId: string | null
  collections: CollectionResource[]
  environments: EnvironmentResource[]
  onOpenResource: (resource: OpenResource) => void
}

export function TeamActivityView({
  teamId,
  collections,
  environments,
  onOpenResource,
}: TeamActivityViewProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadSequence, setReloadSequence] = useState(0)

  useEffect(() => {
    let cancelled = false
    setEntries([])
    setNextCursor(null)
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    if (!teamId) {
      setLoading(false)
      return () => { cancelled = true }
    }
    void workspaceApi.activity().then((page) => {
      if (cancelled) return
      setEntries(page.entries)
      setNextCursor(page.nextCursor)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(describeApiError(reason))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [teamId, reloadSequence])

  async function loadMore() {
    if (!teamId || !nextCursor || loadingMore) return
    const cursor = nextCursor
    setLoadingMore(true)
    setError(null)
    try {
      const page = await workspaceApi.activity(50, cursor)
      setEntries((current) => [...current, ...page.entries])
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (isAxiosError(reason) && reason.response?.status === 400 && apiErrorCode(reason) === 'ACTIVITY_CURSOR_INVALID') {
        setEntries([])
        setNextCursor(null)
        setReloadSequence((current) => current + 1)
      } else {
        setError(describeApiError(reason))
      }
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section className="trash-view team-activity-view">
      <div className="view-heading">
        <div>
          <h1>Team activity</h1>
          <p>Successful shared-content changes for the selected team.</p>
        </div>
      </div>
      {!teamId ? (
        <div className="empty-workspace"><h2>No team selected</h2><p>Select a team to view its activity.</p></div>
      ) : loading ? (
        <div className="empty-workspace" role="status"><span className="loading-spinner" /><p>Loading team activity…</p></div>
      ) : error && entries.length === 0 ? (
        <div className="empty-workspace"><p role="alert">{error}</p><Button variant="outline" onClick={() => setReloadSequence((current) => current + 1)}>Retry</Button></div>
      ) : entries.length === 0 ? (
        <div className="empty-workspace"><span className="response-symbol">◷</span><h2>No team activity yet</h2><p>Successful shared-content changes will appear here.</p></div>
      ) : (
        <>
          <div className="trash-list activity-list">
            {entries.map((entry) => {
              const resource = availableResource(entry, collections, environments)
              const details = safeDetails(entry.details)
              const actionLabel = actionLabels[entry.action] ?? entry.action.replace(/[._]/g, ' ')
              return (
                <article className="trash-entry activity-entry" key={entry.id}>
                  <div>
                    <strong>{entry.actor} {actionLabel}</strong>
                    {resource
                      ? <button className="activity-resource-link" onClick={() => onOpenResource(resource)}>{entry.resourceName}</button>
                      : <span className="activity-resource-name">{entry.resourceName}</span>}
                    <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                    {details.length > 0 && (
                      <ul className="activity-details">
                        {details.map(({ label, value }) => <li key={label}><span>{label}:</span> {value}</li>)}
                      </ul>
                    )}
                  </div>
                  <span className="activity-resource-type">{entry.resourceType}</span>
                </article>
              )
            })}
          </div>
          {error && <p className="inline-error" role="alert">{error}</p>}
          {nextCursor && <Button className="activity-load-more" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>}
        </>
      )}
    </section>
  )
}
