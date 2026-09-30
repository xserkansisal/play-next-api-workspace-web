import { beforeEach, describe, expect, it, vi } from 'vitest'

import { extractFromResponse } from '@/lib/response-extraction'
import {
  applySyncRules,
  clearSyncRules,
  findSyncRule,
  getSyncRules,
  removeSyncRule,
  resetSyncRulesCache,
  rulesForRequest,
  setSyncRule,
  subscribeSyncRules,
} from '@/lib/sync-rules'
import type { ExecutionSuccess } from '@/lib/request-runner'

function response(bodyText: string): ExecutionSuccess {
  return {
    kind: 'success',
    status: 200,
    statusText: 'OK',
    ok: true,
    durationMs: 1,
    sizeBytes: bodyText.length,
    headers: { 'content-type': 'application/json' },
    bodyText,
  }
}

describe('sync rules', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetSyncRulesCache()
  })

  it('starts empty', () => {
    expect(getSyncRules()).toEqual([])
  })

  it('stores and finds a rule for a request', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'gameData.mathState' })
    expect(findSyncRule('req-a', 'mathState')?.path).toBe('gameData.mathState')
    expect(findSyncRule('req-b', 'mathState')).toBeNull()
  })

  it('replaces a rule for the same request and name instead of duplicating it', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'old.path' })
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'new.path' })
    expect(getSyncRules()).toHaveLength(1)
    expect(findSyncRule('req-a', 'mathState')?.path).toBe('new.path')
  })

  it('keeps rules for different requests and names apart', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'a' })
    setSyncRule({ requestKey: 'req-b', name: 'mathState', path: 'b' })
    setSyncRule({ requestKey: 'req-a', name: 'token', path: 'c' })
    expect(rulesForRequest('req-a').map((rule) => rule.name).sort()).toEqual(['mathState', 'token'])
    expect(rulesForRequest('req-b')).toHaveLength(1)
  })

  it('removes a rule without touching the others', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'a' })
    setSyncRule({ requestKey: 'req-a', name: 'token', path: 'c' })
    removeSyncRule('req-a', 'mathState')
    expect(rulesForRequest('req-a').map((rule) => rule.name)).toEqual(['token'])
  })

  it('survives a reload within the tab', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'gameData.mathState' })
    resetSyncRulesCache()
    expect(findSyncRule('req-a', 'mathState')?.path).toBe('gameData.mathState')
  })

  it('ignores malformed stored data rather than throwing', () => {
    window.sessionStorage.setItem('play-next-api-workspace.sync-rules.v1', '{"not":"an array"}')
    resetSyncRulesCache()
    expect(getSyncRules()).toEqual([])

    window.sessionStorage.setItem('play-next-api-workspace.sync-rules.v1', '[{"requestKey":"a"},{"requestKey":"b","name":"n","path":"p"}]')
    resetSyncRulesCache()
    expect(getSyncRules()).toHaveLength(1)
  })

  it('notifies subscribers on change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSyncRules(listener)
    setSyncRule({ requestKey: 'req-a', name: 'x', path: 'y' })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    clearSyncRules()
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('applySyncRules', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetSyncRulesCache()
  })

  it('does nothing when the request has no rules', () => {
    const store = vi.fn()
    expect(applySyncRules('req-a', response('{}'), extractFromResponse, store)).toEqual([])
    expect(store).not.toHaveBeenCalled()
  })

  it('writes the extracted value and reports success', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'gameData.mathState' })
    const store = vi.fn()
    const outcomes = applySyncRules('req-a', response('{"gameData":{"mathState":{"spin":2}}}'), extractFromResponse, store)
    expect(store).toHaveBeenCalledWith('mathState', '{"spin":2}')
    expect(outcomes).toEqual([{ name: 'mathState', path: 'gameData.mathState', ok: true }])
  })

  it('updates on each response, so an advancing value stays current', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'mathState' })
    const store = vi.fn()
    applySyncRules('req-a', response('{"mathState":{"spin":1}}'), extractFromResponse, store)
    applySyncRules('req-a', response('{"mathState":{"spin":2}}'), extractFromResponse, store)
    expect(store).toHaveBeenNthCalledWith(1, 'mathState', '{"spin":1}')
    expect(store).toHaveBeenNthCalledWith(2, 'mathState', '{"spin":2}')
  })

  it('keeps the previous value and reports the error when the path is missing', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'gameData.mathState' })
    const store = vi.fn()
    const outcomes = applySyncRules('req-a', response('{"error":"bad bet"}'), extractFromResponse, store)
    expect(store).not.toHaveBeenCalled()
    expect(outcomes[0].ok).toBe(false)
    expect(outcomes[0].error).toContain('gameData')
  })

  it('applies only the rules bound to the request that responded', () => {
    setSyncRule({ requestKey: 'req-a', name: 'fromA', path: 'v' })
    setSyncRule({ requestKey: 'req-b', name: 'fromB', path: 'v' })
    const store = vi.fn()
    applySyncRules('req-a', response('{"v":1}'), extractFromResponse, store)
    expect(store).toHaveBeenCalledOnce()
    expect(store).toHaveBeenCalledWith('fromA', '1')
  })

  it('runs every rule even when an earlier one fails', () => {
    setSyncRule({ requestKey: 'req-a', name: 'missing', path: 'nope' })
    setSyncRule({ requestKey: 'req-a', name: 'present', path: 'v' })
    const store = vi.fn()
    const outcomes = applySyncRules('req-a', response('{"v":1}'), extractFromResponse, store)
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, true])
    expect(store).toHaveBeenCalledWith('present', '1')
  })
})
