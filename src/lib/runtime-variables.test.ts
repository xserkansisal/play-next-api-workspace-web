import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearRuntimeVariables,
  getRuntimeVariables,
  removeRuntimeVariable,
  resetRuntimeVariablesCache,
  setRuntimeVariable,
  subscribeRuntimeVariables,
  validateVariableName,
} from '@/lib/runtime-variables'

beforeEach(() => {
  window.sessionStorage.clear()
  resetRuntimeVariablesCache()
})

describe('runtime variables', () => {
  it('stores and removes values', () => {
    setRuntimeVariable('token', 'abc')
    setRuntimeVariable('orderId', '7')
    expect(getRuntimeVariables()).toEqual({ token: 'abc', orderId: '7' })

    removeRuntimeVariable('token')
    expect(getRuntimeVariables()).toEqual({ orderId: '7' })

    clearRuntimeVariables()
    expect(getRuntimeVariables()).toEqual({})
  })

  it('persists within the tab via sessionStorage, not localStorage', () => {
    setRuntimeVariable('token', 'abc')
    resetRuntimeVariablesCache()
    expect(getRuntimeVariables()).toEqual({ token: 'abc' })
    expect(window.localStorage.length).toBe(0)
  })

  it('returns a stable snapshot until a write happens', () => {
    const first = getRuntimeVariables()
    expect(getRuntimeVariables()).toBe(first)
    setRuntimeVariable('token', 'abc')
    expect(getRuntimeVariables()).not.toBe(first)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRuntimeVariables(listener)
    setRuntimeVariable('token', 'abc')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setRuntimeVariable('token', 'def')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed stored data rather than throwing', () => {
    window.sessionStorage.setItem('play-next-api-workspace.runtime-variables.v1', '["not","an","object"]')
    resetRuntimeVariablesCache()
    expect(getRuntimeVariables()).toEqual({})
  })

  it('rejects names that could not be referenced as {{name}}', () => {
    expect(validateVariableName('token')).toEqual({ ok: true, name: 'token' })
    expect(validateVariableName('  token  ')).toEqual({ ok: true, name: 'token' })
    expect(validateVariableName('').ok).toBe(false)
    expect(validateVariableName('{{token}}').ok).toBe(false)
    expect(validateVariableName('my token').ok).toBe(false)
  })
})
