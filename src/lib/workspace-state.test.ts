import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { apiClient, checkHealth, describeApiError, workspaceApi } from '@/lib/api'
import { applyChangeEvent, isDraftDirty, parseChangeEvent } from '@/lib/workspace-types'
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
    })
    expect(put.mock.calls[0]?.[1]).not.toHaveProperty('parentId')
    expect(put).toHaveBeenCalledTimes(1)
    put.mockRestore()
  })
})
