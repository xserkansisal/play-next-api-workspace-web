import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { workspaceApi } from '@/lib/api'
import {
  getScopedVariables,
  loadScopedVariables,
  migrateLegacyRuntimeVariables,
  removeScopedVariable,
  resetScopedVariables,
  saveScopedVariable,
} from '@/lib/scoped-variables'

const LEGACY_KEY = 'play-next-api-workspace.runtime-variables.v1'

beforeEach(() => {
  window.sessionStorage.clear()
  resetScopedVariables()
  vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
  vi.spyOn(workspaceApi, 'setVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
  vi.spyOn(workspaceApi, 'deleteVariable').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveScopedVariable', () => {
  it('shows the value immediately and keeps what the server confirmed', async () => {
    await saveScopedVariable('user', 'token', 'abc')
    expect(getScopedVariables()).toEqual([{ scope: 'user', key: 'token', value: 'abc' }])
  })

  it('rolls back and rethrows a rejected write instead of leaving a value that was never saved', async () => {
    await saveScopedVariable('user', 'token', 'first')
    vi.spyOn(workspaceApi, 'setVariable').mockRejectedValue(new Error('nope'))

    await expect(saveScopedVariable('user', 'token', 'second')).rejects.toThrow('nope')
    // The previous value survives: the caller is told, and the next request keeps sending what
    // was actually stored rather than something the server never accepted.
    expect(getScopedVariables()).toEqual([{ scope: 'user', key: 'token', value: 'first' }])
  })

  it('replaces the same key at the same scope but leaves the other scope alone', async () => {
    await saveScopedVariable('user', 'token', 'mine')
    await saveScopedVariable('global', 'token', 'shared')
    await saveScopedVariable('user', 'token', 'mine-2')

    expect(getScopedVariables()).toEqual([
      { scope: 'global', key: 'token', value: 'shared' },
      { scope: 'user', key: 'token', value: 'mine-2' },
    ])
  })
})

describe('removeScopedVariable', () => {
  it('removes one scope only', async () => {
    await saveScopedVariable('user', 'token', 'mine')
    await saveScopedVariable('global', 'token', 'shared')

    await removeScopedVariable('user', 'token')

    expect(getScopedVariables()).toEqual([{ scope: 'global', key: 'token', value: 'shared' }])
  })

  it('restores the value when the server refuses', async () => {
    await saveScopedVariable('user', 'token', 'mine')
    vi.spyOn(workspaceApi, 'deleteVariable').mockRejectedValue(new Error('nope'))

    await expect(removeScopedVariable('user', 'token')).rejects.toThrow('nope')
    expect(getScopedVariables()).toEqual([{ scope: 'user', key: 'token', value: 'mine' }])
  })
})

describe('migrateLegacyRuntimeVariables', () => {
  it('carries a tab\'s old per-tab values up to the account and clears them', async () => {
    window.sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ token: 'abc', mathState: '{"spin":1}' }))

    await loadScopedVariables()

    expect(workspaceApi.setVariable).toHaveBeenCalledWith('user', 'token', 'abc')
    expect(workspaceApi.setVariable).toHaveBeenCalledWith('user', 'mathState', '{"spin":1}')
    expect(window.sessionStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('never overwrites a value already saved at user scope, which is the newer one', async () => {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([{ scope: 'user', key: 'token', value: 'current' }])
    window.sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ token: 'stale' }))

    await loadScopedVariables()

    expect(workspaceApi.setVariable).not.toHaveBeenCalled()
    expect(getScopedVariables()).toEqual([{ scope: 'user', key: 'token', value: 'current' }])
  })

  it('keeps the old values for another attempt when a write fails, rather than dropping them', async () => {
    window.sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ token: 'abc' }))
    vi.spyOn(workspaceApi, 'setVariable').mockRejectedValue(new Error('offline'))

    await loadScopedVariables()

    expect(window.sessionStorage.getItem(LEGACY_KEY)).not.toBeNull()
  })

  it('ignores a corrupt or absent legacy store without failing the load', async () => {
    window.sessionStorage.setItem(LEGACY_KEY, 'not json')
    await expect(migrateLegacyRuntimeVariables()).resolves.toBeUndefined()

    window.sessionStorage.setItem(LEGACY_KEY, '["an","array"]')
    await expect(migrateLegacyRuntimeVariables()).resolves.toBeUndefined()
  })
})
