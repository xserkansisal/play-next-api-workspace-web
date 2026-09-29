import axios, { isAxiosError } from 'axios'

import type {
  CollectionResource,
  CreateItemInput,
  EnvironmentResource,
  RestoreCheck,
  RequestResource,
  TrashEntry,
  WorkspaceItem,
} from '@/lib/workspace-types'

const apiOrigin = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export const apiClient = axios.create({
  baseURL: `${apiOrigin}/api/v1`,
  timeout: 10_000,
  headers: { Accept: 'application/json' },
})

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

export const workspaceApi = {
  async collections() {
    const { data } = await apiClient.get<{ collections: CollectionResource[] }>('/collections')
    return data.collections
  },
  async collection(id: string) {
    const { data } = await apiClient.get<CollectionResource>(`/collections/${id}`)
    return data
  },
  async createCollection(input: Pick<CollectionResource, 'name' | 'description'>) {
    const { data } = await apiClient.post<CollectionResource>('/collections', input)
    return data
  },
  async saveCollection(resource: CollectionResource) {
    const { data } = await apiClient.put<CollectionResource>(`/collections/${resource.id}`, {
      name: resource.name,
      description: resource.description,
    })
    return data
  },
  async deleteCollection(id: string) {
    await apiClient.delete(`/collections/${id}`)
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
  async saveFolder(collectionId: string, resource: Extract<WorkspaceItem, { type: 'folder' }>) {
    const { data } = await apiClient.put<WorkspaceItem>(`/collections/${collectionId}/items/${resource.id}`, {
      type: 'folder',
      name: resource.name,
      description: resource.description,
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
  async deleteItem(collectionId: string, itemId: string) {
    await apiClient.delete(`/collections/${collectionId}/items/${itemId}`)
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
  async trash() {
    const { data } = await apiClient.get<{ entries: TrashEntry[] }>('/trash')
    return data.entries
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
