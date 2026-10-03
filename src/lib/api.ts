import axios, { isAxiosError } from 'axios'

import type {
  CollectionResource,
  CollectionVersionSnapshot,
  CreateItemInput,
  EnvironmentResource,
  ItemVersionSnapshot,
  ResourceVersion,
  RestoreCheck,
  RequestResource,
  TrashEntry,
  TreeNodeInput,
  WorkspaceItem,
} from '@/lib/workspace-types'
import type { ScopedVariable, VariableScope } from '@/lib/variable-scopes'
import type { VariableOrderPreferences } from '@/lib/variable-order'
import { getActiveTeamId, notifyTeamContextError } from '@/lib/teams'
import type { TeamMember, TeamRole } from '@/lib/teams'

const apiOrigin = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export const apiClient = axios.create({
  baseURL: `${apiOrigin}/api/v1`,
  timeout: 10_000,
  headers: { Accept: 'application/json' },
  // The API names the HttpOnly session cookie per environment. The browser
  // attaches it automatically; this client must include credentials on every
  // request without knowing or handling the cookie name itself.
  withCredentials: true,
})

apiClient.interceptors.request.use((config) => {
  const teamId = getActiveTeamId()
  if (teamId) config.headers.set('X-Team-Id', teamId)
  else config.headers.delete('X-Team-Id')
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (isAxiosError<{ error?: { code?: string } }>(error)) {
      const code = error.response?.data?.error?.code
      const hasTeamContext = !!error.config?.headers?.get('X-Team-Id')
      const memberRoute = /^\/teams\/[^/]+\/members(?:\/|$)/.test(error.config?.url ?? '')
      const teamScopedRoute = /^\/(?:collections|environments|variables|trash|presence)(?:\/|$)/.test(error.config?.url ?? '') || memberRoute
      if (hasTeamContext && teamScopedRoute && (code === 'TEAM_NOT_FOUND' || code === 'TEAM_MEMBERSHIP_REQUIRED')) {
        notifyTeamContextError(code)
      }
      if (error.response?.status === 403 && code === 'TEAM_ROLE_REQUIRED' && (hasTeamContext || memberRoute)) {
        notifyTeamContextError('TEAM_ROLE_REQUIRED')
      }
    }
    return Promise.reject(error)
  },
)

export async function checkHealth() {
  const { data } = await apiClient.get<unknown>('/health', { baseURL: apiOrigin })
  return data
}

export function describeApiError(error: unknown): string {
  if (isAxiosError<{ error?: { code?: string; message?: string } }>(error)) {
    const apiError = error.response?.data?.error
    if (apiError?.message) return `${apiError.message}${apiError.code ? ` (${apiError.code})` : ''}`
    if (error.response) {
      return `API responded with ${error.response.status}${error.response.statusText ? ` ${error.response.statusText}` : ''}`
    }
    return error.message || 'Network error: unable to reach the API'
  }
  return error instanceof Error ? error.message : 'Unknown error'
}

export interface ProxySettings {
  enabled: boolean
  /** The API allows every host. Reported separately so the UI need not interpret a literal `*`. */
  anyHost: boolean
  allowedHosts: string[]
}

export type ImportConflictPolicy = 'rename' | 'fail'

export interface BulkImportInput {
  parentId: string | null
  onConflict: ImportConflictPolicy
  dryRun: boolean
  items: TreeNodeInput[]
}

export interface BulkImportResult {
  collectionId: string
  parentId: string | null
  dryRun: boolean
  created: { folders: number; requests: number }
  renamed: Array<{ path: string[]; from: string; to: string }>
  warnings: Array<{ path: string[]; code: string; header?: string }>
  roots: Array<{ id: string; kind: 'folder' | 'request' }>
  changedAt: string
}

export function apiErrorCode(error: unknown): string | undefined {
  if (!isAxiosError<{ error?: { code?: string } }>(error)) return undefined
  return error.response?.data?.error?.code
}

export function apiErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (!isAxiosError<{ error?: { details?: unknown } }>(error)) return undefined
  const details = error.response?.data?.error?.details
  return details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : undefined
}

export const workspaceApi = {
  /**
   * Whether the API will run requests on the client's behalf, and for which hosts. Asked once so
   * the UI can explain what is reachable instead of only finding out by failing.
   */
  async proxySettings(): Promise<ProxySettings> {
    const { data } = await apiClient.get<ProxySettings>('/proxy')
    return { enabled: !!data.enabled, anyHost: !!data.anyHost, allowedHosts: data.allowedHosts ?? [] }
  },
  async variables(): Promise<ScopedVariable[]> {
    const { data } = await apiClient.get<{ variables: ScopedVariable[] }>('/variables')
    return data.variables ?? []
  },
  async variableOrder(): Promise<string[]> {
    const { data } = await apiClient.get<{ order: string[] }>('/variables/order')
    return data.order ?? []
  },
  async setVariableOrder(order: string[]): Promise<string[]> {
    const { data } = await apiClient.put<{ order: string[] }>('/variables/order', { order })
    return data.order ?? []
  },
  async setVariable(scope: VariableScope, key: string, value: string): Promise<ScopedVariable> {
    // The key travels in the path, so it is encoded here rather than trusted: a key is free text
    // from a response and could hold a character that would otherwise change the route.
    const { data } = await apiClient.put<ScopedVariable>(`/variables/${scope}/${encodeURIComponent(key)}`, { value })
    return data
  },
  async deleteVariable(scope: VariableScope, key: string): Promise<void> {
    await apiClient.delete(`/variables/${scope}/${encodeURIComponent(key)}`)
  },
  /** The signed-in user's saved Variables-menu order, or `null` when they have never saved one. */
  async variableOrderPreferences(): Promise<unknown> {
    const { data } = await apiClient.get<{ preferences: unknown }>('/preferences/variable-order')
    return data?.preferences ?? null
  },
  async saveVariableOrderPreferences(preferences: VariableOrderPreferences): Promise<unknown> {
    const { data } = await apiClient.put<{ preferences: unknown }>('/preferences/variable-order', { preferences })
    return data?.preferences ?? null
  },
  async collections() {
    const { data } = await apiClient.get<{ collections: CollectionResource[] }>('/collections')
    return data.collections
  },
  async collection(id: string) {
    const { data } = await apiClient.get<CollectionResource>(`/collections/${id}`)
    return data
  },
  async bulkImport(collectionId: string, input: BulkImportInput) {
    const { data } = await apiClient.post<BulkImportResult>(
      `/collections/${collectionId}/import`,
      input,
      { timeout: 120_000 },
    )
    return data
  },
  async createCollection(input: Pick<CollectionResource, 'name' | 'description' | 'auth'> & { items?: TreeNodeInput[] }) {
    // A Postman import can be tens of MB saved in one transaction; the default 10s timeout is too short.
    const { data } = await apiClient.post<CollectionResource>('/collections', input, input.items ? { timeout: 120_000 } : undefined)
    return data
  },
  async saveCollection(resource: CollectionResource) {
    const { data } = await apiClient.put<CollectionResource>(`/collections/${resource.id}`, {
      name: resource.name,
      description: resource.description,
      auth: resource.auth ?? null,
    })
    return data
  },
  async collectionVersions(collectionId: string) {
    const { data } = await apiClient.get<{ versions: ResourceVersion<CollectionVersionSnapshot>[] }>(
      `/collections/${collectionId}/versions`,
    )
    return data.versions
  },
  async restoreCollectionVersion(collectionId: string, versionId: string) {
    const { data } = await apiClient.post<CollectionResource>(
      `/collections/${collectionId}/versions/${versionId}/restore`,
    )
    return data
  },
  async deleteCollection(id: string) {
    await apiClient.delete(`/collections/${id}`)
  },
  async cloneCollection(id: string) {
    // A collection can hold a whole imported Postman tree, and the server copies it in one
    // transaction, so this gets the same room to finish as the import that created it.
    const { data } = await apiClient.post<CollectionResource>(`/collections/${id}/clone`, undefined, { timeout: 120_000 })
    return data
  },
  async createItem(
    collectionId: string,
    input: CreateItemInput,
  ) {
    const { data } = await apiClient.post<WorkspaceItem>(`/collections/${collectionId}/items`, input)
    return data
  },
  async item(collectionId: string, itemId: string) {
    const { data } = await apiClient.get<WorkspaceItem>(`/collections/${collectionId}/items/${itemId}`)
    return data
  },
  async itemVersions(collectionId: string, itemId: string) {
    const { data } = await apiClient.get<{ versions: ResourceVersion<ItemVersionSnapshot>[] }>(
      `/collections/${collectionId}/items/${itemId}/versions`,
    )
    return data.versions
  },
  async restoreItemVersion(collectionId: string, itemId: string, versionId: string) {
    const { data } = await apiClient.post<WorkspaceItem>(
      `/collections/${collectionId}/items/${itemId}/versions/${versionId}/restore`,
    )
    return data
  },
  async saveFolder(collectionId: string, resource: Extract<WorkspaceItem, { type: 'folder' }>) {
    const { data } = await apiClient.put<WorkspaceItem>(`/collections/${collectionId}/items/${resource.id}`, {
      type: 'folder',
      name: resource.name,
      description: resource.description,
      auth: resource.auth ?? null,
    })
    return data
  },
  async saveRequest(collectionId: string, resource: RequestResource) {
    const { data } = await apiClient.put<RequestResource>(`/collections/${collectionId}/items/${resource.id}`, {
      type: 'request',
      name: resource.name,
      description: resource.description,
      method: resource.method,
      url: resource.url,
      queryParams: resource.queryParams,
      headers: resource.headers,
      body: resource.body,
      auth: resource.auth,
    })
    return data
  },
  async moveItem(collectionId: string, itemId: string, target: { collectionId: string; parentId: string | null }) {
    // Reparents the item together with its whole subtree, in one server-side transaction.
    // See docs/tree-drag-and-drop-backend.md for the endpoint contract and behavior.
    const { data } = await apiClient.post<WorkspaceItem>(
      `/collections/${collectionId}/items/${itemId}/move`,
      { targetCollectionId: target.collectionId, parentId: target.parentId },
      { timeout: 120_000 },
    )
    return data
  },
  async deleteItem(collectionId: string, itemId: string) {
    await apiClient.delete(`/collections/${collectionId}/items/${itemId}`)
  },
  async cloneItem(collectionId: string, itemId: string) {
    const { data } = await apiClient.post<WorkspaceItem>(
      `/collections/${collectionId}/items/${itemId}/clone`,
      undefined,
      { timeout: 120_000 },
    )
    return data
  },
  async environments() {
    const { data } = await apiClient.get<{ environments: EnvironmentResource[] }>('/environments')
    return data.environments
  },
  async environment(id: string) {
    const { data } = await apiClient.get<EnvironmentResource>(`/environments/${id}`)
    return data
  },
  async createEnvironment(input: Pick<EnvironmentResource, 'name' | 'variables'>) {
    const { data } = await apiClient.post<EnvironmentResource>('/environments', input)
    return data
  },
  async saveEnvironment(resource: EnvironmentResource) {
    const { data } = await apiClient.put<EnvironmentResource>(`/environments/${resource.id}`, {
      name: resource.name,
      variables: resource.variables,
    })
    return data
  },
  async deleteEnvironment(id: string) {
    await apiClient.delete(`/environments/${id}`)
  },
  async cloneEnvironment(id: string) {
    const { data } = await apiClient.post<EnvironmentResource>(`/environments/${id}/clone`)
    return data
  },
  async trash() {
    const { data } = await apiClient.get<{ entries: TrashEntry[] }>('/trash')
    return data.entries
  },
  async teamMembers(teamId: string) {
    const { data } = await apiClient.get<{ members: TeamMember[] }>(`/teams/${teamId}/members`)
    return data.members
  },
  async addTeamMember(teamId: string, input: { email: string; role: TeamRole }) {
    await apiClient.post(`/teams/${teamId}/members`, input)
  },
  async updateTeamMember(teamId: string, userId: string, role: TeamRole) {
    await apiClient.patch(`/teams/${teamId}/members/${userId}`, { role })
  },
  async removeTeamMember(teamId: string, userId: string) {
    await apiClient.delete(`/teams/${teamId}/members/${userId}`)
  },
  async checkRestore(
    id: string,
    input: { collectionName?: string; nameOverrides: Record<string, string> } = { nameOverrides: {} },
  ) {
    const { data } = await apiClient.post<RestoreCheck>(`/trash/${id}/restore/check`, input)
    return data
  },
  async restore(id: string, input: { collectionName?: string; nameOverrides: Record<string, string> }) {
    const { data } = await apiClient.post(`/trash/${id}/restore`, input)
    return data
  },
}
