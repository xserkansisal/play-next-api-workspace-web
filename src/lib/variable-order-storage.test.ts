import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { workspaceApi } from '@/lib/api'
import { DEFAULT_VARIABLE_ORDER } from '@/lib/variable-order'
import { getVariableOrder, loadVariableOrder, resetVariableOrder, saveVariableOrder } from '@/lib/variable-order-storage'

function notFound() {
  return new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 404, statusText: 'Not Found', data: {}, headers: {}, config: { headers: new AxiosHeaders() },
  })
}

const KEY = 'play-next-api-workspace.variable-order.v1:user-1'

describe('variable order storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetVariableOrder()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('adopts the server copy and caches it under the user', async () => {
    vi.spyOn(workspaceApi, 'variableOrderPreferences').mockResolvedValue({ sort: null, manual: { user: ['b', 'a'] }, updatedAt: '2026-01-01T00:00:00.000Z' })
    await loadVariableOrder('user-1')
    expect(getVariableOrder().sort).toBeNull()
    expect(getVariableOrder().manual.user).toEqual(['b', 'a'])
    expect(JSON.parse(window.localStorage.getItem(KEY)!).manual.user).toEqual(['b', 'a'])
  })

  it('pushes a newer local copy up instead of losing it', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ sort: null, manual: { user: ['local'] }, updatedAt: '2026-02-01T00:00:00.000Z' }))
    vi.spyOn(workspaceApi, 'variableOrderPreferences').mockResolvedValue({ sort: null, manual: { user: ['remote'] }, updatedAt: '2026-01-01T00:00:00.000Z' })
    const save = vi.spyOn(workspaceApi, 'saveVariableOrderPreferences').mockResolvedValue(null)
    await loadVariableOrder('user-1')
    expect(getVariableOrder().manual.user).toEqual(['local'])
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ manual: expect.objectContaining({ user: ['local'] }) }))
  })

  it('works from local storage alone when the endpoint does not exist', async () => {
    vi.useFakeTimers()
    vi.spyOn(workspaceApi, 'variableOrderPreferences').mockRejectedValue(notFound())
    const save = vi.spyOn(workspaceApi, 'saveVariableOrderPreferences')
    await loadVariableOrder('user-1')
    saveVariableOrder({ ...DEFAULT_VARIABLE_ORDER, sort: { field: 'value', direction: 'desc' } })
    await vi.runAllTimersAsync()
    expect(save).not.toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem(KEY)!).sort).toEqual({ field: 'value', direction: 'desc' })
  })

  it('debounces writes to one request', async () => {
    vi.useFakeTimers()
    vi.spyOn(workspaceApi, 'variableOrderPreferences').mockResolvedValue(null)
    const save = vi.spyOn(workspaceApi, 'saveVariableOrderPreferences').mockResolvedValue(null)
    await loadVariableOrder('user-1')
    saveVariableOrder({ ...DEFAULT_VARIABLE_ORDER, sort: null })
    saveVariableOrder({ ...DEFAULT_VARIABLE_ORDER, sort: { field: 'key', direction: 'desc' } })
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0].sort).toEqual({ field: 'key', direction: 'desc' })
  })

  it('keeps users apart', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ sort: null }))
    vi.spyOn(workspaceApi, 'variableOrderPreferences').mockRejectedValue(notFound())
    await loadVariableOrder('user-2')
    expect(getVariableOrder()).toEqual(DEFAULT_VARIABLE_ORDER)
  })
})
