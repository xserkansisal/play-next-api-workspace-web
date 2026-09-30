import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadRunnerId, saveRunnerId } from '@/lib/runner-storage'

const KEY = 'play-next-api-workspace.request-runner.v1'

describe('runner storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to the browser when nothing is stored', () => {
    expect(loadRunnerId()).toBe('browser')
  })

  it('restores a saved choice', () => {
    saveRunnerId('server')
    expect(loadRunnerId()).toBe('server')
  })

  it('stores nothing for the default, so a future default change can still reach the user', () => {
    saveRunnerId('server')
    saveRunnerId('browser')
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(loadRunnerId()).toBe('browser')
  })

  it('ignores a stored value that is not a known runner', () => {
    window.localStorage.setItem(KEY, 'carrier-pigeon')
    expect(loadRunnerId()).toBe('browser')
  })

  it('falls back instead of throwing when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadRunnerId()).toBe('browser')
    expect(() => saveRunnerId('server')).not.toThrow()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
