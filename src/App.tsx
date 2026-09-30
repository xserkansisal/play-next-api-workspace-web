import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'

import { Button } from '@/components/ui/button'
import { HistoryView } from '@/components/HistoryView'
import { ImportDialog } from '@/components/ImportDialog'
import { ResourceEditor } from '@/components/ResourceEditor'
import { WorkspaceTree } from '@/components/WorkspaceTree'
import { describeApiError, workspaceApi, type ProxySettings } from '@/lib/api'
import { authApi } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'
import { appendHistoryEntry, loadHistory, clearHistory } from '@/lib/history'
import type { HistoryEntry } from '@/lib/history'
import { exportCollectionToPostman } from '@/lib/postman-export'
import { exportEnvironmentToPostman } from '@/lib/postman-environment'
import { buildVariableMap, prepareRequest } from '@/lib/request-preparation'
import { defaultRunnerId, runnerFor, type RunnerId } from '@/lib/request-runner'
import type { RecordedResponse } from '@/lib/request-runner'
import { clearRuntimeVariables, getRuntimeVariables, removeRuntimeVariable, subscribeRuntimeVariables } from '@/lib/runtime-variables'
import { describeMissingVariables, diagnoseMissingVariables } from '@/lib/variable-diagnostics'
import { applyChangeEvent, isDraftDirty, parseChangeEvent, resourceKey } from '@/lib/workspace-types'
import type {
  ChangeEvent,
  CollectionResource,
  CreateItemInput,
  EnvironmentResource,
  EnvironmentVariable,
  OpenResource,
  RequestResource,
  ResourceDraft,
  RestoreCheck,
  RestoreConflict,
  TrashEntry,
  TreeNodeInput,
  WorkspaceItem,
} from '@/lib/workspace-types'
import { findItem, locateOpenResource, newRequest, replaceItemInTree, sortByName } from '@/lib/workspace-ui'

type View = 'workspace' | 'environments' | 'trash' | 'history'

interface RemoteUpdate {
  event: ChangeEvent | null
  latest?: ResourceDraft
  loading?: boolean
  error?: string
}

interface RestoreState {
  entry: TrashEntry
  check?: RestoreCheck
  conflicts: RestoreConflict[]
  nameOverrides: Record<string, string>
  collectionName: string
  collectionNameConflict?: boolean
  loading: boolean
  error?: string
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getResourceDraft(
  selected: OpenResource,
  collections: CollectionResource[],
  environments: EnvironmentResource[],
): ResourceDraft | null {
  const located = locateOpenResource(selected, collections, environments)
  if (!located) return null
  if (located.kind === 'environment') return { kind: 'environment', resource: jsonCopy(located.resource) }
  if (located.kind === 'collection') return { kind: 'collection', resource: jsonCopy(located.resource) }
  if (located.kind === 'folder') return { kind: 'folder', collectionId: located.collectionId, resource: jsonCopy(located.resource) }
  return { kind: 'request', collectionId: located.collectionId, resource: jsonCopy(located.resource) }
}

function getCreationParentId(selected: OpenResource | null, collections: CollectionResource[]): string | undefined {
  if (selected?.kind === 'folder') return selected.itemId
  if (selected?.kind === 'request') {
    const collection = collections.find(({ id }) => id === selected.collectionId)
    return collection ? findItem(collection, selected.itemId)?.parentId ?? undefined : undefined
  }
  return undefined
}

function draftKey(draft: ResourceDraft): string {
  return resourceKey(draft.kind === 'collection'
    ? { kind: 'collection', collectionId: draft.resource.id }
    : draft.kind === 'environment'
      ? { kind: 'environment', environmentId: draft.resource.id }
      : { kind: draft.kind, collectionId: draft.collectionId, itemId: draft.resource.id })
}

function mapRestoreConflicts(check: RestoreCheck): RestoreConflict[] {
  return check.conflicts
}

function restoredName(name: string): string {
  const suffix = ' (restored)'
  return `${name.slice(0, 200 - suffix.length)}${suffix}`
}

interface AppProps {
  user?: AuthUser
  onSignOut?: () => void
}

function App({ user, onSignOut }: AppProps = {}) {
  const [collections, setCollections] = useState<CollectionResource[]>([])
  const [environments, setEnvironments] = useState<EnvironmentResource[]>([])
  const [trash, setTrash] = useState<TrashEntry[]>([])
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('')
  const [runnerId, setRunnerId] = useState<RunnerId>(defaultRunnerId)
  const [proxy, setProxy] = useState<ProxySettings | null>(null)
  const runtimeVariables = useSyncExternalStore(subscribeRuntimeVariables, getRuntimeVariables, getRuntimeVariables)
  const [view, setView] = useState<View>('workspace')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selected, setSelected] = useState<OpenResource | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ResourceDraft>>({})
  const [baselines, setBaselines] = useState<Record<string, ResourceDraft>>({})
  const [requestTabs, setRequestTabs] = useState<OpenResource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resourceError, setResourceError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)
  const [remoteUpdate, setRemoteUpdate] = useState<RemoteUpdate | null>(null)
  const [restoreState, setRestoreState] = useState<RestoreState | null>(null)
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [responses, setResponses] = useState<Record<string, RecordedResponse>>({})
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [importOpen, setImportOpen] = useState(false)
  const selectedRef = useRef(selected)
  const draftsRef = useRef(drafts)
  const baselinesRef = useRef(baselines)
  const lastEventId = useRef('')
  selectedRef.current = selected
  draftsRef.current = drafts
  baselinesRef.current = baselines

  const reloadAll = useCallback(async () => {
    setLoadingError(null)
    try {
      const [collectionSummaries, nextEnvironments, nextTrash] = await Promise.all([
        workspaceApi.collections(),
        workspaceApi.environments(),
        workspaceApi.trash(),
      ])
      // The list endpoint returns bare collection metadata only; the nested
      // item tree is only included on the single-collection detail response.
      const nextCollections = await Promise.all(
        collectionSummaries.map(({ id }) => workspaceApi.collection(id)),
      )
      setCollections(sortByName(nextCollections))
      setEnvironments(sortByName(nextEnvironments))
      setTrash(nextTrash)
      setSelectedEnvironmentId((current) => current && nextEnvironments.some(({ id }) => id === current)
        ? current
        : nextEnvironments[0]?.id ?? '')
    } catch (error) {
      setLoadingError(describeApiError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  // Asked once, so the runner selector can say whether sending from the server is even available
  // instead of offering an option that always fails. A failure here is not surfaced: it only means
  // the option stays unavailable, and the workspace itself is unaffected.
  useEffect(() => {
    let cancelled = false
    void workspaceApi.proxySettings()
      .then((settings) => { if (!cancelled) setProxy(settings) })
      .catch(() => { if (!cancelled) setProxy({ enabled: false, allowedHosts: [] }) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const resumeFrom = lastEventId.current
    // EventSource can't set the Authorization header or any custom header,
    // which is exactly why auth uses a cookie - but the cookie is only sent
    // automatically for same-origin requests, so cross-origin dev use (Vite
    // on :5173 hitting the API on :3000) needs withCredentials explicitly.
    const source = new EventSource(`${apiBase}/api/v1/events${resumeFrom ? `?lastEventId=${encodeURIComponent(resumeFrom)}` : ''}`, { withCredentials: true })
    let closed = false
    source.onopen = () => {
      setConnected(true)
      setSyncNotice(null)
    }
    const onChange = (message: MessageEvent<string>) => {
      const event = parseChangeEvent(message.type, message.data, message.lastEventId || undefined)
      if (event === 'resync') {
        lastEventId.current = ''
        setSyncNotice('Live event history expired. Workspace lists were refreshed; review open resources before replacing any local version.')
        setRemoteUpdate({
          event: null,
          error: 'The live event history could not be resumed. Workspace lists were refreshed; review this open resource before replacing it.',
        })
        void reloadAll()
        return
      }
      if (!event) return
      lastEventId.current = event.eventId
      if (applyChangeEvent(event, selectedRef.current) === 'review') {
        const active = selectedRef.current
        const currentKey = active ? resourceKey(active) : ''
        const currentDraft = draftsRef.current[currentKey]
        const baseline = baselinesRef.current[currentKey]
        setRemoteUpdate({
          event,
          error: currentDraft && baseline && isDraftDirty(currentDraft, baseline)
            ? 'You have unsaved edits. They are preserved; compare before choosing either version.'
            : undefined,
        })
      } else {
        void reloadAll()
      }
    }
    source.onmessage = onChange
    // The API only ever emits `change` and `resync` as named SSE events (plus
    // `ready`, which parseChangeEvent ignores); it does not emit per-kind
    // event names.
    source.addEventListener('change', onChange as EventListener)
    source.addEventListener('resync', onChange as EventListener)
    source.onerror = () => {
      if (closed) return
      setConnected(false)
      source.close()
      // EventSource never exposes the HTTP status of a failed connection,
      // so a 401 (session expired/revoked) and a genuine network/server
      // outage look identical from here. Per spec EventSource does not
      // retry after a non-2xx response, so there's no tight-loop risk
      // either way; this probe just tells the two cases apart. A 401 here
      // routes through the shared authApi client, so the response
      // interceptor in lib/auth.ts fires the "unauthenticated" event and
      // AuthGate shows its session-expired overlay; any other outcome
      // leaves the existing "disconnected, click Reconnect" banner as-is.
      void authApi.me().catch(() => {})
    }
    return () => {
      closed = true
      source.close()
    }
  }, [reconnectKey, reloadAll])

  const currentKey = selected ? resourceKey(selected) : ''
  const activeDraft = currentKey ? drafts[currentKey] : undefined
  const activeBaseline = currentKey ? baselines[currentKey] : undefined
  const dirty = !!activeDraft && (activeDraft.kind === 'request' && activeDraft.isNew
    ? true
    : !activeBaseline || isDraftDirty(activeDraft, activeBaseline))
  const activeSending = currentKey ? sending[currentKey] ?? false : false
  const activeResponse = currentKey ? responses[currentKey] ?? null : null
  const activeSendError = currentKey ? sendErrors[currentKey] ?? null : null
  const activeCollectionId = selected && selected.kind !== 'environment' ? selected.collectionId : null
  // Export follows the current selection: an environment when one is open, otherwise the
  // collection the selection belongs to.
  const exportTarget = useMemo(() => {
    if (selected?.kind === 'environment') {
      const environment = environments.find(({ id }) => id === selected.environmentId)
      if (!environment) return null
      return { title: `Export "${environment.name}" as a Postman environment file`, run: () => exportEnvironment(environment.id) }
    }
    if (!activeCollectionId) return null
    const collection = collections.find(({ id }) => id === activeCollectionId)
    if (!collection) return null
    return { title: `Export "${collection.name}" as a Postman v2.1 collection file`, run: () => exportCollection(collection.id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, environments, collections, activeCollectionId])

  function openResource(resource: OpenResource) {
    const key = resourceKey(resource)
    if (!draftsRef.current[key]) {
      const draft = getResourceDraft(resource, collections, environments)
      if (!draft) return
      setDrafts((current) => ({ ...current, [key]: draft }))
      setBaselines((current) => ({ ...current, [key]: jsonCopy(draft) }))
    }
    setSelected(resource)
    setResourceError(null)
    setView(resource.kind === 'environment' ? 'environments' : 'workspace')
    if (resource.kind === 'environment') setSelectedEnvironmentId(resource.environmentId)
    if (resource.kind === 'request' && !requestTabs.some((tab) => resourceKey(tab) === key)) {
      setRequestTabs((tabs) => [...tabs, resource])
    }
  }

  function updateDraft(next: ResourceDraft) {
    const key = draftKey(next)
    setDrafts((current) => ({ ...current, [key]: next }))
    setResourceError(null)
  }

  async function sendActiveRequest() {
    if (!activeDraft || activeDraft.kind !== 'request') return
    const key = draftKey(activeDraft)
    const resource = activeDraft.resource
    const environment = environments.find(({ id }) => id === selectedEnvironmentId)
    // Runtime variables win over environment variables of the same name: a
    // value just captured from a response is more current than a placeholder
    // saved in the shared environment.
    const variables = { ...buildVariableMap(environment?.variables ?? []), ...runtimeVariables }
    const outcome = prepareRequest(resource, variables)

    if (!outcome.ok) {
      const message = outcome.reason === 'missing-variables'
        ? describeMissingVariables(diagnoseMissingVariables(outcome.missing, environments, selectedEnvironmentId))
        : outcome.reason === 'invalid-json'
          ? `Body is not valid JSON at line ${outcome.error.line}, column ${outcome.error.column}: ${outcome.error.message}. Request was not sent.`
          : `${outcome.message} Request was not sent.`
      setSendErrors((current) => ({ ...current, [key]: message }))
      return
    }

    setSendErrors((current) => omitKeys(current, [key]))
    setSending((current) => ({ ...current, [key]: true }))
    const result = await runnerFor(runnerId).run(outcome.request)
    setSending((current) => ({ ...current, [key]: false }))
    const sentAt = new Date().toISOString()
    setResponses((current) => ({ ...current, [key]: { result, sentAt } }))
    setHistory(appendHistoryEntry({
      sentAt,
      method: outcome.request.method,
      url: outcome.request.url,
      requestName: resource.name || undefined,
      requestBody: outcome.request.body,
      status: result.kind === 'success' ? result.status : undefined,
      statusText: result.kind === 'success' ? result.statusText : undefined,
      durationMs: result.durationMs,
      sizeBytes: result.kind === 'success' ? result.sizeBytes : undefined,
      failure: result.kind === 'failure' ? result.message : undefined,
      responseBody: result.kind === 'success' ? result.bodyText : undefined,
    }))
  }

  function setLocalCollection(collection: CollectionResource) {
    setCollections((current) => current.map((entry) => entry.id === collection.id ? collection : entry))
  }

  async function saveDraft() {
    if (!activeDraft || !dirty) return
    setSaving(true)
    setResourceError(null)
    try {
      let saved: ResourceDraft
      if (activeDraft.kind === 'collection') {
        const resource = await workspaceApi.saveCollection(activeDraft.resource)
        const next = { ...activeDraft, resource: { ...activeDraft.resource, ...resource, items: activeDraft.resource.items } }
        setLocalCollection(next.resource)
        saved = next
      } else if (activeDraft.kind === 'folder') {
        const resource = await workspaceApi.saveFolder(activeDraft.collectionId, activeDraft.resource)
        if (resource.type !== 'folder') throw new Error('The API returned a non-folder resource while saving a folder.')
        const collection = collections.find(({ id }) => id === activeDraft.collectionId)
        if (collection) setLocalCollection({ ...collection, items: replaceItemInTree(collection.items, resource) })
        saved = { ...activeDraft, resource }
      } else if (activeDraft.kind === 'request') {
        let resource: RequestResource
        if (activeDraft.isNew) {
          const input: CreateItemInput = {
            type: 'request',
            name: activeDraft.resource.name,
            description: activeDraft.resource.description,
            ...(activeDraft.parentId ? { parentId: activeDraft.parentId } : {}),
            method: activeDraft.resource.method,
            url: activeDraft.resource.url,
            queryParams: activeDraft.resource.queryParams,
            headers: activeDraft.resource.headers,
            body: activeDraft.resource.body,
            auth: activeDraft.resource.auth,
          }
          const created = await workspaceApi.createItem(activeDraft.collectionId, input)
          if (created.type !== 'request') throw new Error('The API returned a non-request resource while creating a request.')
          resource = created
        } else {
          resource = await workspaceApi.saveRequest(activeDraft.collectionId, activeDraft.resource)
        }
        const collection = collections.find(({ id }) => id === activeDraft.collectionId)
        if (collection) {
          const treeItems = activeDraft.isNew
            ? activeDraft.parentId
              ? addToFolder(collection.items, activeDraft.parentId, resource)
              : [...collection.items, resource]
            : replaceItemInTree(collection.items, resource)
          setLocalCollection({ ...collection, items: treeItems })
        }
        saved = { kind: 'request', collectionId: activeDraft.collectionId, resource }
        if (activeDraft.isNew) {
          const oldKey = draftKey(activeDraft)
          const nextResource: OpenResource = { kind: 'request', collectionId: activeDraft.collectionId, itemId: resource.id }
          const nextKey = resourceKey(nextResource)
          setDrafts((current) => {
            const next = { ...current, [nextKey]: saved }
            delete next[oldKey]
            return next
          })
          setBaselines((current) => {
            const next = { ...current, [nextKey]: jsonCopy(saved) }
            delete next[oldKey]
            return next
          })
          setRequestTabs((tabs) => tabs.map((tab) => resourceKey(tab) === oldKey ? nextResource : tab))
          setSelected(nextResource)
        }
      } else {
        const resource = await workspaceApi.saveEnvironment(activeDraft.resource)
        setEnvironments((current) => sortByName(current.map((entry) => entry.id === resource.id ? resource : entry)))
        saved = { kind: 'environment', resource }
      }
      const savedKey = draftKey(saved)
      setDrafts((current) => ({ ...current, [savedKey]: saved }))
      setBaselines((current) => ({ ...current, [savedKey]: jsonCopy(saved) }))
    } catch (error) {
      setResourceError(describeApiError(error))
    } finally {
      setSaving(false)
    }
  }

  async function createCollection() {
    const name = window.prompt('Collection name')
    if (!name?.trim()) return
    try {
      const resource = await workspaceApi.createCollection({ name: name.trim(), description: '' })
      setCollections((current) => sortByName([...current, resource]))
      const draft: ResourceDraft = { kind: 'collection', resource }
      const key = draftKey(draft)
      setDrafts((current) => ({ ...current, [key]: draft }))
      setBaselines((current) => ({ ...current, [key]: jsonCopy(draft) }))
      setSelected({ kind: 'collection', collectionId: resource.id })
      setView('workspace')
    } catch (error) {
      setLoadingError(describeApiError(error))
    }
  }

  // Imports build the whole tree as one atomic POST /collections request (added in Slice 1 for
  // exactly this): either the entire import succeeds, or nothing is written server-side.
  async function importCollection(payload: {
    name: string
    description: string
    items: TreeNodeInput[]
    environment?: { name: string; variables: EnvironmentVariable[] }
  }): Promise<string | void> {
    const { environment, ...collectionPayload } = payload
    let resource: CollectionResource
    try {
      resource = await workspaceApi.createCollection(collectionPayload)
    } catch (error) {
      return describeApiError(error)
    }
    setCollections((current) => sortByName([...current, resource]))

    // The environment is a second, separate request: there is no server-side endpoint that
    // creates a collection and an environment in one transaction. The collection is already
    // saved at this point, so a failure here is reported without discarding it.
    if (environment) {
      try {
        const created = await workspaceApi.createEnvironment(environment)
        setEnvironments((current) => sortByName([...current, created]))
      } catch (error) {
        setImportOpen(false)
        setSelected({ kind: 'collection', collectionId: resource.id })
        setView('workspace')
        setLoadingError(`The collection "${resource.name}" was imported, but its environment could not be created: ${describeApiError(error)}`)
        return
      }
    }

    setImportOpen(false)
    setSelected({ kind: 'collection', collectionId: resource.id })
    setView('workspace')
  }

  async function importEnvironment(payload: { name: string; variables: EnvironmentVariable[] }): Promise<string | void> {
    try {
      const resource = await workspaceApi.createEnvironment(payload)
      setEnvironments((current) => sortByName([...current, resource]))
      setImportOpen(false)
      setSelected({ kind: 'environment', environmentId: resource.id })
      setView('environments')
    } catch (error) {
      return describeApiError(error)
    }
  }

  function downloadJson(content: unknown, fileName: string) {
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  function safeFileName(name: string, fallback: string) {
    return name.replace(/[/\\?%*:|"<>]/g, '_') || fallback
  }

  function exportCollection(collectionId: string) {
    const collection = collections.find(({ id }) => id === collectionId)
    if (!collection) return
    downloadJson(exportCollectionToPostman(collection), `${safeFileName(collection.name, 'collection')}.postman_collection.json`)
  }

  function exportEnvironment(environmentId: string) {
    const environment = environments.find(({ id }) => id === environmentId)
    if (!environment) return
    downloadJson(exportEnvironmentToPostman(environment), `${safeFileName(environment.name, 'environment')}.postman_environment.json`)
  }

  async function createFolder() {
    const collectionId = selected && selected.kind !== 'environment' ? selected.collectionId : collections[0]?.id
    if (!collectionId) {
      setLoadingError('Create a collection before adding a folder.')
      return
    }
    const parentId = getCreationParentId(selected, collections)
    const name = window.prompt('Folder name')
    if (!name?.trim()) return
    try {
      const item = await workspaceApi.createItem(collectionId, { type: 'folder', name: name.trim(), description: '', ...(parentId ? { parentId } : {}) })
      if (item.type !== 'folder') throw new Error('The API returned a non-folder resource while creating a folder.')
      setCollections((current) => current.map((collection) => collection.id === collectionId
        ? { ...collection, items: parentId ? addToFolder(collection.items, parentId, item) : [...collection.items, item] }
        : collection))
      const draft: ResourceDraft = { kind: 'folder', collectionId, resource: item }
      const key = draftKey(draft)
      setDrafts((current) => ({ ...current, [key]: draft }))
      setBaselines((current) => ({ ...current, [key]: jsonCopy(draft) }))
      setSelected({ kind: 'folder', collectionId, itemId: item.id })
      setView('workspace')
    } catch (error) {
      setLoadingError(describeApiError(error))
    }
  }

  function createRequest() {
    const collectionId = selected && selected.kind !== 'environment' ? selected.collectionId : collections[0]?.id
    if (!collectionId) {
      setLoadingError('Create a collection before adding a request.')
      return
    }
    const parentId = getCreationParentId(selected, collections)
    const id = `draft-${crypto.randomUUID()}`
    const resource = newRequest(id, 'New request', collectionId, parentId ?? null)
    const draft: ResourceDraft = { kind: 'request', collectionId, ...(parentId ? { parentId } : {}), resource, isNew: true }
    const key = draftKey(draft)
    setDrafts((current) => ({ ...current, [key]: draft }))
    const open: OpenResource = { kind: 'request', collectionId, itemId: id }
    setSelected(open)
    setView('workspace')
    setRequestTabs((tabs) => [...tabs, open])
    setResourceError(null)
  }

  async function createEnvironment() {
    const name = window.prompt('Environment name')
    if (!name?.trim()) return
    try {
      const resource = await workspaceApi.createEnvironment({ name: name.trim(), variables: [] })
      setEnvironments((current) => sortByName([...current, resource]))
      setSelectedEnvironmentId(resource.id)
      const draft: ResourceDraft = { kind: 'environment', resource }
      const key = draftKey(draft)
      setDrafts((current) => ({ ...current, [key]: draft }))
      setBaselines((current) => ({ ...current, [key]: jsonCopy(draft) }))
      setSelected({ kind: 'environment', environmentId: resource.id })
      setView('environments')
    } catch (error) {
      setLoadingError(describeApiError(error))
    }
  }

  async function deleteResource(resource: OpenResource) {
    const name = resource.kind === 'environment'
      ? environments.find(({ id }) => id === resource.environmentId)?.name
      : resource.kind === 'collection'
        ? collections.find(({ id }) => id === resource.collectionId)?.name
        : collections.map((collection) => findItem(collection, resource.itemId)?.name).find(Boolean)
    if (!window.confirm(`Move “${name ?? 'this item'}” to Trash?`)) return
    const removedIds = resource.kind === 'collection'
      ? collections.find(({ id }) => id === resource.collectionId)?.items.flatMap(collectItemIds) ?? []
      : resource.kind === 'environment'
        ? []
        : (() => {
            const collection = collections.find(({ id }) => id === resource.collectionId)
            const item = collection ? findItem(collection, resource.itemId) : undefined
            return item ? collectItemIds(item) : [resource.itemId]
          })()
    try {
      if (resource.kind === 'collection') {
        await workspaceApi.deleteCollection(resource.collectionId)
        setCollections((current) => current.filter(({ id }) => id !== resource.collectionId))
      } else if (resource.kind === 'environment') {
        await workspaceApi.deleteEnvironment(resource.environmentId)
        setEnvironments((current) => current.filter(({ id }) => id !== resource.environmentId))
        if (selectedEnvironmentId === resource.environmentId) setSelectedEnvironmentId('')
      } else {
        await workspaceApi.deleteItem(resource.collectionId, resource.itemId)
        setCollections((current) => current.map((collection) => collection.id === resource.collectionId
          ? { ...collection, items: removeFromTree(collection.items, resource.itemId) }
          : collection))
      }
      const deletedResource = (candidate: OpenResource) => {
        if (resource.kind === 'collection') return candidate.kind !== 'environment' && candidate.collectionId === resource.collectionId
        if (resource.kind === 'environment') return candidate.kind === 'environment' && candidate.environmentId === resource.environmentId
        return candidate.kind !== 'collection' && candidate.kind !== 'environment' &&
          candidate.collectionId === resource.collectionId && removedIds.includes(candidate.itemId)
      }
      if (selected && deletedResource(selected)) {
        setSelected(null)
        setRemoteUpdate(null)
      }
      setRequestTabs((tabs) => tabs.filter((tab) => !deletedResource(tab)))
      const removedKeys = Object.keys(draftsRef.current).filter((key) => {
        if (resource.kind === 'environment') return key === resourceKey(resource)
        if (resource.kind === 'collection') return key.endsWith(`:${resource.collectionId}`) || key.includes(`:${resource.collectionId}:`)
        return removedIds.some((id) => key.endsWith(`:${id}`))
      })
      setDrafts((current) => omitKeys(current, removedKeys))
      setBaselines((current) => omitKeys(current, removedKeys))
      await reloadTrash()
    } catch (error) {
      setResourceError(describeApiError(error))
      setLoadingError(describeApiError(error))
    }
  }

  async function reloadTrash() {
    try {
      setTrash(await workspaceApi.trash())
    } catch (error) {
      setLoadingError(describeApiError(error))
    }
  }

  async function beginRestore(
    entry: TrashEntry,
    nameOverrides: Record<string, string> = {},
    collectionName = entry.name,
  ) {
    setRestoreState((current) => current?.entry.id === entry.id
      ? { ...current, loading: true, error: undefined }
      : { entry, conflicts: [], nameOverrides: {}, collectionName: entry.name, loading: true })
    try {
      const checkInput = {
        ...(entry.kind === 'collection' ? { collectionName } : {}),
        nameOverrides,
      }
      const check = await workspaceApi.checkRestore(entry.id, checkInput)
      const conflicts = mapRestoreConflicts(check)
      const collectionNameConflict = entry.kind === 'collection' &&
        conflicts.some((item) => item.id === entry.id || item.kind === 'collection')
      const childConflicts = conflicts.filter((item) => !(entry.kind === 'collection' && (item.id === entry.id || item.kind === 'collection')))
      const nextOverrides = { ...nameOverrides }
      childConflicts.forEach((item) => {
        if (!nextOverrides[item.id]) nextOverrides[item.id] = restoredName(item.name)
      })
      setRestoreState({
        entry,
        check,
        conflicts: childConflicts,
        nameOverrides: nextOverrides,
        collectionName: collectionNameConflict && collectionName === entry.name ? restoredName(entry.name) : collectionName,
        collectionNameConflict,
        loading: false,
      })
    } catch (error) {
      setRestoreState((current) => current ? { ...current, loading: false, error: describeApiError(error) } : current)
    }
  }

  async function confirmRestore() {
    if (!restoreState) return
    setRestoreState((current) => current ? { ...current, loading: true, error: undefined } : current)
    try {
      const input = {
        ...(restoreState.entry.kind === 'collection' && restoreState.collectionName.trim()
          ? { collectionName: restoreState.collectionName.trim() }
          : {}),
        nameOverrides: restoreState.nameOverrides,
      }
      await workspaceApi.restore(restoreState.entry.id, input)
      setRestoreState(null)
      await reloadAll()
    } catch (error) {
      setRestoreState((current) => current ? { ...current, loading: false, error: describeApiError(error) } : current)
    }
  }

  async function reviewLatest() {
    if (!remoteUpdate || !selected) return
    setRemoteUpdate((current) => current ? { ...current, loading: true, error: undefined } : current)
    try {
      let latest: ResourceDraft | null = null
      if (selected.kind === 'collection') {
        latest = { kind: 'collection', resource: await workspaceApi.collection(selected.collectionId) }
      } else if (selected.kind === 'environment') {
        latest = { kind: 'environment', resource: await workspaceApi.environment(selected.environmentId) }
      } else if (selected.kind === 'request') {
        const resource = await workspaceApi.item(selected.collectionId, selected.itemId)
        if (resource.type === 'request') latest = { kind: 'request', collectionId: selected.collectionId, resource }
      } else {
        const resource = await workspaceApi.item(selected.collectionId, selected.itemId)
        if (resource.type === 'folder') latest = { kind: 'folder', collectionId: selected.collectionId, resource }
      }
      if (!latest) throw new Error('The resource is no longer available. Refresh the workspace to see the latest state.')
      setRemoteUpdate((current) => current ? { ...current, latest, loading: false } : current)
    } catch (error) {
      setRemoteUpdate((current) => current ? { ...current, loading: false, error: describeApiError(error) } : current)
    }
  }

  function useLatest() {
    if (!remoteUpdate?.latest || !selected) return
    const latest = remoteUpdate.latest
    const key = resourceKey(selected)
    setDrafts((current) => ({ ...current, [key]: latest }))
    setBaselines((current) => ({ ...current, [key]: jsonCopy(latest) }))
    if (latest.kind === 'collection') {
      setCollections((current) => current.map((entry) => entry.id === latest.resource.id ? latest.resource : entry))
    } else if (latest.kind === 'environment') {
      setEnvironments((current) => current.map((entry) => entry.id === latest.resource.id ? latest.resource : entry))
    } else {
      setCollections((current) => current.map((collection) => collection.id === latest.collectionId
        ? { ...collection, items: replaceItemInTree(collection.items, latest.resource) }
        : collection))
    }
    setRemoteUpdate(null)
  }

  const selectedTrashConflicts = useMemo(() => restoreState?.conflicts ?? [], [restoreState])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>☰</button>
          <span className="brand-mark">↗</span>
          <span>Play Next API Workspace</span>
          <span className="workspace-label">Engineering</span>
        </div>
        <div className="top-actions">
          <label className="env-picker">
            <span className="env-dot" />
            <select aria-label="Environment" value={selectedEnvironmentId} onChange={(event) => setSelectedEnvironmentId(event.target.value)}>
              <option value="">No environment</option>
              {sortByName(environments).map((environment) => <option value={environment.id} key={environment.id}>{environment.name}</option>)}
            </select>
          </label>
          <RuntimeVariablesMenu variables={runtimeVariables} />
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>Import</Button>
          <Button variant="outline" size="sm" disabled={!exportTarget} title={exportTarget?.title ?? 'Select a collection or environment to export'} onClick={() => exportTarget?.run()}>Export</Button>
          <div className="account-menu">
            {user && <span className="account-email" title={user.email}>{user.email}</span>}
            <Button variant="outline" size="sm" onClick={() => onSignOut?.()}>Sign out</Button>
          </div>
        </div>
      </header>
      {!connected && (
        <div className="connection-notice" role="status">
          <span>Live updates disconnected. Your workspace data is still available.</span>
          <button onClick={() => setReconnectKey((value) => value + 1)}>Reconnect</button>
        </div>
      )}
      {syncNotice && <div className="connection-notice" role="status"><span>{syncNotice}</span><button onClick={() => setSyncNotice(null)}>Dismiss</button></div>}
      {loadingError && <div className="global-error" role="alert">{loadingError}<button aria-label="Dismiss error" onClick={() => setLoadingError(null)}>×</button></div>}
      <div className="main-layout">
        <WorkspaceTree
          collections={collections}
          selected={selected}
          onSelect={openResource}
          onCreateCollection={() => void createCollection()}
          onCreateFolder={() => void createFolder()}
          onCreateRequest={createRequest}
          onDelete={(resource) => void deleteResource(resource)}
          onShowEnvironments={() => setView('environments')}
          onShowTrash={() => { setView('trash'); void reloadTrash() }}
          onShowHistory={() => setView('history')}
          collapsed={sidebarCollapsed}
        />
        <div className="main-content">
          {view === 'trash' ? (
            <TrashView entries={trash} onRestore={(entry) => void beginRestore(entry)} />
          ) : view === 'history' ? (
            <HistoryView entries={history} onClear={() => { clearHistory(); setHistory([]) }} />
          ) : view === 'environments' && selected?.kind !== 'environment' ? (
            <div className="empty-workspace environment-welcome">
              <span className="response-symbol">◉</span>
              <h1>Environments</h1>
              <p>Create shared variables for request URLs, such as <code>baseUrl</code> and <code>port</code>.</p>
              <Button onClick={() => void createEnvironment()}>Create environment</Button>
              {environments.length > 0 && <div className="environment-shortcuts">{sortByName(environments).map((entry) => <button key={entry.id} onClick={() => openResource({ kind: 'environment', environmentId: entry.id })}>{entry.name}</button>)}</div>}
            </div>
          ) : view === 'workspace' && activeDraft || view === 'environments' && activeDraft?.kind === 'environment' ? (
            <>
              {requestTabs.length > 0 && view === 'workspace' && (
                <div className="request-tabs">
                  {requestTabs.map((tab) => {
                    const d = drafts[resourceKey(tab)]
                    const title = d?.kind === 'request' ? d.resource.name || 'New request' : 'Request'
                    return (
                      <div className={`request-tab ${selected && resourceKey(selected) === resourceKey(tab) ? 'active' : ''}`} key={resourceKey(tab)}>
                        <button className="tab-activate" onClick={() => openResource(tab)}><span className="method-mini">{d?.kind === 'request' ? d.resource.method : 'GET'}</span>{title}{d && baselines[resourceKey(tab)] && isDraftDirty(d, baselines[resourceKey(tab)]) && <span className="tab-dirty">●</span>}</button>
                        <button className="tab-close" aria-label={`Close ${title}`} onClick={() => closeTab(tab, requestTabs, drafts, baselines, setRequestTabs, setSelected, setDrafts, setBaselines)}>×</button>
                      </div>
                    )
                  })}
                  <button className="tab-add" title="New request" aria-label="New request" onClick={createRequest}>＋</button>
                </div>
              )}
              <div className="editor-workarea">
                {remoteUpdate && (
                  <div className="update-notice" role="status">
                    <span>↻</span>
                    <span className="notice-copy"><strong>A newer version is available.</strong> {remoteUpdate.error ?? 'Your current editor has not been replaced.'}</span>
                    <Button variant="outline" size="sm" disabled={remoteUpdate.loading} onClick={() => remoteUpdate.latest ? setRemoteUpdate((current) => current ? { ...current, latest: undefined } : current) : void reviewLatest()}>
                      {remoteUpdate.loading ? 'Loading…' : remoteUpdate.latest ? 'Review again' : 'Review latest'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setRemoteUpdate(null)}>Keep working</Button>
                  </div>
                )}
                {remoteUpdate?.latest && (
                  <div className="compare-panel" role="dialog" aria-label="Compare server version">
                    <div className="compare-heading"><strong>Review server version</strong><button aria-label="Close comparison" onClick={() => setRemoteUpdate(null)}>×</button></div>
                    <p>Your local draft remains unchanged until you choose a version.</p>
                    <div className="compare-columns">
                      <div><h3>Your local draft</h3><pre>{JSON.stringify(activeDraft, null, 2)}</pre></div>
                      <div><h3>Latest on server</h3><pre>{JSON.stringify(remoteUpdate.latest, null, 2)}</pre></div>
                    </div>
                    <div className="compare-actions">
                      <Button variant="outline" onClick={() => setRemoteUpdate(null)}>Keep my draft</Button>
                      <Button onClick={useLatest}>Replace local draft with server version</Button>
                    </div>
                  </div>
                )}
                <ResourceEditor
                  draft={activeDraft}
                  collectionName={activeDraft.kind !== 'collection' && activeDraft.kind !== 'environment'
                    ? collections.find(({ id }) => id === activeDraft.collectionId)?.name
                    : undefined}
                  dirty={dirty}
                  saving={saving}
                  error={resourceError}
                  onChange={updateDraft}
                  onSave={() => void saveDraft()}
                  onDelete={() => void deleteResource(selected!)}
                  onSend={() => void sendActiveRequest()}
                  sending={activeSending}
                  sendError={activeSendError}
                  response={activeResponse}
                  runnerId={runnerId}
                  onRunnerChange={setRunnerId}
                  proxy={proxy}
                />
              </div>
            </>
          ) : view === 'environments' ? (
            <div className="empty-workspace environment-welcome">
              <span className="response-symbol">◉</span>
              <h1>Environments</h1>
              <p>Create shared variables for request URLs, such as <code>baseUrl</code> and <code>port</code>.</p>
              <Button onClick={() => void createEnvironment()}>Create environment</Button>
              {environments.length > 0 && <div className="environment-shortcuts">{sortByName(environments).map((entry) => <button key={entry.id} onClick={() => openResource({ kind: 'environment', environmentId: entry.id })}>{entry.name}</button>)}</div>}
            </div>
          ) : loading ? (
            <div className="empty-workspace"><span className="loading-spinner" /><p>Loading shared workspace…</p></div>
          ) : (
            <div className="empty-workspace">
              <span className="response-symbol">↗</span>
              <h1>Choose a request to get started</h1>
              <p>Select an item from a collection, or create a new request.</p>
              <Button onClick={createRequest} disabled={collections.length === 0}>New request</Button>
              {collections.length === 0 && <Button variant="outline" onClick={() => void createCollection()}>Create a collection</Button>}
            </div>
          )}
        </div>
      </div>

      {importOpen && (
        <ImportDialog collections={collections} environments={environments} onCancel={() => setImportOpen(false)} onImport={importCollection} onImportEnvironment={importEnvironment} />
      )}

      {restoreState && (
        <div className="modal-backdrop">
          <section className="restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title">
            <header className="modal-heading"><div><h2 id="restore-title">Restore “{restoreState.entry.name}”</h2><p>Review name conflicts before restoring. No changes are made until you confirm.</p></div><button aria-label="Close" onClick={() => setRestoreState(null)}>×</button></header>
            {restoreState.loading && <p role="status">Checking restore conflicts…</p>}
            {restoreState.error && <p className="inline-error" role="alert">{restoreState.error}</p>}
            {restoreState.check && <>
              {restoreState.check.blocker && <p className="inline-error" role="alert">{restoreState.check.blocker.message}</p>}
              {restoreState.entry.kind === 'collection' && <label className="field-label">Collection name<input className="text-field" disabled={restoreState.loading} value={restoreState.collectionName} onChange={(event) => setRestoreState((current) => current ? { ...current, collectionName: event.target.value, check: current.check ? { ...current.check, canRestore: false } : undefined } : current)} /><small>{restoreState.collectionNameConflict ? 'An active collection uses this name. Choose a different name and check again to continue.' : 'You can rename the collection while restoring it.'}</small></label>}
              {selectedTrashConflicts.length > 0 ? (
                <div className="conflict-list">
                  <h3>Name conflicts</h3>
                  <p>{restoreState.entry.kind === 'environment' ? 'Choose a unique environment name, then check again.' : 'Provide a new name for each conflicting folder, then check again to restore the complete subtree.'}</p>
                  {selectedTrashConflicts.map((conflict) => (
                    <label className="field-label" key={conflict.id}>Rename {conflict.kind ?? 'item'} “{conflict.name}”{conflict.conflictingId ? ` (conflicts with ${conflict.conflictingId})` : ''}
                      <input className="text-field" disabled={restoreState.loading} value={restoreState.nameOverrides[conflict.id] ?? restoredName(conflict.name)} onChange={(event) => setRestoreState((current) => current ? { ...current, nameOverrides: { ...current.nameOverrides, [conflict.id]: event.target.value }, check: current.check ? { ...current.check, canRestore: false } : undefined } : current)} />
                    </label>
                  ))}
                </div>
              ) : <p className="no-conflicts">No folder conflicts found. Restore will recheck for conflicts before changing anything.</p>}
            </>}
            <footer className="modal-actions"><Button variant="outline" onClick={() => setRestoreState(null)}>Cancel</Button><Button variant="outline" disabled={restoreState.loading} onClick={() => void beginRestore(restoreState.entry, restoreState.nameOverrides, restoreState.collectionName)}>Check again</Button><Button onClick={() => void confirmRestore()} disabled={restoreState.loading || restoreState.check?.canRestore !== true || !restoreState.collectionName.trim() || selectedTrashConflicts.some((item) => !(restoreState.nameOverrides[item.id] ?? '').trim())}>Restore</Button></footer>
          </section>
        </div>
      )}
    </main>
  )
}

function closeTab(
  tab: OpenResource,
  tabs: OpenResource[],
  drafts: Record<string, ResourceDraft>,
  baselines: Record<string, ResourceDraft>,
  setTabs: Dispatch<SetStateAction<OpenResource[]>>,
  setSelected: Dispatch<SetStateAction<OpenResource | null>>,
  setDrafts: Dispatch<SetStateAction<Record<string, ResourceDraft>>>,
  setBaselines: Dispatch<SetStateAction<Record<string, ResourceDraft>>>,
) {
  const key = resourceKey(tab)
  const draft = drafts[key]
  const baseline = baselines[key]
  if (draft && (draft.kind === 'request' && draft.isNew || !baseline || isDraftDirty(draft, baseline))) {
    if (!window.confirm('This request has unsaved changes. Close it and discard the local draft?')) return
  }
  const remaining = tabs.filter((entry) => resourceKey(entry) !== key)
  setTabs(remaining)
  setDrafts((current) => {
    const next = { ...current }
    delete next[key]
    return next
  })
  setBaselines((current) => {
    const next = { ...current }
    delete next[key]
    return next
  })
  setSelected((current) => current && resourceKey(current) === key ? remaining[remaining.length - 1] ?? null : current)
}

function RuntimeVariablesMenu({ variables }: { variables: Readonly<Record<string, string>> }) {
  const names = Object.keys(variables).sort()
  return (
    <details className="runtime-vars">
      <summary aria-label={`Runtime variables (${names.length})`}>Variables <span className="runtime-vars-count">{names.length}</span></summary>
      <div className="runtime-vars-panel">
        {names.length === 0 ? (
          <p className="runtime-vars-empty">No runtime variables yet. Send a request, then use “Save a value as a variable” on the response to capture one.</p>
        ) : (
          <>
            <table className="runtime-vars-table">
              <tbody>
                {names.map((name) => (
                  <tr key={name}>
                    <td><code>{`{{${name}}}`}</code></td>
                    <td className="runtime-vars-value" title={variables[name]}>{variables[name]}</td>
                    <td><button className="link-button" aria-label={`Remove ${name}`} onClick={() => removeRuntimeVariable(name)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="link-button" onClick={() => clearRuntimeVariables()}>Clear all</button>
          </>
        )}
        <p className="runtime-vars-note">Captured from responses. They override environment variables of the same name, stay in this browser tab, and are never saved to the server.</p>
      </div>
    </details>
  )
}

function TrashView({ entries, onRestore }: { entries: TrashEntry[]; onRestore: (entry: TrashEntry) => void }) {
  return (
    <section className="trash-view">
      <div className="view-heading"><div><h1>Trash</h1><p>Restore deleted collections, folders, requests, and environments. Items are never permanently deleted here.</p></div></div>
      {entries.length === 0 ? <div className="empty-workspace"><span className="response-symbol">▱</span><h2>Trash is empty</h2><p>Deleted shared items will appear here.</p></div> : (
        <div className="trash-list">
          {entries.map((entry) => (
            <div className="trash-entry" key={entry.id}>
              <div><strong>{entry.name}</strong><span>{entry.kind} · {new Date(entry.deletedAt).toLocaleString()}</span></div>
              <Button variant="outline" size="sm" onClick={() => onRestore(entry)}>Restore…</Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function addToFolder(items: WorkspaceItem[], parentId: string, added: WorkspaceItem): WorkspaceItem[] {
  return items.map((item) => item.id === parentId && item.type === 'folder'
    ? { ...item, items: [...item.items, added] }
    : item.type === 'folder'
      ? { ...item, items: addToFolder(item.items, parentId, added) }
      : item)
}

function removeFromTree(items: WorkspaceItem[], id: string): WorkspaceItem[] {
  return items.filter((item) => item.id !== id).map((item) => item.type === 'folder'
    ? { ...item, items: removeFromTree(item.items, id) }
    : item)
}

function collectItemIds(item: WorkspaceItem): string[] {
  return item.type === 'folder'
    ? [item.id, ...item.items.flatMap(collectItemIds)]
    : [item.id]
}

function omitKeys<T>(values: Record<string, T>, keys: string[]): Record<string, T> {
  const omitted = new Set(keys)
  return Object.fromEntries(Object.entries(values).filter(([key]) => !omitted.has(key)))
}

export default App
