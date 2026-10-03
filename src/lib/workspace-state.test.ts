import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { apiClient, checkHealth, describeApiError, workspaceApi } from '@/lib/api'
import { applyChangeEvent, isDraftDirty, parseChangeEvent, parseReadyEpoch } from '@/lib/workspace-types'
import type { ChangeEvent, RequestResource } from '@/lib/workspace-types'

const change: ChangeEvent = {
  eventId: 'event-4',
  kind: 'request',
  id: 'request-1',
  collectionId: 'collection-1',
  operation: 'updated',
  changedAt: '2026-09-29T09:00:00.000Z',
}

describe('workspace state transitions', () => {
  it('marks a resource dirty only when its local draft differs from the saved baseline', () => {
    const saved = { name: 'Request', url: '/users' }
    expect(isDraftDirty(saved, { ...saved })).toBe(false)
    expect(isDraftDirty({ ...saved, url: '/orders' }, saved)).toBe(true)
  })

  it('asks for review when an open resource changes and refreshes for unrelated resources', () => {
    expect(applyChangeEvent(change, { kind: 'request', collectionId: 'collection-1', itemId: 'request-1' })).toBe('review')
    expect(applyChangeEvent({ ...change, id: 'request-2' }, { kind: 'request', collectionId: 'collection-1', itemId: 'request-1' })).toBe('refresh')
    expect(applyChangeEvent({ ...change, kind: 'collection', id: 'collection-1' }, { kind: 'request', collectionId: 'collection-1', itemId: 'request-1' })).toBe('review')
    expect(applyChangeEvent(change, null)).toBe('refresh')
  })
})

describe('SSE event handling', () => {
  it('parses change frames and treats resync as a full-refresh signal', () => {
    expect(parseChangeEvent('change', JSON.stringify(change))).toEqual(change)
    expect(parseChangeEvent('resync', '')).toBe('resync')
    expect(parseChangeEvent('ready', '{"epoch":"epoch-1"}')).toBeNull()
    expect(parseChangeEvent('change', '{')).toBeNull()
    expect(parseChangeEvent('change', JSON.stringify({ ...change, id: undefined }))).toBeNull()
  })

  it('falls back to the SSE lastEventId when the payload omits eventId, matching the real API wire format', () => {
    const { eventId: _eventId, ...payloadWithoutEventId } = change
    expect(parseChangeEvent('change', JSON.stringify(payloadWithoutEventId), 'sse-42')).toEqual({
      ...payloadWithoutEventId,
      eventId: 'sse-42',
    })
    expect(parseChangeEvent('change', JSON.stringify(payloadWithoutEventId))).toBeNull()
  })

  it('reads a server epoch from ready events so reconnects can detect restarts', () => {
    expect(parseReadyEpoch('{"epoch":"epoch-1"}')).toBe('epoch-1')
    expect(parseReadyEpoch('{"epoch":""}')).toBeNull()
    expect(parseReadyEpoch('{')).toBeNull()
  })
})

describe('API errors and save isolation', () => {
  it('keeps the health endpoint at the API origin outside the versioned workspace routes', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { status: 'ok' } } as never)
    await checkHealth()
    const expectedOrigin = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
    expect(get).toHaveBeenCalledWith('/health', { baseURL: expectedOrigin })
    get.mockRestore()
  })

  it('shows actionable server conflict codes and network failures', () => {
    const config = { headers: new AxiosHeaders() }
    const conflict = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
      status: 409,
      statusText: 'Conflict',
      data: { error: { code: 'ENVIRONMENT_NAME_CONFLICT', message: 'An environment already has this name.' } },
      headers: new AxiosHeaders(),
      config,
    })
    expect(describeApiError(conflict)).toBe('An environment already has this name. (ENVIRONMENT_NAME_CONFLICT)')
    expect(describeApiError(new AxiosError('Network Error'))).toBe('Network Error')
  })

  it('saves only the addressed request, not its parent or siblings', async () => {
    const request: RequestResource = {
      id: 'request-1',
      collectionId: 'collection-1',
      parentId: null,
      type: 'request',
      name: 'Orders',
      description: '',
      method: 'GET',
      url: '/orders',
      queryParams: [],
      headers: [],
      body: { type: 'json', content: '{"template":"{{value}}"}' },
      auth: { type: 'none' },
      preRequestScript: 'pm.environment.set("x", "1")',
      postResponseScript: 'pm.test("ok", () => pm.expect(pm.response.code).to.equal(200))',
    }
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: request } as never)
    await workspaceApi.saveRequest('collection-1', request)
    expect(put).toHaveBeenCalledWith('/collections/collection-1/items/request-1', {
      type: 'request',
      name: 'Orders',
      description: '',
      method: 'GET',
      url: '/orders',
      queryParams: [],
      headers: [],
      body: { type: 'json', content: '{"template":"{{value}}"}' },
      auth: { type: 'none' },
      preRequestScript: 'pm.environment.set("x", "1")',
      postResponseScript: 'pm.test("ok", () => pm.expect(pm.response.code).to.equal(200))',
      preRequestScriptIds: [],
      postResponseScriptIds: [],
    })
    expect(put.mock.calls[0]?.[1]).not.toHaveProperty('parentId')
    expect(put).toHaveBeenCalledTimes(1)
    put.mockRestore()
  })

  it('uses the collection and item version routes and sends body-less restore requests', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { versions: [] } } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never)

    await workspaceApi.collectionVersions('collection-1')
    await workspaceApi.itemVersions('collection-1', 'request-1')
    await workspaceApi.restoreCollectionVersion('collection-1', 'version-1')
    await workspaceApi.restoreItemVersion('collection-1', 'request-1', 'version-2')

    expect(get).toHaveBeenNthCalledWith(1, '/collections/collection-1/versions')
    expect(get).toHaveBeenNthCalledWith(2, '/collections/collection-1/items/request-1/versions')
    expect(post).toHaveBeenNthCalledWith(1, '/collections/collection-1/versions/version-1/restore')
    expect(post).toHaveBeenNthCalledWith(2, '/collections/collection-1/items/request-1/versions/version-2/restore')
    get.mockRestore()
    post.mockRestore()
  })

  it('uses snapshot list, detail, diff, and atomic restore routes', async () => {
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ data: { snapshots: [], nextOffset: 25 } } as never)
      .mockResolvedValueOnce({ data: { id: 'snapshot-1', snapshot: {}, itemCount: 1 } } as never)
      .mockResolvedValueOnce({ data: { items: {} } } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { id: 'collection-1', items: [] } } as never)

    await workspaceApi.collectionSnapshots('collection-1', 25, 50)
    await workspaceApi.collectionSnapshot('collection-1', 'snapshot-1')
    await workspaceApi.collectionSnapshotDiff('collection-1', 'snapshot-1', 'current')
    await workspaceApi.restoreCollectionSnapshot('collection-1', 'snapshot-1')

    expect(get).toHaveBeenNthCalledWith(1, '/collections/collection-1/snapshots', { params: { limit: 25, offset: 50 } })
    expect(get).toHaveBeenNthCalledWith(2, '/collections/collection-1/snapshots/snapshot-1')
    expect(get).toHaveBeenNthCalledWith(3, '/collections/collection-1/snapshots/diff', {
      params: { from: 'snapshot-1', to: 'current' },
    })
    expect(post).toHaveBeenCalledWith('/collections/collection-1/snapshots/snapshot-1/restore')
    get.mockRestore()
    post.mockRestore()
  })

  it('runs saved collections and folders and pages through the caller run history', async () => {
    const run = { id: 'run-1', collectionId: 'collection-1', results: [] }
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: run } as never)
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { runs: [], total: 0, limit: 25, offset: 0 } } as never)

    await workspaceApi.runCollection('collection-1', 'environment-1')
    await workspaceApi.runFolder('collection-1', 'folder-1')
    await workspaceApi.collectionRuns('collection-1', 25, 25)
    await workspaceApi.collectionRun('collection-1', 'run-1')

    expect(post).toHaveBeenNthCalledWith(1, '/collections/collection-1/run', { environmentId: 'environment-1' }, { timeout: 660_000 })
    expect(post).toHaveBeenNthCalledWith(2, '/collections/collection-1/items/folder-1/run', {}, { timeout: 660_000 })
    expect(get).toHaveBeenNthCalledWith(1, '/collections/collection-1/runs', { params: { limit: 25, offset: 25 } })
    expect(get).toHaveBeenNthCalledWith(2, '/collections/collection-1/runs/run-1')
    post.mockRestore()
    get.mockRestore()
  })

  it('uses API create and patch operations for variable add and rename', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { scope: 'user', key: 'token', value: 'abc' } } as never)
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { scope: 'user', key: 'access token', value: 'abc' } } as never)

    await workspaceApi.createVariable('user', 'token', 'abc')
    await workspaceApi.updateVariable('user', 'token', { key: 'access token', value: 'abc' })

    expect(post).toHaveBeenCalledWith('/variables/user', { key: 'token', value: 'abc' })
    expect(patch).toHaveBeenCalledWith('/variables/user/token', { key: 'access token', value: 'abc' })
    post.mockRestore()
    patch.mockRestore()
  })

  it('appends an environment variable through the dedicated API endpoint', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { id: 'environment-1', name: 'Local', variables: [] } } as never)
    await workspaceApi.appendEnvironmentVariable('environment-1', { key: 'token', value: 'abc' })
    expect(post).toHaveBeenCalledWith('/environments/environment-1/variables', { key: 'token', value: 'abc', isSecret: false })
    post.mockRestore()
  })

  it('sends explicit secret metadata when creating or saving environments', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { id: 'environment-1', name: 'Local', variables: [] } } as never)
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { id: 'environment-1', name: 'Local', variables: [] } } as never)

    await workspaceApi.createEnvironment({
      name: 'Local',
      variables: [
        { key: 'url', value: 'http://localhost', enabled: true },
        { key: 'token', value: 'private', enabled: true, isSecret: true },
      ],
    })
    await workspaceApi.saveEnvironment({
      id: 'environment-1',
      name: 'Local',
      variables: [
        { key: 'url', value: 'http://localhost', enabled: true },
        { key: 'token', value: 'private', enabled: true, isSecret: true },
      ],
    })

    expect(post).toHaveBeenCalledWith('/environments', {
      name: 'Local',
      variables: [
        { key: 'url', value: 'http://localhost', enabled: true, isSecret: false },
        { key: 'token', value: 'private', enabled: true, isSecret: true },
      ],
    })
    expect(put).toHaveBeenCalledWith('/environments/environment-1', {
      name: 'Local',
      variables: [
        { key: 'url', value: 'http://localhost', enabled: true, isSecret: false },
        { key: 'token', value: 'private', enabled: true, isSecret: true },
      ],
    })
    post.mockRestore()
    put.mockRestore()
  })
})

describe('shared script library API', () => {
  it('lists, creates, updates and deletes scripts', async () => {
    const script = { id: 's1', name: 'A', stage: 'pre-request', source: 'x' }
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { scripts: [script] } })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: script })
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: script })
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: '' })
    expect(await workspaceApi.scripts()).toEqual([script])
    expect(get).toHaveBeenCalledWith('/scripts')
    const input = { name: 'A', stage: 'pre-request' as const, source: 'x' }
    await workspaceApi.createScript(input)
    expect(post).toHaveBeenCalledWith('/scripts', input)
    await workspaceApi.updateScript('s1', input)
    expect(put).toHaveBeenCalledWith('/scripts/s1', input)
    await workspaceApi.deleteScript('s1')
    expect(del).toHaveBeenCalledWith('/scripts/s1')
  })
})
