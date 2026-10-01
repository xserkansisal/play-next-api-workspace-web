import { describe, expect, it } from 'vitest'
import { addEnvironmentVariable, editEnvironmentVariable, removeEnvironmentVariable } from '@/lib/variable-editing'

const rows = [
  { key: 'host', value: 'old', enabled: true },
  { key: 'host', value: 'draft', enabled: false },
  { key: 'token', value: 't', enabled: true },
  { key: 'host', value: 'current', enabled: true },
]

describe('editEnvironmentVariable', () => {
  it('updates the effective row and drops dead enabled duplicates, keeping disabled rows', () => {
    const result = editEnvironmentVariable(rows, 'host', 'host', 'new')
    expect(result).toEqual({ ok: true, variables: [
      { key: 'host', value: 'draft', enabled: false },
      { key: 'token', value: 't', enabled: true },
      { key: 'host', value: 'new', enabled: true },
    ] })
  })

  it('renames a variable', () => {
    const result = editEnvironmentVariable([{ key: 'a', value: '1', enabled: true }], 'a', 'b', '2')
    expect(result).toEqual({ ok: true, variables: [{ key: 'b', value: '2', enabled: true }] })
  })

  it('refuses to rename onto an existing enabled key', () => {
    expect(editEnvironmentVariable(rows, 'host', 'token', 'x')).toEqual({ ok: false, error: '"token" already exists in this environment.' })
  })

  it('reports a key that disappeared', () => {
    expect(editEnvironmentVariable(rows, 'gone', 'gone', 'x').ok).toBe(false)
  })
})

describe('removeEnvironmentVariable', () => {
  it('removes every enabled row with the key but leaves disabled ones', () => {
    expect(removeEnvironmentVariable(rows, 'host')).toEqual({ ok: true, variables: [
      { key: 'host', value: 'draft', enabled: false },
      { key: 'token', value: 't', enabled: true },
    ] })
  })

  it('reports a key that disappeared', () => {
    expect(removeEnvironmentVariable(rows, 'gone').ok).toBe(false)
  })
})

describe('addEnvironmentVariable', () => {
  it('appends an enabled row', () => {
    expect(addEnvironmentVariable(rows, 'port', '80')).toEqual({ ok: true, variables: [...rows, { key: 'port', value: '80', enabled: true }] })
  })

  it('refuses a key that is already enabled, but not one that is only disabled', () => {
    expect(addEnvironmentVariable(rows, 'token', 'x').ok).toBe(false)
    expect(addEnvironmentVariable([{ key: 'k', value: '', enabled: false }], 'k', 'v').ok).toBe(true)
  })
})
