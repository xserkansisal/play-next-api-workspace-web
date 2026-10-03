import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { BulkImportDialog } from '@/components/BulkImportDialog'
import { TeamPicker } from '@/components/TeamPicker'
import { GlassBackdrop } from '@/components/GlassBackdrop'
import { ImportOptionsDialog, type ImportSource } from '@/components/ImportOptionsDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { RunConfirmDialog } from '@/components/RunConfirmDialog'
import { CompareDiff } from '@/components/CompareDiff'
import { CollectionRunHistoryDialog } from '@/components/CollectionRunHistoryDialog'
import { CollectionSnapshotsDialog } from '@/components/CollectionSnapshotsDialog'
import { EnvironmentPicker } from '@/components/EnvironmentPicker'
import { HistoryView } from '@/components/HistoryView'
import { TeamActivityView } from '@/components/TeamActivityView'
import { ImportDialog } from '@/components/ImportDialog'
import { CollectionExportDialog } from '@/components/CollectionExportDialog'
import { OpenApiCreateDialog } from '@/components/OpenApiCreateDialog'
import { OpenApiImportDialog } from '@/components/OpenApiImportDialog'
import { OpenApiSyncDialog } from '@/components/OpenApiSyncDialog'
import { ResourceEditor } from '@/components/ResourceEditor'
import { TeamMembers } from '@/components/TeamMembers'
import { UserProfileMenu } from '@/components/UserProfileMenu'
import { VersionHistoryDialog } from '@/components/VersionHistoryDialog'
import { VariablesMenu } from '@/components/VariablesMenu'
import { VariableCreationContext } from '@/components/VariableAutocomplete'
import { WorkspaceTree } from '@/components/WorkspaceTree'
import { playSound } from '@/lib/sound'
import { clampSidebarWidth, loadSidebarWidth, saveSidebarWidth } from '@/lib/sidebar-width-storage'
import { apiErrorCode, apiErrorDetails, describeApiError, workspaceApi, type BulkImportInput, type CollectionRunDetail, type ProxySettings } from '@/lib/api'
import { authApi, teamsApi } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'
import { parsePresenceSnapshot, presenceApi, presenceLocation, presenceResourceKey } from '@/lib/presence'
import type { PresenceUser } from '@/lib/presence'
import { appendHistoryEntry, loadHistory, clearHistory } from '@/lib/history'
import type { HistoryEntry } from '@/lib/history'
import { exportCollectionToPostman } from '@/lib/postman-export'
import {
  fallbackOpenApiFileName,
  type OpenApiCreateInput,
  type OpenApiExportOptions,
  type OpenApiImportInput,
  type OpenApiSyncApplyInput,
} from '@/lib/openapi'
import { exportEnvironmentToPostman } from '@/lib/postman-environment'
import { createUuid } from '@/lib/uuid'
import { buildAuthAncestry, resolveEffectiveAuth } from '@/lib/auth-resolution'
import { prepareRequest } from '@/lib/request-preparation'
import { canProxy, runnerFor, type RunnerId } from '@/lib/request-runner'
import { loadRunnerId, saveRunnerId } from '@/lib/runner-storage'
import type { RecordedResponse } from '@/lib/request-runner'
import { getScopedVariables, loadScopedVariables, saveScopedVariable, subscribeScopedVariables } from '@/lib/scoped-variables'
import { exportScopedVariables } from '@/lib/scoped-variable-export'
import { loadVariableOrder } from '@/lib/variable-order-storage'
import { notifyTeamContextError } from '@/lib/teams'
import { canEditTeam, canManageTeamMembers } from '@/lib/teams'
import type { Team } from '@/lib/teams'
import { resolveVariables, toVariableMap, validateVariableName, type VariableOrigin } from '@/lib/variable-scopes'
import { editEnvironmentVariable, removeEnvironmentVariable, type VariableEditResult } from '@/lib/variable-editing'
import { extractFromResponse } from '@/lib/response-extraction'
import { applySyncRules } from '@/lib/sync-rules'
import { describeMissingVariables, diagnoseMissingVariables } from '@/lib/variable-diagnostics'
import { applyChangeEvent, isDraftDirty, parseChangeEvent, parseReadyEpoch, resourceKey } from '@/lib/workspace-types'
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
import { applyMove, type MoveSource, type MoveTarget } from '@/lib/tree-move'
import { findItem, locateOpenResource, newRequest, replaceItemInTree, sortByName, sortTreeItems } from '@/lib/workspace-ui'

type View = 'workspace' | 'environments' | 'variables' | 'trash' | 'history' | 'activity' | 'members'

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

interface RunHistoryState {
  collectionId: string
  collectionName: string
  folderName?: string
  initialRun?: CollectionRunDetail
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

async function fetchLatestDraft(selected: OpenResource): Promise<ResourceDraft | null> {
  if (selected.kind === 'collection') {
    return { kind: 'collection', resource: await workspaceApi.collection(selected.collectionId) }
  }
  if (selected.kind === 'environment') {
    return { kind: 'environment', resource: await workspaceApi.environment(selected.environmentId) }
  }
  const resource = await workspaceApi.item(selected.collectionId, selected.itemId)
  if (selected.kind === 'request') return resource.type === 'request' ? { kind: 'request', collectionId: selected.collectionId, resource } : null
  return resource.type === 'folder' ? { kind: 'folder', collectionId: selected.collectionId, resource } : null
}

/**
 * True when the server copy is what this tab last saved or loaded. The API broadcasts a change
 * event for every write, including this tab's own saves, so without this check every Save would
 * raise a "newer version" warning about content the user just wrote. A collection's item tree is
 * left out because it changes with every child edit and is not part of the collection form.
 */
function matchesKnownServerState(known: ResourceDraft, latest: ResourceDraft): boolean {
  if (known.kind === 'collection' && latest.kind === 'collection') {
    const { items: _knownItems, ...knownRest } = known.resource
    const { items: _latestItems, ...latestRest } = latest.resource
    return !isDraftDirty(knownRest, latestRest)
  }
  return !isDraftDirty(known.resource, latest.resource)
}

/** A never-saved draft always counts as unsaved; otherwise it is unsaved when it differs from the last saved copy. */
function hasUnsavedChanges(draft: ResourceDraft, baseline: ResourceDraft | undefined): boolean {
  if ((draft.kind === 'request' || draft.kind === 'environment') && draft.isNew) return true
  return !baseline || isDraftDirty(draft, baseline)
}

type SaveOutcome = { key: string } | { error: string }

interface ClosePrompt {
  tab: OpenResource
  title: string
  saving: boolean
  error: string | null
}

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

interface RequestLocation {
  collectionId: string
  parentId?: string
}

interface RequestLocationOption extends RequestLocation {
  value: string
  label: string
}

function getRequestLocations(collections: CollectionResource[]): RequestLocationOption[] {
  const locations: RequestLocationOption[] = []
  for (const collection of collections) {
    locations.push({
      collectionId: collection.id,
      value: JSON.stringify([collection.id, null]),
      label: collection.name,
    })
    const visit = (items: WorkspaceItem[], path: string[]) => {
      for (const item of sortTreeItems(items)) {
        if (item.type !== 'folder') continue
        const folderPath = [...path, item.name]
        locations.push({
          collectionId: collection.id,
          parentId: item.id,
          value: JSON.stringify([collection.id, item.id]),
          label: `${collection.name} / ${folderPath.join(' / ')}`,
        })
        visit(item.items, folderPath)
      }
    }
    visit(collection.items, [])
  }
  return locations
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
  teams?: Team[]
  activeTeamId?: string | null
  teamAccessNotice?: string
  onTeamChange?: (teamId: string) => void
  onOpenAdmin?: () => void
  onSignOut?: () => void
  onRefreshTeams?: () => Promise<void>
}

function App({ user, teams = [], activeTeamId = null, teamAccessNotice, onTeamChange, onOpenAdmin, onSignOut, onRefreshTeams }: AppProps = {}) {
  const currentTeam = teams.find(({ id }) => id === activeTeamId)
  const canEditWorkspace = user === undefined || canEditTeam(currentTeam?.role, user.systemRole === 'admin')
  const canManageMembers = canManageTeamMembers(currentTeam?.role, user?.systemRole === 'admin')
  const editableVariableOrigins: VariableOrigin[] = canEditWorkspace
    ? ['user', 'environment', 'global']
    : ['user']
  const [collections, setCollections] = useState<CollectionResource[]>([])
  const [environments, setEnvironments] = useState<EnvironmentResource[]>([])
  const [trash, setTrash] = useState<TrashEntry[]>([])
  /** The resource whose copy is still being written, so a second click cannot start another. */
  const [cloningId, setCloningId] = useState<string | null>(null)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('')
  const [runnerId, setRunnerId] = useState<RunnerId>(loadRunnerId)
  const [proxy, setProxy] = useState<ProxySettings | null>(null)
  const scopedVariables = useSyncExternalStore(subscribeScopedVariables, getScopedVariables, getScopedVariables)
  const userId = user?.id ?? ''
  // The Variables-menu order is a per-user preference; it is not needed to work, so it loads on
  // its own instead of holding up (or failing) the workspace load.
  useEffect(() => {
    void loadVariableOrder(userId)
  }, [userId])
  const [view, setView] = useState<View>('workspace')
  const [variableScope, setVariableScope] = useState<'user' | 'environment' | 'global'>('user')
  const [variableFilter, setVariableFilter] = useState('')
  const [pendingVariableKey, setPendingVariableKey] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [mobilePanel, setMobilePanel] = useState<'sidebar' | 'editor'>('sidebar')
  const [selected, setSelected] = useState<OpenResource | null>(null)
  const lastOpenedLocation = useRef<RequestLocation | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ResourceDraft>>({})
  const [baselines, setBaselines] = useState<Record<string, ResourceDraft>>({})
  const [requestTabs, setRequestTabs] = useState<OpenResource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resourceError, setResourceError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [presenceError, setPresenceError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)
  const [remoteUpdate, setRemoteUpdate] = useState<RemoteUpdate | null>(null)
  const [restoreState, setRestoreState] = useState<RestoreState | null>(null)
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [runHistory, setRunHistory] = useState<RunHistoryState | null>(null)
  const [runPrompt, setRunPrompt] = useState<{ kind: 'collection' | 'folder'; name: string; items: WorkspaceItem[] } | null>(null)
  const [runStartingKey, setRunStartingKey] = useState<string | null>(null)
  const [runStartError, setRunStartError] = useState<string | null>(null)
  const [closePrompt, setClosePrompt] = useState<ClosePrompt | null>(null)
  const [closeTabsPrompt, setCloseTabsPrompt] = useState<{ keys: string[]; unsavedCount: number } | null>(null)
  /** The drafts awaiting confirmation before their local edits are thrown away. */
  const [discardPrompt, setDiscardPrompt] = useState<{ keys: string[] } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ tab: OpenResource; x: number; y: number } | null>(null)
  const [trashPrompt, setTrashPrompt] = useState<{ resource: OpenResource; name: string } | null>(null)
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [responses, setResponses] = useState<Record<string, RecordedResponse>>({})
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [importFlow, setImportFlow] = useState<ImportSource | 'options' | null>(null)
  const [exportCollectionId, setExportCollectionId] = useState<string | null>(null)
  const selectedRef = useRef(selected)
  const draftsRef = useRef(drafts)
  const baselinesRef = useRef(baselines)
  const lastEventId = useRef('')
  const lastEventEpoch = useRef<string | null>(null)
  const presenceClientId = useRef(createUuid())
  selectedRef.current = selected
  draftsRef.current = drafts
  baselinesRef.current = baselines

  useEffect(() => {
    if (canEditWorkspace) return
    setRestoreState(null)
    setTrashPrompt(null)
    setImportFlow(null)
    setVersionHistoryOpen(false)
    setSnapshotsOpen(false)
    if (view === 'trash' || view === 'members') setView('workspace')
  }, [canEditWorkspace, view])
  // Settles when the save in flight (if any) has finished. A change event for our own write can
  // arrive before the PUT response does, so the echo check waits for it.
  const pendingSaveRef = useRef<Promise<void>>(Promise.resolve())
  // The server copy each open resource was last saved as, written synchronously on save so the
  // echo check never races React's render that refreshes `baselinesRef`.
  const lastSavedRef = useRef<Record<string, ResourceDraft>>({})

  const reloadAll = useCallback(async () => {
    setLoadingError(null)
    try {
      const [collectionSummaries, nextEnvironments, nextTrash] = await Promise.all([
        workspaceApi.collections(),
        workspaceApi.environments(),
        canEditWorkspace ? workspaceApi.trash() : Promise.resolve([]),
        // Captured values live on the server now, so they are part of loading the workspace
        // rather than something this tab happens to be holding. A failure here is reported with
        // the rest: a request that silently loses its variables fails in a far more confusing way.
        loadScopedVariables(),
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
  }, [canEditWorkspace])

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
      .catch(() => { if (!cancelled) setProxy({ enabled: false, anyHost: false, allowedHosts: [] }) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    saveRunnerId(runnerId)
  }, [runnerId])

  useEffect(() => {
    saveSidebarWidth(sidebarWidth)
  }, [sidebarWidth])

  useEffect(() => {
    const resumeFrom = lastEventId.current
    // EventSource can't set the Authorization header or any custom header,
    // which is exactly why auth uses a cookie - but the cookie is only sent
    // automatically for same-origin requests, so cross-origin dev use (Vite
    // on :5173 hitting the API on :3000) needs withCredentials explicitly.
    const params = new URLSearchParams()
    if (activeTeamId) params.set('teamId', activeTeamId)
    if (resumeFrom) params.set('lastEventId', resumeFrom)
    const query = params.size ? `?${params.toString()}` : ''
    const source = new EventSource(`${apiBase}/api/v1/events${query}`, { withCredentials: true })
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
      // A global variable changed under us. Only that list needs refetching, and reloading the
      // whole workspace here would throw away the open resource's review state for nothing.
      if (event.kind === 'variable') {
        void loadScopedVariables()
        return
      }
      if (applyChangeEvent(event, selectedRef.current) === 'review') {
        const active = selectedRef.current!
        const activeKey = resourceKey(active)
        void (async () => {
          await pendingSaveRef.current
          let latest: ResourceDraft | null = null
          try {
            latest = await fetchLatestDraft(active)
          } catch {
            // Could not confirm; fall through and let the user review it.
          }
          if (closed || !selectedRef.current || resourceKey(selectedRef.current) !== activeKey) return
          const known = [lastSavedRef.current[activeKey], baselinesRef.current[activeKey]]
          if (latest && known.some((entry) => entry && matchesKnownServerState(entry, latest))) return
          const currentDraft = draftsRef.current[activeKey]
          const baseline = baselinesRef.current[activeKey]
          playSound('notification')
          setRemoteUpdate({
            event,
            error: currentDraft && baseline && isDraftDirty(currentDraft, baseline)
              ? 'You have unsaved edits. They are preserved; compare before choosing either version.'
              : undefined,
          })
        })()
      } else {
        void reloadAll()
      }
    }
    source.onmessage = onChange
    // Workspace updates and presence snapshots share the authenticated SSE stream;
    // the presence listener is separate so it does not enter resource-change handling.
    source.addEventListener('change', onChange as EventListener)
    source.addEventListener('resync', onChange as EventListener)
    source.addEventListener('ready', ((message: MessageEvent<string>) => {
      const epoch = parseReadyEpoch(message.data)
      if (!epoch) return
      const previousEpoch = lastEventEpoch.current
      lastEventEpoch.current = epoch
      if (previousEpoch !== null && previousEpoch !== epoch) {
        lastEventId.current = ''
        setSyncNotice('The API restarted. Workspace data was refreshed; review open resources before replacing any local version.')
        setRemoteUpdate({
          event: null,
          error: 'The API restarted and workspace data was refreshed. Review this open resource before replacing it.',
        })
        void reloadAll()
      }
    }) as EventListener)
    source.addEventListener('presence', ((message: MessageEvent<string>) => {
      const snapshot = parsePresenceSnapshot(message.data)
      if (snapshot) setPresenceUsers(snapshot.users.filter((entry) => entry.userId !== user?.id))
    }) as EventListener)
    source.onerror = () => {
      if (closed) return
      setConnected(false)
      setPresenceUsers([])
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
      if (activeTeamId) {
        void teamsApi.list()
          .then((currentTeams) => {
            if (!closed && !currentTeams.some(({ id }) => id === activeTeamId)) {
              notifyTeamContextError('TEAM_NOT_FOUND', currentTeams)
            }
          })
          .catch((error) => {
            if (!closed) setPresenceError(`Unable to verify team access: ${describeApiError(error)}`)
          })
      }
    }
    return () => {
      closed = true
      source.close()
    }
  }, [activeTeamId, reconnectKey, reloadAll, user?.id])

  const currentKey = selected ? resourceKey(selected) : ''
  const activeDraft = currentKey ? drafts[currentKey] : undefined
  const activeBaseline = currentKey ? baselines[currentKey] : undefined
  const dirty = !!activeDraft && hasUnsavedChanges(activeDraft, activeBaseline)
  const activeSending = currentKey ? sending[currentKey] ?? false : false
  const activeResponse = currentKey ? responses[currentKey] ?? null : null
  const activeSendError = currentKey ? sendErrors[currentKey] ?? null : null
  // The auth this request/folder's "Inherit" resolves to right now, computed from the in-memory
  // collection tree (the draft state, not a server round-trip) so it always reflects unsaved
  // ancestor auth edits immediately. `undefined` when the open item has no auth concept to resolve
  // (a collection, an environment, or nothing selected).
  const activeEffectiveAuth = (() => {
    if (!activeDraft || activeDraft.kind === 'environment' || activeDraft.kind === 'collection') return undefined
    const collection = collections.find(({ id }) => id === activeDraft.collectionId)
    if (!collection) return undefined
    const parentId = activeDraft.kind === 'request' ? (activeDraft.parentId ?? activeDraft.resource.parentId) : activeDraft.resource.parentId
    const ancestry = buildAuthAncestry(collection, parentId ?? null)
    const ownAuth = activeDraft.kind === 'request' ? activeDraft.resource.auth : { type: 'inherit' as const }
    return resolveEffectiveAuth(ownAuth, ancestry)
  })()
  // Only offered when the browser send failed with a *confirmed* CORS block and the API would
  // actually accept this host, so the button never appears for a failure the server cannot fix.
  // A block the app already retried from the server, unsuccessfully, is excluded for the same
  // reason: that retry is what this button does.
  const canRetryFromServer = activeResponse?.result.kind === 'failure'
    && activeResponse.result.corsBlocked === true
    && activeResponse.serverRetryFailed !== true
    && canProxy(activeResponse.url ?? '', proxy)
  const selectedEnvironment = environments.find(({ id }) => id === selectedEnvironmentId)
  const activePresenceLocation = useMemo(
    () => view === 'workspace' ? presenceLocation(selected) : null,
    [selected, view],
  )
  const activePresenceUsers = useMemo(() => {
    if (!selected || !activePresenceLocation) return []
    const key = resourceKey(selected)
    const seen = new Set<string>()
    return presenceUsers.filter((entry) => {
      if (presenceResourceKey(entry.location) !== key || seen.has(entry.userId)) return false
      seen.add(entry.userId)
      return true
    })
  }, [activePresenceLocation, presenceUsers, selected])
  const presenceByResource = useMemo(() => {
    const grouped: Record<string, PresenceUser[]> = {}
    for (const entry of presenceUsers) {
      const key = presenceResourceKey(entry.location)
      const users = grouped[key] ?? (grouped[key] = [])
      if (!users.some(({ userId }) => userId === entry.userId)) users.push(entry)
    }
    return grouped
  }, [presenceUsers])

  useEffect(() => {
    if (!user) return
    let stopped = false
    const clientId = presenceClientId.current
    const publish = async (location: ReturnType<typeof presenceLocation>) => {
      try {
        await presenceApi.heartbeat(clientId, location)
        if (!stopped) setPresenceError(null)
      } catch (error) {
        if (!stopped) setPresenceError(`Live presence is unavailable: ${describeApiError(error)}`)
      }
    }
    const syncVisibility = () => {
      void publish(document.visibilityState === 'visible' ? activePresenceLocation : null)
    }

    void publish(document.visibilityState === 'visible' ? activePresenceLocation : null)
    const heartbeat = activePresenceLocation
      ? window.setInterval(() => {
        if (document.visibilityState === 'visible') void publish(activePresenceLocation)
      }, 15_000)
      : null
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      stopped = true
      if (heartbeat !== null) window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [activePresenceLocation, user?.id])
  // The one place the three layers are collapsed into a lookup, so what a request substitutes and
  // what the Variables menu reports can never disagree about which value wins.
  const resolvedVariables = useMemo(
    () => resolveVariables(scopedVariables, selectedEnvironment?.variables ?? []),
    [scopedVariables, selectedEnvironment],
  )
  const variablesByScope = useMemo(() => ({
    user: scopedVariables.filter(({ scope }) => scope === 'user').map(({ key, value }) => ({ key, value })),
    environment: selectedEnvironment?.variables ?? [],
    global: scopedVariables.filter(({ scope }) => scope === 'global').map(({ key, value }) => ({ key, value })),
  }) satisfies Record<VariableOrigin, { key: string; value: string; enabled?: boolean }[]>, [scopedVariables, selectedEnvironment])
  const activeCollectionId = selected && selected.kind !== 'environment' ? selected.collectionId : null
  // Export follows the current selection: an environment when one is open, otherwise the
  // collection the selection belongs to.
  const exportTarget = useMemo(() => {
    if (view === 'variables' && (variableScope === 'user' || variableScope === 'global')) {
      const label = variableScope === 'user' ? 'Only me' : 'Team'
      return { title: `Export ${label} variables as Play Next JSON`, run: () => exportScopedVariableScope(variableScope) }
    }
    if (selected?.kind === 'environment') {
      const environment = environments.find(({ id }) => id === selected.environmentId)
      if (!environment) return null
      const includesSecrets = environment.variables.some((variable) => variable.isSecret)
      return {
        title: includesSecrets
          ? `Export "${environment.name}" as a Postman environment file; the downloaded file will contain secret values`
          : `Export "${environment.name}" as a Postman environment file`,
        run: () => exportEnvironment(environment.id),
      }
    }
    if (!activeCollectionId) return null
    const collection = collections.find(({ id }) => id === activeCollectionId)
    if (!collection) return null
    return { title: `Export "${collection.name}" as OpenAPI or Postman`, run: () => setExportCollectionId(collection.id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, variableScope, selected, environments, collections, activeCollectionId, scopedVariables])

  function openResource(resource: OpenResource) {
    const key = resourceKey(resource)
    if (!draftsRef.current[key]) {
      const draft = getResourceDraft(resource, collections, environments)
      if (!draft) return
      setDrafts((current) => ({ ...current, [key]: draft }))
      setBaselines((current) => ({ ...current, [key]: jsonCopy(draft) }))
    }
    if (resource.kind !== 'environment') {
      const collection = collections.find(({ id }) => id === resource.collectionId)
      const parentId = resource.kind === 'folder'
        ? resource.itemId
        : resource.kind === 'request'
          ? collection
            ? (() => {
              const item = findItem(collection, resource.itemId)
              if (item?.type === 'request') return item.parentId ?? undefined
              const draft = draftsRef.current[resourceKey(resource)]
              return draft?.kind === 'request' ? draft.parentId : undefined
            })()
            : undefined
          : undefined
      lastOpenedLocation.current = { collectionId: resource.collectionId, ...(parentId ? { parentId } : {}) }
    }
    setSelected(resource)
    setMobilePanel('editor')
    setResourceError(null)
    setRunStartError(null)
    setView(resource.kind === 'environment' ? 'environments' : 'workspace')
    if (resource.kind === 'request' && !requestTabs.some((tab) => resourceKey(tab) === key)) {
      setRequestTabs((tabs) => [...tabs, resource])
    }
  }

  function updateDraft(next: ResourceDraft) {
    const key = draftKey(next)
    setDrafts((current) => ({ ...current, [key]: next }))
    setResourceError(null)
  }

  /** Drops open request tabs together with their drafts, without asking. */
  function removeTabs(tabKeys: string[]) {
    const keys = new Set(tabKeys)
    const remaining = requestTabs.filter((entry) => !keys.has(resourceKey(entry)))
    setRequestTabs((tabs) => tabs.filter((entry) => !keys.has(resourceKey(entry))))
    setDrafts((current) => omitKeys(current, [...keys]))
    setBaselines((current) => omitKeys(current, [...keys]))
    setSelected((current) => current && keys.has(resourceKey(current)) ? remaining[remaining.length - 1] ?? null : current)
  }

  function removeTab(tab: OpenResource, alsoKey?: string) {
    removeTabs([resourceKey(tab), ...(alsoKey ? [alsoKey] : [])])
  }

  function requestCloseTab(tab: OpenResource) {
    const key = resourceKey(tab)
    const draft = drafts[key]
    if (draft && hasUnsavedChanges(draft, baselines[key])) {
      const title = draft.kind === 'request' ? draft.resource.name || 'New request' : 'Request'
      setClosePrompt({ tab, title, saving: false, error: null })
      return
    }
    removeTab(tab)
  }

  function requestCloseTabs(keys: string[]) {
    if (keys.length === 0) return
    const unsavedCount = keys.filter(isUnsaved).length
    if (unsavedCount > 0) setCloseTabsPrompt({ keys, unsavedCount })
    else removeTabs(keys)
  }

  async function saveAndCloseTab() {
    if (!closePrompt) return
    const draft = drafts[resourceKey(closePrompt.tab)]
    setClosePrompt((current) => current && { ...current, saving: true, error: null })
    const outcome = await saveDraft(draft)
    if (outcome && 'error' in outcome) {
      setClosePrompt((current) => current && { ...current, saving: false, error: outcome.error })
      return
    }
    removeTab(closePrompt.tab, outcome?.key)
    setClosePrompt(null)
  }

  const closeDiscardPrompt = useCallback(() => setDiscardPrompt(null), [])
  const closeTrashPrompt = useCallback(() => setTrashPrompt(null), [])

  function isUnsaved(key: string): boolean {
    const draft = drafts[key]
    return !!draft && hasUnsavedChanges(draft, baselines[key])
  }

  const unsavedTabKeys = requestTabs.map(resourceKey).filter(isUnsaved)
  const hasAnyUnsaved = Object.keys(drafts).some(isUnsaved)

  function promptDiscard(keys: string[]) {
    const unsaved = keys.filter(isUnsaved)
    if (unsaved.length > 0) setDiscardPrompt({ keys: unsaved })
  }

  /**
   * Throws away the local edits of the given drafts and returns each to its last saved copy. A
   * draft that was never saved has nothing to return to, so it is closed instead.
   */
  function discardDrafts(keys: string[]) {
    setDiscardPrompt(null)
    const reverted: Record<string, ResourceDraft> = {}
    const closedTabs: string[] = []
    const dropped: string[] = []
    for (const key of keys) {
      const draft = drafts[key]
      if (!draft || !hasUnsavedChanges(draft, baselines[key])) continue
      const isNew = (draft.kind === 'request' || draft.kind === 'environment') && draft.isNew
      if (isNew && draft.kind === 'request') closedTabs.push(key)
      else if (isNew) dropped.push(key)
      else if (baselines[key]) reverted[key] = jsonCopy(baselines[key])
    }
    if (closedTabs.length > 0) removeTabs(closedTabs)
    if (dropped.length > 0) {
      setDrafts((current) => omitKeys(current, dropped))
      setBaselines((current) => omitKeys(current, dropped))
      setSelected((current) => current && dropped.includes(resourceKey(current)) ? null : current)
    }
    if (Object.keys(reverted).length > 0) setDrafts((current) => ({ ...current, ...reverted }))
    if (keys.includes(currentKey)) setResourceError(null)
  }

  // The browser's own "Leave site?" prompt is the only thing that can stop a tab close or reload.
  useEffect(() => {
    if (!hasAnyUnsaved) return
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasAnyUnsaved])

  const tabMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tabMenu) return
    tabMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const close = () => setTabMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [tabMenu])

  async function sendActiveRequest(overrideRunnerId?: RunnerId, methodOverride?: 'HEAD' | 'OPTIONS') {
    if (!activeDraft || activeDraft.kind !== 'request') return
    const key = draftKey(activeDraft)
    const resource = activeDraft.resource
    const resourceToPrepare = methodOverride === 'HEAD' ? { ...resource, body: null } : resource
    const outcome = prepareRequest(resourceToPrepare, toVariableMap(resolvedVariables), activeEffectiveAuth?.auth)

    if (!outcome.ok) {
      const message = outcome.reason === 'missing-variables'
        ? describeMissingVariables(diagnoseMissingVariables(outcome.missing, environments, selectedEnvironmentId))
        : outcome.reason === 'invalid-json'
          ? `Body is not valid JSON at line ${outcome.error.line}, column ${outcome.error.column}: ${outcome.error.message}. Request was not sent.`
          : `${outcome.message} Request was not sent.`
      setSendErrors((current) => ({ ...current, [key]: message }))
      playSound('error')
      return
    }

    setSendErrors((current) => omitKeys(current, [key]))
    setSending((current) => ({ ...current, [key]: true }))
    const chosenRunner = overrideRunnerId ?? runnerId
    const request = methodOverride
      ? { ...outcome.request, method: methodOverride }
      : outcome.request
    let result = await runnerFor(chosenRunner).run(request)
    // The browser is blocked by the *target's* CORS policy, which no setting on this app or its
    // API can change - that header belongs to a server we do not own. The API is not a browser
    // and is not bound by CORS, so when it can reach the host the request is simply re-sent from
    // there rather than handed back as an error the user cannot act on. Only a *confirmed* block
    // qualifies: an unreachable host would fail from the server too, and retrying it would turn
    // one honest error into two.
    let sentFromServerAfterCorsBlock = false
    let serverRetryFailed = false
    if (
      chosenRunner === 'browser'
      && result.kind === 'failure'
      && result.corsBlocked === true
      && canProxy(request.url, proxy)
    ) {
      const viaServer = await runnerFor('server').run(request)
      // A proxy that also fails leaves the original error in place: it names the real obstacle,
      // while the proxy's would describe a fallback the user never asked for.
      if (viaServer.kind === 'success') {
        result = viaServer
        sentFromServerAfterCorsBlock = true
      } else {
        serverRetryFailed = true
      }
    }
    setSending((current) => ({ ...current, [key]: false }))
    playSound(result.kind === 'success' ? 'complete' : 'error')
    const sentAt = new Date().toISOString()
    // Sync runs here, at the one place a response arrives, so a rule applies whichever runner sent
    // the request and whether or not the response panel happens to be open.
    const syncOutcomes = result.kind === 'success'
      ? applySyncRules(key, result, extractFromResponse, (scope, name, value) => {
        // Fire-and-forget on purpose: a sync failure must not hold up showing the response, and
        // the outcome list below already carries whether each rule read a value.
        void saveScopedVariable(scope, name, value).catch(() => {})
      })
      : []
    setResponses((current) => ({ ...current, [key]: { result, sentAt, url: request.url, syncOutcomes, ...(sentFromServerAfterCorsBlock ? { sentFromServerAfterCorsBlock } : {}), ...(serverRetryFailed ? { serverRetryFailed } : {}) } }))
    setHistory(appendHistoryEntry({
      sentAt,
      method: request.method,
      url: request.url,
      requestName: resource.name || undefined,
      requestBody: request.body,
      status: result.kind === 'success' ? result.status : undefined,
      statusText: result.kind === 'success' ? result.statusText : undefined,
      durationMs: result.durationMs,
      sizeBytes: result.kind === 'success' ? result.sizeBytes : undefined,
      failure: result.kind === 'failure' ? result.message : undefined,
      responseBody: result.kind === 'success' ? result.bodyText : undefined,
    }))
  }

  function requestRunSavedResources() {
    if (!activeDraft || (activeDraft.kind !== 'collection' && activeDraft.kind !== 'folder')) return
    setRunPrompt({ kind: activeDraft.kind, name: activeDraft.resource.name, items: activeDraft.resource.items })
  }

  async function runSavedResources() {
    if (!activeDraft || (activeDraft.kind !== 'collection' && activeDraft.kind !== 'folder')) return
    const draft = activeDraft
    const collectionId = draft.kind === 'collection' ? draft.resource.id : draft.collectionId
    const collectionName = collections.find(({ id }) => id === collectionId)?.name ?? collectionId
    const folderName = draft.kind === 'folder' ? draft.resource.name : undefined
    const key = draftKey(draft)
    setRunStartingKey(key)
    setRunStartError(null)
    try {
      const environmentId = selectedEnvironmentId || undefined
      const run = draft.kind === 'collection'
        ? await workspaceApi.runCollection(collectionId, environmentId)
        : await workspaceApi.runFolder(collectionId, draft.resource.id, environmentId)
      setRunHistory({ collectionId, collectionName, folderName, initialRun: run })
      playSound('complete')
    } catch (error) {
      playSound('error')
      const description = describeApiError(error)
      if (apiErrorCode(error) === 'RATE_LIMITED') {
        const retryAfterSeconds = apiErrorDetails(error)?.retryAfterSeconds
        setRunStartError(
          typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
            ? `${description} Collection runs are limited to 3 per minute; try again in ${Math.ceil(retryAfterSeconds)} seconds.`
            : `${description} Collection runs are limited to 3 per minute.`,
        )
      } else {
        setRunStartError(description)
      }
    } finally {
      setRunStartingKey(null)
    }
  }

  function showRunHistory() {
    if (!activeDraft || (activeDraft.kind !== 'collection' && activeDraft.kind !== 'folder')) return
    const collectionId = activeDraft.kind === 'collection' ? activeDraft.resource.id : activeDraft.collectionId
    setRunHistory({
      collectionId,
      collectionName: collections.find(({ id }) => id === collectionId)?.name ?? collectionId,
      folderName: activeDraft.kind === 'folder' ? activeDraft.resource.name : undefined,
    })
    setRunStartError(null)
  }

  function setLocalCollection(collection: CollectionResource) {
    setCollections((current) => current.map((entry) => entry.id === collection.id ? collection : entry))
    const key = `collection:${collection.id}`
    setDrafts((current) => {
      const draft = current[key]
      return draft?.kind === 'collection'
        ? { ...current, [key]: { ...draft, resource: { ...draft.resource, items: collection.items } } }
        : current
    })
    setBaselines((current) => {
      const baseline = current[key]
      return baseline?.kind === 'collection'
        ? { ...current, [key]: { ...baseline, resource: { ...baseline.resource, items: collection.items } } }
        : current
    })
  }

  function applyRestoredVersion(resource: CollectionResource | WorkspaceItem) {
    if (!canEditWorkspace) return
    if (!activeDraft || activeDraft.kind === 'environment') return
    let restored: ResourceDraft
    if (activeDraft.kind === 'collection') {
      if ('type' in resource || resource.id !== activeDraft.resource.id) {
        throw new Error('The API returned a different resource while restoring collection history.')
      }

      restored = {
        kind: 'collection',
        resource: { ...activeDraft.resource, ...resource, items: activeDraft.resource.items },
      }
      setLocalCollection(restored.resource)
    } else {
      if (activeDraft.kind === 'folder') {
        if (!('type' in resource) || resource.type !== 'folder' || resource.id !== activeDraft.resource.id) {
          throw new Error('The API returned a different resource while restoring folder history.')
        }
        restored = { kind: 'folder', collectionId: activeDraft.collectionId, resource }
      } else {
        if (!('type' in resource) || resource.type !== 'request' || resource.id !== activeDraft.resource.id) {
          throw new Error('The API returned a different resource while restoring request history.')
        }
        restored = { kind: 'request', collectionId: activeDraft.collectionId, resource }
      }
      const collection = collections.find(({ id }) => id === activeDraft.collectionId)
      if (collection) {
        setLocalCollection({ ...collection, items: replaceItemInTree(collection.items, resource) })
      }
    }
    const key = draftKey(restored)
    lastSavedRef.current[key] = jsonCopy(restored)
    setDrafts((current) => ({ ...current, [key]: restored }))
    setBaselines((current) => ({ ...current, [key]: jsonCopy(restored) }))
    setRemoteUpdate(null)
    setResourceError(null)
  }

  function applyRestoredSnapshot(collection: CollectionResource) {
    if (!canEditWorkspace) return
    if (activeDraft?.kind !== 'collection' || collection.id !== activeDraft.resource.id) {
      throw new Error('The API returned a different collection while restoring a snapshot.')
    }

    setCollections((current) => sortByName(current.map((entry) => entry.id === collection.id ? collection : entry)))
    const refreshedDrafts: Record<string, ResourceDraft> = {
      [`collection:${collection.id}`]: { kind: 'collection', resource: collection },
    }
    for (const draft of Object.values(draftsRef.current)) {
      if (draft.kind === 'collection' || draft.kind === 'environment' || draft.collectionId !== collection.id) continue
      const item = findItem(collection, draft.resource.id)
      if (!item) continue
      const refreshed: ResourceDraft = item.type === 'folder'
        ? { kind: 'folder', collectionId: collection.id, resource: item }
        : { kind: 'request', collectionId: collection.id, resource: item }
      refreshedDrafts[draftKey(refreshed)] = refreshed
    }
    const keepOtherCollections = (draft: ResourceDraft) =>
      draft.kind === 'environment' ||
      (draft.kind !== 'collection' && draft.collectionId !== collection.id) ||
      (draft.kind === 'collection' && draft.resource.id !== collection.id)
    setDrafts((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([, draft]) => keepOtherCollections(draft))),
      ...refreshedDrafts,
    }))
    setBaselines((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([, draft]) => keepOtherCollections(draft))),
      ...Object.fromEntries(Object.entries(refreshedDrafts).map(([key, draft]) => [key, jsonCopy(draft)])),
    }))
    for (const [key, draft] of Object.entries(refreshedDrafts)) lastSavedRef.current[key] = jsonCopy(draft)
    setRequestTabs((current) => current.filter((tab) =>
      tab.kind !== 'request' || tab.collectionId !== collection.id || !!findItem(collection, tab.itemId)))
    setRemoteUpdate(null)
    setResourceError(null)
  }

  /** Saves any open draft, not only the active one, so a tab can be saved while it is being closed. */
  async function saveDraft(target: ResourceDraft | undefined = activeDraft): Promise<SaveOutcome | null> {
    if (!canEditWorkspace) {
      setResourceError('You do not have permission in this team.')
      return { error: 'You do not have permission in this team.' }
    }
    if (!target) return null
    const targetKey = draftKey(target)
    if (!hasUnsavedChanges(target, baselines[targetKey])) return null
    const isActive = targetKey === currentKey
    setSaving(true)
    if (isActive) setResourceError(null)
    let settle: () => void = () => {}
    const done = new Promise<void>((resolve) => { settle = resolve })
    pendingSaveRef.current = Promise.all([pendingSaveRef.current, done]).then(() => undefined)
    try {
      let saved: ResourceDraft
      if (target.kind === 'collection') {
        const resource = await workspaceApi.saveCollection(target.resource)
        const next = { ...target, resource: { ...target.resource, ...resource, items: target.resource.items } }
        setLocalCollection(next.resource)
        saved = next
      } else if (target.kind === 'folder') {
        const resource = await workspaceApi.saveFolder(target.collectionId, target.resource)
        if (resource.type !== 'folder') throw new Error('The API returned a non-folder resource while saving a folder.')
        const collection = collections.find(({ id }) => id === target.collectionId)
        if (collection) setLocalCollection({ ...collection, items: replaceItemInTree(collection.items, resource) })
        saved = { ...target, resource }
      } else if (target.kind === 'request') {
        let resource: RequestResource
        if (target.isNew) {
          const input: CreateItemInput = {
            type: 'request',
            name: target.resource.name,
            description: target.resource.description,
            ...(target.parentId ? { parentId: target.parentId } : {}),
            method: target.resource.method,
            url: target.resource.url,
            queryParams: target.resource.queryParams,
            headers: target.resource.headers,
            body: target.resource.body,
            auth: target.resource.auth,
            preRequestScript: target.resource.preRequestScript ?? '',
            postResponseScript: target.resource.postResponseScript ?? '',
          }
          const created = await workspaceApi.createItem(target.collectionId, input)
          if (created.type !== 'request') throw new Error('The API returned a non-request resource while creating a request.')
          resource = created
        } else {
          resource = await workspaceApi.saveRequest(target.collectionId, target.resource)
        }
        const collection = collections.find(({ id }) => id === target.collectionId)
        if (collection) {
          const treeItems = target.isNew
            ? target.parentId
              ? addToFolder(collection.items, target.parentId, resource)
              : [...collection.items, resource]
            : replaceItemInTree(collection.items, resource)
          setLocalCollection({ ...collection, items: treeItems })
        }
        saved = { kind: 'request', collectionId: target.collectionId, resource }
        if (target.isNew) {
          const oldKey = draftKey(target)
          const nextResource: OpenResource = { kind: 'request', collectionId: target.collectionId, itemId: resource.id }
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
          setSelected((current) => current && resourceKey(current) === oldKey ? nextResource : current)
        }
      } else {
        const resource = target.isNew
          ? await workspaceApi.createEnvironment({
              name: target.resource.name,
              variables: target.resource.variables,
            })
          : await workspaceApi.saveEnvironment(target.resource)
        setEnvironments((current) => sortByName(target.isNew
          ? [...current, resource]
          : current.map((entry) => entry.id === resource.id ? resource : entry)))
        saved = { kind: 'environment', resource }
        if (target.isNew) {
          const oldKey = draftKey(target)
          const nextResource: OpenResource = { kind: 'environment', environmentId: resource.id }
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
          setSelected((current) => current && resourceKey(current) === oldKey ? nextResource : current)
        }
      }
      const savedKey = draftKey(saved)
      lastSavedRef.current[savedKey] = jsonCopy(saved)
      setDrafts((current) => ({ ...current, [savedKey]: saved }))
      setBaselines((current) => ({ ...current, [savedKey]: jsonCopy(saved) }))
      playSound('success')
      return { key: savedKey }
    } catch (error) {
      const message = describeApiError(error)
      playSound('error')
      if (isActive) setResourceError(message)
      return { error: message }
    } finally {
      setSaving(false)
      settle()
    }
  }

  /**
   * Applies a Variables-menu edit to the selected environment.
   *
   * The API only saves whole environment documents, so the latest copy is fetched first and the
   * edit applied to that, keeping the window in which a teammate's change could be overwritten as
   * small as the API allows. An open editor tab with unsaved changes is never overwritten: the
   * user is told to save or discard it first.
   */
  async function mutateSelectedEnvironmentVariables(mutate: (variables: EnvironmentVariable[]) => VariableEditResult) {
    if (!canEditWorkspace) throw new Error('You do not have permission in this team.')
    if (!selectedEnvironmentId) throw new Error('No environment is selected.')
    const key = resourceKey({ kind: 'environment', environmentId: selectedEnvironmentId })
    const openDraft = draftsRef.current[key]
    const openBaseline = baselinesRef.current[key]
    if (openDraft && (!openBaseline || isDraftDirty(openDraft, openBaseline))) {
      throw new Error('This environment has unsaved changes in its tab. Save or discard them first.')
    }

    const latest = await workspaceApi.environment(selectedEnvironmentId)
    const result = mutate(latest.variables)
    if (!result.ok) throw new Error(result.error)
    const resource = await workspaceApi.saveEnvironment({ ...latest, variables: result.variables })
    setEnvironments((current) => sortByName(current.map((entry) => entry.id === resource.id ? resource : entry)))
    if (draftsRef.current[key]) {
      const saved: ResourceDraft = { kind: 'environment', resource }
      setDrafts((current) => ({ ...current, [key]: saved }))
      setBaselines((current) => ({ ...current, [key]: jsonCopy(saved) }))
    }
  }

  async function appendSelectedEnvironmentVariable(key: string, value: string, isSecret = false) {
    if (!canEditWorkspace) throw new Error('You do not have permission in this team.')
    if (!selectedEnvironmentId) throw new Error('No environment is selected.')
    const resourceKeyForEnvironment = resourceKey({ kind: 'environment', environmentId: selectedEnvironmentId })
    const openDraft = draftsRef.current[resourceKeyForEnvironment]
    const openBaseline = baselinesRef.current[resourceKeyForEnvironment]
    if (openDraft && (!openBaseline || isDraftDirty(openDraft, openBaseline))) {
      throw new Error('This environment has unsaved changes in its tab. Save or discard them first.')
    }

    const resource = await workspaceApi.appendEnvironmentVariable(selectedEnvironmentId, { key, value, isSecret })
    setEnvironments((current) => sortByName(current.map((entry) => entry.id === resource.id ? resource : entry)))
    if (draftsRef.current[resourceKeyForEnvironment]) {
      const saved: ResourceDraft = { kind: 'environment', resource }
      setDrafts((current) => ({ ...current, [resourceKeyForEnvironment]: saved }))
      setBaselines((current) => ({ ...current, [resourceKeyForEnvironment]: jsonCopy(saved) }))
    }
  }

  const startCreatingVariable = useCallback((rawName: string, origin: VariableOrigin) => {
    if (!canEditWorkspace && origin !== 'user') return
    const validation = validateVariableName(rawName)
    if (!validation.ok) return
    setVariableScope(origin)
    setVariableFilter('')
    setPendingVariableKey(validation.name)
    setView('variables')
  }, [canEditWorkspace])
  const clearPendingVariableKey = useCallback(() => setPendingVariableKey(null), [])

  async function createCollection() {
    if (!canEditWorkspace) return
    const name = window.prompt('Collection name')
    if (!name?.trim()) return
    try {
      const resource = await workspaceApi.createCollection({ name: name.trim(), description: '' })
      setCollections((current) => sortByName([...current, resource]))
      const draft: ResourceDraft = { kind: 'collection', resource }
      const key = draftKey(draft)
      setDrafts((current) => ({ ...current, [key]: draft }))
      setBaselines((current) => ({ ...current, [key]: jsonCopy(draft) }))
      lastOpenedLocation.current = { collectionId: resource.id }
      setSelected({ kind: 'collection', collectionId: resource.id })
      setView('workspace')
      playSound('pop')
    } catch (error) {
      playSound('error')
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
    if (!canEditWorkspace) return 'You do not have permission in this team.'
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
        setImportFlow(null)
        lastOpenedLocation.current = { collectionId: resource.id }
        setSelected({ kind: 'collection', collectionId: resource.id })
        setView('workspace')
        setLoadingError(`The collection "${resource.name}" was imported, but its environment could not be created: ${describeApiError(error)}`)
        return
      }
    }

    setImportFlow(null)
    lastOpenedLocation.current = { collectionId: resource.id }
    setSelected({ kind: 'collection', collectionId: resource.id })
    setView('workspace')
  }

  async function importEnvironment(payload: { name: string; variables: EnvironmentVariable[] }): Promise<string | void> {
    if (!canEditWorkspace) return 'You do not have permission in this team.'
    try {
      const resource = await workspaceApi.createEnvironment(payload)
      setEnvironments((current) => sortByName([...current, resource]))
      setImportFlow(null)
      setSelected({ kind: 'environment', environmentId: resource.id })
      setView('environments')
    } catch (error) {
      return describeApiError(error)
    }
  }

  async function previewBulkImport(collectionId: string, input: BulkImportInput) {
    return workspaceApi.bulkImport(collectionId, input)
  }

  async function importBulkItems(collectionId: string, input: BulkImportInput) {
    if (!canEditWorkspace) throw new Error('You do not have permission in this team.')
    const result = await workspaceApi.bulkImport(collectionId, input)
    const refreshError = await refreshCollection(collectionId, 'import')
    return { result, refreshError }
  }

  /** Reloads one collection's tree after a server-side bulk change. Returns a message on failure. */
  async function refreshCollection(collectionId: string, action: 'import' | 'sync'): Promise<string | undefined> {
    try {
      const refreshed = await workspaceApi.collection(collectionId)
      setCollections((current) => sortByName(current.map((entry) => entry.id === refreshed.id ? refreshed : entry)))
      const key = `collection:${collectionId}`
      setDrafts((current) => {
        const draft = current[key]
        return draft?.kind === 'collection'
          ? { ...current, [key]: { ...draft, resource: { ...draft.resource, items: refreshed.items } } }
          : current
      })
      setBaselines((current) => {
        const baseline = current[key]
        return baseline?.kind === 'collection'
          ? { ...current, [key]: { ...baseline, resource: { ...baseline.resource, items: refreshed.items } } }
          : current
      })
      return undefined
    } catch (error) {
      const refreshError = `The ${action} succeeded, but the collection could not be refreshed: ${describeApiError(error)}`
      setLoadingError(refreshError)
      return refreshError
    }
  }

  async function createOpenApiCollection(input: OpenApiCreateInput) {
    if (!canEditWorkspace) throw new Error('You do not have permission in this team.')
    const created = await workspaceApi.createCollectionFromOpenApi(input)
    setCollections((current) => sortByName([...current.filter(({ id }) => id !== created.collection.id), created.collection]))
    return created
  }

  function openCollection(collectionId: string) {
    setImportFlow(null)
    lastOpenedLocation.current = { collectionId }
    setSelected({ kind: 'collection', collectionId })
    setView('workspace')
  }

  async function previewOpenApiImport(collectionId: string, input: OpenApiImportInput) {
    return workspaceApi.importOpenApi(collectionId, { ...input, dryRun: true })
  }

  async function importOpenApiItems(collectionId: string, input: OpenApiImportInput) {
    if (!canEditWorkspace) throw new Error('You do not have permission in this team.')
    const result = await workspaceApi.importOpenApi(collectionId, { ...input, dryRun: false })
    const refreshError = await refreshCollection(collectionId, 'import')
    return { result, refreshError }
  }

  async function previewOpenApiSync(collectionId: string, spec: string) {
    return workspaceApi.previewOpenApiSync(collectionId, spec)
  }

  async function applyOpenApiSync(collectionId: string, input: OpenApiSyncApplyInput) {
    if (!canEditWorkspace) throw new Error('You do not have permission in this team.')
    const result = await workspaceApi.applyOpenApiSync(collectionId, input)
    // The user explicitly sent these to Trash, so their open tabs go with them.
    if (result.deletedItemIds.length > 0) {
      removeTabs(result.deletedItemIds.map((itemId) => resourceKey({ kind: 'request', collectionId, itemId })))
    }
    const refreshError = await refreshCollection(collectionId, 'sync')
    return { result, refreshError }
  }

  async function exportOpenApi(collectionId: string, options: OpenApiExportOptions) {
    const collection = collections.find(({ id }) => id === collectionId)
    const { blob, fileName } = await workspaceApi.exportOpenApi(collectionId, options)
    downloadBlob(blob, fileName ?? fallbackOpenApiFileName(collection?.name ?? '', options.format))
    setExportCollectionId(null)
  }

  function finishBulkImport(collectionId: string, parentId: string | null) {
    setImportFlow(null)
    setSelected(parentId ? { kind: 'folder', collectionId, itemId: parentId } : { kind: 'collection', collectionId })
    setView('workspace')
  }

  function downloadJson(content: unknown, fileName: string) {
    downloadBlob(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }), fileName)
  }

  function downloadBlob(blob: Blob, fileName: string) {
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

  function exportScopedVariableScope(scope: 'user' | 'global') {
    const label = scope === 'user' ? 'user' : 'global'
    downloadJson(exportScopedVariables(scope, scopedVariables), `play-next-api-${label}-variables.json`)
  }

  async function createFolder() {
    if (!canEditWorkspace) return
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
      lastOpenedLocation.current = { collectionId, parentId: item.id }
      setSelected({ kind: 'folder', collectionId, itemId: item.id })
      setView('workspace')
      playSound('pop')
    } catch (error) {
      playSound('error')
      setLoadingError(describeApiError(error))
    }
  }

  function createRequest() {
    if (!canEditWorkspace) return
    const locations = getRequestLocations(collections)
    const selectedCollectionId = selected && selected.kind !== 'environment' ? selected.collectionId : undefined
    const selectedParentId = getCreationParentId(selected, collections)
    const selectedDraft = selected?.kind === 'request' ? draftsRef.current[resourceKey(selected)] : undefined
    const currentLocation = selectedDraft?.kind === 'request' && selectedDraft.isNew
      ? { collectionId: selectedDraft.collectionId, ...(selectedDraft.parentId ? { parentId: selectedDraft.parentId } : {}) }
      : selectedCollectionId
        ? { collectionId: selectedCollectionId, ...(selectedParentId ? { parentId: selectedParentId } : {}) }
        : null
    const preferred = lastOpenedLocation.current ?? currentLocation
    const matchesLocation = (candidate: RequestLocation | null) => candidate && locations.find(({ collectionId, parentId }) =>
      collectionId === candidate.collectionId && parentId === candidate.parentId)
    const location = matchesLocation(preferred)
      ?? matchesLocation(currentLocation)
      ?? locations.find(({ collectionId }) => collectionId === selectedCollectionId)
      ?? locations[0]
    const collectionId = location?.collectionId
    if (!collectionId) {
      setLoadingError('Create a collection before adding a request.')
      return
    }
    const parentId = location.parentId
    lastOpenedLocation.current = { collectionId, ...(parentId ? { parentId } : {}) }
    const id = `draft-${createUuid()}`
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

  function changeNewRequestLocation(location: RequestLocation) {
    if (activeDraft?.kind !== 'request' || !activeDraft.isNew) return
    const oldKey = draftKey(activeDraft)
    const nextDraft: ResourceDraft = {
      ...activeDraft,
      collectionId: location.collectionId,
      ...(location.parentId ? { parentId: location.parentId } : { parentId: undefined }),
      resource: {
        ...activeDraft.resource,
        collectionId: location.collectionId,
        parentId: location.parentId ?? null,
      },
    }
    const nextKey = draftKey(nextDraft)
    const nextResource: OpenResource = {
      kind: 'request',
      collectionId: location.collectionId,
      itemId: activeDraft.resource.id,
    }
    setDrafts((current) => {
      const next = { ...current, [nextKey]: nextDraft }
      if (oldKey !== nextKey) delete next[oldKey]
      return next
    })
    setRequestTabs((tabs) => tabs.map((tab) => resourceKey(tab) === oldKey ? nextResource : tab))
    setSelected((current) => current && resourceKey(current) === oldKey ? nextResource : current)
    lastOpenedLocation.current = location
    setResourceError(null)
  }

  function createEnvironment() {
    if (!canEditWorkspace) return
    const draft: ResourceDraft = {
      kind: 'environment',
      resource: { id: `draft-${createUuid()}`, name: '', variables: [] },
      isNew: true,
    }
    seedDraft(draft)
    setSelected({ kind: 'environment', environmentId: draft.resource.id })
    setView('environments')
    setResourceError(null)
  }

  /**
   * Duplicates a collection, folder, request or environment.
   *
   * The copy is written by the server in one transaction, so there is nothing to assemble here -
   * the response is the finished resource, and this only has to put it where the user will see
   * it and open it. The draft is seeded directly rather than through `openResource`, because the
   * collection state it reads from has not re-rendered yet at this point.
   */
  async function cloneResource(resource: OpenResource) {
    if (!canEditWorkspace) return
    const id = resource.kind === 'environment'
      ? resource.environmentId
      : resource.kind === 'collection'
        ? resource.collectionId
        : resource.itemId
    // A folder of hundreds of requests takes a moment; without this the user can queue three
    // copies before the first one answers.
    if (cloningId) return
    setCloningId(id)
    try {
      if (resource.kind === 'collection') {
        const copy = await workspaceApi.cloneCollection(resource.collectionId)
        setCollections((current) => sortByName([...current, copy]))
        const draft: ResourceDraft = { kind: 'collection', resource: copy }
        seedDraft(draft)
        lastOpenedLocation.current = { collectionId: copy.id }
        setSelected({ kind: 'collection', collectionId: copy.id })
        setView('workspace')
      } else if (resource.kind === 'environment') {
        const copy = await workspaceApi.cloneEnvironment(resource.environmentId)
        setEnvironments((current) => sortByName([...current, copy]))
        const draft: ResourceDraft = { kind: 'environment', resource: copy }
        seedDraft(draft)
        setSelected({ kind: 'environment', environmentId: copy.id })
        setSelectedEnvironmentId(copy.id)
        setView('environments')
      } else {
        const { collectionId } = resource
        const copy = await workspaceApi.cloneItem(collectionId, resource.itemId)
        setCollections((current) => current.map((collection) => collection.id === collectionId
          ? {
              ...collection,
              items: copy.parentId ? addToFolder(collection.items, copy.parentId, copy) : [...collection.items, copy],
            }
          : collection))
        const draft: ResourceDraft = copy.type === 'folder'
          ? { kind: 'folder', collectionId, resource: copy }
          : { kind: 'request', collectionId, resource: copy }
        seedDraft(draft)
        const open: OpenResource = { kind: copy.type, collectionId, itemId: copy.id }
        setSelected(open)
        setView('workspace')
        if (copy.type === 'request') setRequestTabs((tabs) => [...tabs, open])
      }
      setResourceError(null)
    } catch (error) {
      setLoadingError(describeApiError(error))
    } finally {
      setCloningId(null)
    }
  }

  /**
   * Reparents a node and its subtree. The tree updates optimistically so the drop feels immediate,
   * and the previous state is restored if the API refuses, rather than leaving the sidebar showing
   * a move that never happened.
   */
  async function moveItem(source: MoveSource, target: MoveTarget) {
    if (!canEditWorkspace) return
    const previous = collections
    const next = applyMove(previous, source, target)
    if (next === previous) return
    setCollections(next)
    try {
      await workspaceApi.moveItem(source.collectionId, source.itemId, {
        collectionId: target.collectionId,
        parentId: target.kind === 'folder' ? target.itemId : null,
      })
      setResourceError(null)
    } catch (error) {
      setCollections(previous)
      setLoadingError(describeApiError(error))
    }
  }

  function seedDraft(draft: ResourceDraft) {
    const key = draftKey(draft)
    setDrafts((current) => ({ ...current, [key]: draft }))
    setBaselines((current) => ({ ...current, [key]: jsonCopy(draft) }))
  }

  /** Asks first; the item is only moved once the user confirms in the dialog. */
  function deleteResource(resource: OpenResource) {
    if (!canEditWorkspace) return
    const name = resource.kind === 'environment'
      ? environments.find(({ id }) => id === resource.environmentId)?.name
      : resource.kind === 'collection'
        ? collections.find(({ id }) => id === resource.collectionId)?.name
        : collections.map((collection) => findItem(collection, resource.itemId)?.name).find(Boolean)
    setTrashPrompt({ resource, name: name ?? 'this item' })
  }

  async function moveToTrash(resource: OpenResource) {
    if (!canEditWorkspace) return
    setTrashPrompt(null)
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
    if (!canEditWorkspace) return
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
    if (!canEditWorkspace) return
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
    if (!canEditWorkspace) return
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
      const latest = await fetchLatestDraft(selected)
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
      <GlassBackdrop />
      <header className="topbar">
        <div className="brand">
          <button className="sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>☰</button>
          <img className="brand-logo brand-logo-light" src="/assets/play-next-logo.png" alt="Play Next" />
          <img className="brand-logo brand-logo-dark" src="/assets/play-next-logo-dark.png" alt="" aria-hidden="true" />
          {teams.length > 0 && (
            <TeamPicker teams={teams} value={activeTeamId} onChange={onTeamChange} />
          )}
          <span className="workspace-label">API Workspace</span>
        </div>
        <div className="top-actions">
          <EnvironmentPicker
            environments={sortByName(environments)}
            value={selectedEnvironmentId}
            onChange={setSelectedEnvironmentId}
          />
          {canEditWorkspace && <Button variant="outline" size="sm" onClick={() => setImportFlow('options')}>Import</Button>}
          <Button variant="outline" size="sm" disabled={!exportTarget} title={exportTarget?.title ?? 'Select a collection or environment to export'} onClick={() => exportTarget?.run()}>Export</Button>
          <div className="account-menu">
            {currentTeam && canManageMembers && <Button variant="outline" size="sm" onClick={() => setView('members')}>Members</Button>}
            {user?.systemRole === 'admin' && <Button variant="outline" size="sm" onClick={onOpenAdmin}>Admin</Button>}
            {user && <UserProfileMenu user={user} onSignOut={onSignOut} />}
          </div>
        </div>
      </header>
      {!connected && (
        <div className="connection-notice" role="status">
          <span>Live updates disconnected. Your workspace data is still available.</span>
          <button onClick={() => setReconnectKey((value) => value + 1)}>Reconnect</button>
        </div>
      )}
      {teamAccessNotice && <div className="connection-notice" role="status">{teamAccessNotice}</div>}
      {presenceError && <div className="connection-notice presence-unavailable" role="status">{presenceError}</div>}
      {syncNotice && <div className="connection-notice" role="status"><span>{syncNotice}</span><button onClick={() => setSyncNotice(null)}>Dismiss</button></div>}
      {loadingError && <div className="global-error" role="alert">{loadingError}<button aria-label="Dismiss error" onClick={() => setLoadingError(null)}>×</button></div>}
      <nav className="mobile-panel-switcher" aria-label="Workspace panels">
        <button
          type="button"
          aria-pressed={mobilePanel === 'sidebar'}
          onClick={() => setMobilePanel('sidebar')}
        >
          Collections
        </button>
        <button
          type="button"
          aria-pressed={mobilePanel === 'editor'}
          onClick={() => setMobilePanel('editor')}
        >
          Request
        </button>
      </nav>
      <div className={`main-layout mobile-show-${mobilePanel}`}>
        <WorkspaceTree
          collections={collections}
          selected={selected}
          onSelect={openResource}
          onCreateCollection={() => void createCollection()}
          onCreateFolder={() => void createFolder()}
          onCreateRequest={createRequest}
          onDelete={deleteResource}
          onClone={(resource) => void cloneResource(resource)}
          onMove={canEditWorkspace ? (source, target) => void moveItem(source, target) : undefined}
          canEdit={canEditWorkspace}
          canAccessTrash={canEditWorkspace}
          cloningId={cloningId}
          onShowTrash={() => { setView('trash'); void reloadTrash() }}
          onShowHistory={() => setView('history')}
          onShowActivity={() => setView('activity')}
          collapsed={sidebarCollapsed}
          environments={environments}
          activeEnvironmentId={selectedEnvironmentId}
          onActivateEnvironment={setSelectedEnvironmentId}
          resolvedVariables={resolvedVariables}
          variablesByScope={variablesByScope}
          variableFilter={variableFilter}
          onVariableFilterChange={setVariableFilter}
          selectedVariableScope={view === 'variables' ? variableScope : undefined}
          onOpenVariableScope={(origin) => { setVariableScope(origin); setView('variables') }}
          onCreateEnvironment={() => void createEnvironment()}
          width={sidebarWidth}
          onResize={(next) => setSidebarWidth(clampSidebarWidth(next))}
          presenceByResource={presenceByResource}
        />
        <div className="main-content">
          {view === 'trash' ? (
            canEditWorkspace
              ? <TrashView entries={trash} onRestore={(entry) => void beginRestore(entry)} />
              : <div className="empty-workspace"><h1>Trash unavailable</h1><p>You do not have permission in this team.</p></div>
          ) : view === 'members' ? (
            currentTeam && canManageMembers
              ? <TeamMembers teamId={currentTeam.id} teamName={currentTeam.name} onChanged={onRefreshTeams ?? (() => Promise.resolve())} />
              : <div className="empty-workspace"><h1>Members unavailable</h1><p>You do not have permission in this team.</p></div>
          ) : view === 'history' ? (
            <HistoryView entries={history} onClear={() => { clearHistory(); setHistory([]) }} />
          ) : view === 'activity' ? (
            <TeamActivityView
              key={activeTeamId ?? ''}
              teamId={activeTeamId}
              collections={collections}
              environments={environments}
              onOpenResource={openResource}
            />
          ) : view === 'variables' ? (
            <VariablesMenu
              resolved={resolvedVariables}
              variablesByScope={variablesByScope}
              hasEnvironment={!!selectedEnvironment}
              environmentId={selectedEnvironment?.id ?? null}
              filter={variableFilter}
              selectedOrigin={variableScope}
              editableOrigins={editableVariableOrigins}
              initialAddKey={pendingVariableKey}
              onInitialAddHandled={clearPendingVariableKey}
              standalone
              onEditEnvironmentVariable={(oldKey, newKey, value, isSecret) => mutateSelectedEnvironmentVariables((variables) => editEnvironmentVariable(variables, oldKey, newKey, value, isSecret))}
              onAddEnvironmentVariable={appendSelectedEnvironmentVariable}
              onRemoveEnvironmentVariable={(name) => mutateSelectedEnvironmentVariables((variables) => removeEnvironmentVariable(variables, name))}
            />
          ) : view === 'environments' && selected?.kind !== 'environment' ? (
            <div className="empty-workspace environment-welcome">
              <span className="response-symbol">◉</span>
              <h1>Environments</h1>
              <p>Create shared variables for request URLs, such as <code>baseUrl</code> and <code>port</code>.</p>
              {canEditWorkspace && <Button onClick={() => void createEnvironment()}>Create environment</Button>}
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
                      <div
                        className={`request-tab ${selected && resourceKey(selected) === resourceKey(tab) ? 'active' : ''}`}
                        key={resourceKey(tab)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          const rect = event.currentTarget.getBoundingClientRect()
                          // A keyboard-opened menu (Shift+F10 / Menu key) reports 0,0; anchor it under the tab instead.
                          const fromKeyboard = event.clientX === 0 && event.clientY === 0
                          setTabMenu({ tab, x: fromKeyboard ? rect.left : event.clientX, y: fromKeyboard ? rect.bottom : event.clientY })
                        }}
                      >
                        <button className="tab-activate" onClick={() => openResource(tab)}><span className="method-mini">{d?.kind === 'request' ? d.resource.method : 'GET'}</span>{title}{d && hasUnsavedChanges(d, baselines[resourceKey(tab)]) && <span className="tab-dirty">●</span>}</button>
                        <button className="tab-close" aria-label={`Close ${title}`} onClick={() => requestCloseTab(tab)}>×</button>
                      </div>
                    )
                  })}
                  {canEditWorkspace && <button className="tab-add" title="New request" aria-label="New request" onClick={createRequest}>＋</button>}
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
                    <p>Lines marked − are only in your local draft; lines marked + are only in the server version. Your draft stays unchanged until you choose.</p>
                    <CompareDiff local={activeDraft} latest={remoteUpdate.latest} />
                    <div className="compare-actions">
                      <Button variant="outline" onClick={() => setRemoteUpdate(null)}>Keep my draft</Button>
                      <Button onClick={useLatest}>Replace local draft with server version</Button>
                    </div>
                  </div>
                )}
                <VariableCreationContext.Provider value={{
                  options: [
                    { origin: 'user', label: 'Only me' },
                    ...(selectedEnvironment ? [{ origin: 'environment' as const, label: selectedEnvironment.name }] : []),
                    { origin: 'global', label: 'Team' },
                  ],
                  onCreate: startCreatingVariable,
                }}>
                  <ResourceEditor
                    draft={activeDraft}
                    variables={resolvedVariables}
                    requestLocations={activeDraft.kind === 'request' && activeDraft.isNew ? getRequestLocations(collections) : undefined}
                    onRequestLocationChange={changeNewRequestLocation}
                    collectionName={activeDraft.kind !== 'collection' && activeDraft.kind !== 'environment'
                      ? collections.find(({ id }) => id === activeDraft.collectionId)?.name
                      : undefined}
                    dirty={dirty}
                    saving={saving}
                    error={resourceError}
                    onChange={updateDraft}
                    onSave={() => void saveDraft()}
                    onDiscard={() => promptDiscard([currentKey])}
                    onShowVersionHistory={activeDraft.kind !== 'environment' && !(activeDraft.kind === 'request' && activeDraft.isNew)
                      ? () => setVersionHistoryOpen(true)
                      : undefined}
                    onShowSnapshots={activeDraft.kind === 'collection' ? () => setSnapshotsOpen(true) : undefined}
                    onRunSavedResources={activeDraft.kind === 'collection' || activeDraft.kind === 'folder' ? requestRunSavedResources : undefined}
                    onShowRunHistory={activeDraft.kind === 'collection' || activeDraft.kind === 'folder' ? showRunHistory : undefined}
                    onOpenResource={openResource}
                    onCreateRequest={activeDraft.kind === 'folder' || activeDraft.kind === 'collection' ? createRequest : undefined}
                    onCreateFolder={activeDraft.kind === 'folder' || activeDraft.kind === 'collection' ? () => void createFolder() : undefined}
                    runStarting={runStartingKey === currentKey}
                    runError={runStartError}
                    onDelete={() => deleteResource(selected!)}
                    canEdit={canEditWorkspace}
                    onSend={(methodOverride) => void sendActiveRequest(undefined, methodOverride)}
                    sending={activeSending}
                    sendError={activeSendError}
                    response={activeResponse}
                    requestKey={currentKey}
                    runnerId={runnerId}
                    onRunnerChange={setRunnerId}
                    proxy={proxy}
                    viewers={activePresenceUsers}
                    effectiveAuth={activeEffectiveAuth}
                    onRetryFromServer={canRetryFromServer
                      ? () => {
                        // Switching the selector as well as retrying: the user has just chosen to
                        // send from the server, and leaving the control on "Browser" would make the
                        // next send fail exactly the same way.
                        setRunnerId('server')
                        void sendActiveRequest('server')
                      }
                      : undefined}
                  />
                </VariableCreationContext.Provider>
              </div>
            </>
          ) : view === 'environments' ? (
            <div className="empty-workspace environment-welcome">
              <span className="response-symbol">◉</span>
              <h1>Environments</h1>
              <p>Create shared variables for request URLs, such as <code>baseUrl</code> and <code>port</code>.</p>
              {canEditWorkspace && <Button onClick={() => void createEnvironment()}>Create environment</Button>}
              {environments.length > 0 && <div className="environment-shortcuts">{sortByName(environments).map((entry) => <button key={entry.id} onClick={() => openResource({ kind: 'environment', environmentId: entry.id })}>{entry.name}</button>)}</div>}
            </div>
          ) : loading ? (
            <div className="empty-workspace"><span className="loading-spinner" /><p>Loading shared workspace…</p></div>
          ) : (
            <div className="empty-workspace">
              <span className="response-symbol">↗</span>
              <h1>Choose a request to get started</h1>
              <p>Select an item from a collection, or create a new request.</p>
              {canEditWorkspace && <Button onClick={createRequest} disabled={collections.length === 0}>New request</Button>}
              {canEditWorkspace && collections.length === 0 && <Button variant="outline" onClick={() => void createCollection()}>Create a collection</Button>}
            </div>
          )}
        </div>
      </div>

      {importFlow === 'options' && (
        <ImportOptionsDialog
          onCancel={() => setImportFlow(null)}
          onSelect={(source) => setImportFlow(source)}
        />
      )}

      {importFlow === 'postman' && (
        <ImportDialog collections={collections} environments={environments} onCancel={() => setImportFlow(null)} onImport={importCollection} onImportEnvironment={importEnvironment} />
      )}

      {importFlow === 'bulk' && (
        <BulkImportDialog
          collections={collections}
          initialCollectionId={selected && selected.kind !== 'environment' ? selected.collectionId : undefined}
          initialParentId={selected?.kind === 'folder' ? selected.itemId : undefined}
          onCancel={() => setImportFlow(null)}
          onComplete={finishBulkImport}
          onPreview={previewBulkImport}
          onImport={importBulkItems}
        />
      )}

      {importFlow === 'openapi-create' && (
        <OpenApiCreateDialog onCancel={() => setImportFlow(null)} onCreate={createOpenApiCollection} onOpen={openCollection} />
      )}

      {importFlow === 'openapi-import' && (
        <OpenApiImportDialog
          collections={collections}
          initialCollectionId={selected && selected.kind !== 'environment' ? selected.collectionId : undefined}
          initialParentId={selected?.kind === 'folder' ? selected.itemId : undefined}
          onCancel={() => setImportFlow(null)}
          onComplete={finishBulkImport}
          onPreview={previewOpenApiImport}
          onImport={importOpenApiItems}
        />
      )}

      {importFlow === 'openapi-sync' && (
        <OpenApiSyncDialog
          collections={collections}
          initialCollectionId={selected && selected.kind !== 'environment' ? selected.collectionId : undefined}
          onCancel={() => setImportFlow(null)}
          onPreview={previewOpenApiSync}
          onApply={applyOpenApiSync}
          onComplete={openCollection}
        />
      )}

      {exportCollectionId && (() => {
        const collection = collections.find(({ id }) => id === exportCollectionId)
        if (!collection) return null
        return (
          <CollectionExportDialog
            collectionName={collection.name}
            onCancel={() => setExportCollectionId(null)}
            onExportPostman={() => { exportCollection(collection.id); setExportCollectionId(null) }}
            onExportOpenApi={(options) => exportOpenApi(collection.id, options)}
          />
        )
      })()}

      {versionHistoryOpen && activeDraft && activeDraft.kind !== 'environment' && !(activeDraft.kind === 'request' && activeDraft.isNew) && (
        <VersionHistoryDialog
          draft={activeDraft}
          dirty={dirty}
          canRestore={canEditWorkspace}
          onClose={() => setVersionHistoryOpen(false)}
          onRestored={applyRestoredVersion}
        />
      )}

      {snapshotsOpen && activeDraft?.kind === 'collection' && (
        <CollectionSnapshotsDialog
          collectionId={activeDraft.resource.id}
          collectionName={activeDraft.resource.name}
          dirty={dirty}
          canRestore={canEditWorkspace}
          onClose={() => setSnapshotsOpen(false)}
          onRestored={applyRestoredSnapshot}
        />
      )}

      {runHistory && (
        <CollectionRunHistoryDialog
          collectionId={runHistory.collectionId}
          collectionName={runHistory.collectionName}
          folderName={runHistory.folderName}
          initialRun={runHistory.initialRun}
          onClose={() => setRunHistory(null)}
        />
      )}

      {discardPrompt && (() => {
        const keys = discardPrompt.keys
        const single = keys.length === 1 ? drafts[keys[0]!] : undefined
        const singleIsNew = !!single && (single.kind === 'request' || single.kind === 'environment') && single.isNew
        return (
          <ConfirmDialog
            title={keys.length === 1 ? 'Discard unsaved changes?' : `Discard unsaved changes in ${keys.length} tabs?`}
            message={keys.length > 1
              ? 'Each tab returns to its last saved version; requests that were never saved are closed. This cannot be undone.'
              : singleIsNew
                ? 'This item has never been saved, so it will be closed and your edits will be lost. This cannot be undone.'
                : 'Your edits will be lost and this item will return to its last saved version. This cannot be undone.'}
            confirmLabel="Discard changes"
            destructive
            onConfirm={() => discardDrafts(keys)}
            onCancel={closeDiscardPrompt}
          />
        )
      })()}

      {runPrompt && (
        <RunConfirmDialog
          kind={runPrompt.kind}
          name={runPrompt.name}
          items={runPrompt.items}
          onCancel={() => setRunPrompt(null)}
          onConfirm={() => { setRunPrompt(null); void runSavedResources() }}
        />
      )}

      {closeTabsPrompt && (
        <ConfirmDialog
          title={`Close ${closeTabsPrompt.keys.length} tab${closeTabsPrompt.keys.length === 1 ? '' : 's'}?`}
          message={closeTabsPrompt.unsavedCount > 0
            ? `Unsaved changes in ${closeTabsPrompt.unsavedCount} tab${closeTabsPrompt.unsavedCount === 1 ? '' : 's'} will be lost. This cannot be undone.`
            : 'This cannot be undone.'}
          confirmLabel="Close tabs"
          destructive
          onConfirm={() => { removeTabs(closeTabsPrompt.keys); setCloseTabsPrompt(null) }}
          onCancel={() => setCloseTabsPrompt(null)}
        />
      )}

      {tabMenu && (() => {
        const key = resourceKey(tabMenu.tab)
        const otherTabKeys = requestTabs.filter((tab) => resourceKey(tab) !== key).map(resourceKey)
        const allTabKeys = requestTabs.map(resourceKey)
        const run = (action: () => void) => () => { setTabMenu(null); action() }
        return (
          <div
            className="tab-context-menu"
            role="menu"
            aria-label="Tab actions"
            style={{ left: Math.min(tabMenu.x, window.innerWidth - 230), top: Math.max(0, Math.min(tabMenu.y, window.innerHeight - 190)) }}
            ref={tabMenuRef}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              event.preventDefault()
              const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
              const index = items.indexOf(document.activeElement as HTMLButtonElement)
              items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
            }}
          >
            <button role="menuitem" disabled={!isUnsaved(key)} onClick={run(() => promptDiscard([key]))}>Discard changes</button>
            <button role="menuitem" disabled={unsavedTabKeys.length === 0} onClick={run(() => promptDiscard(unsavedTabKeys))}>Discard changes in all tabs</button>
            <hr />
            <button role="menuitem" onClick={run(() => requestCloseTab(tabMenu.tab))}>Close tab</button>
            <button role="menuitem" disabled={otherTabKeys.length === 0} onClick={run(() => requestCloseTabs(otherTabKeys))}>Close other tabs</button>
            <button role="menuitem" onClick={run(() => requestCloseTabs(allTabKeys))}>Close all tabs</button>
          </div>
        )
      })()}

      {trashPrompt && (
        <ConfirmDialog
          title={`Move “${trashPrompt.name}” to Trash?`}
          message={trashPrompt.resource.kind === 'collection' || trashPrompt.resource.kind === 'folder'
            ? 'Everything inside it moves to Trash too. You can restore it from Trash later.'
            : 'You can restore it from Trash later.'}
          confirmLabel="Move to Trash"
          destructive
          onConfirm={() => void moveToTrash(trashPrompt.resource)}
          onCancel={closeTrashPrompt}
        />
      )}

      {closePrompt && (
        <div className="modal-backdrop">
          <section className="restore-dialog" role="dialog" aria-modal="true" aria-labelledby="close-tab-title">
            <header className="modal-heading"><div><h2 id="close-tab-title">Save changes to “{closePrompt.title}”?</h2><p>This request has unsaved changes. They will be lost if you close it without saving.</p></div><button aria-label="Close" disabled={closePrompt.saving} onClick={() => setClosePrompt(null)}>×</button></header>
            {closePrompt.error && <p className="inline-error" role="alert">{closePrompt.error}</p>}
            <footer className="modal-actions">
              <Button variant="outline" disabled={closePrompt.saving} onClick={() => setClosePrompt(null)}>Cancel</Button>
              <Button variant="outline" disabled={closePrompt.saving} onClick={() => { removeTab(closePrompt.tab); setClosePrompt(null) }}>Discard changes</Button>
              <Button disabled={closePrompt.saving} onClick={() => void saveAndCloseTab()}>{closePrompt.saving ? 'Saving…' : 'Save and close'}</Button>
            </footer>
          </section>
        </div>
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
