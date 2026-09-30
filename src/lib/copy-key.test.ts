import { describe, expect, it } from 'vitest'
import { copyVariableKey, variableKeyStem } from '@/lib/copy-key'

const free = () => false

describe('variableKeyStem', () => {
  it('leaves a key that was never duplicated alone', () => {
    expect(variableKeyStem('baseUrl')).toBe('baseUrl')
    expect(variableKeyStem('copy')).toBe('copy')
  })

  it('strips a trailing marker so duplicating a duplicate does not nest markers', () => {
    expect(variableKeyStem('baseUrl_copy')).toBe('baseUrl')
    expect(variableKeyStem('baseUrl_copy3')).toBe('baseUrl')
  })

  it('keeps a key that is nothing but a marker, since there is no stem under it', () => {
    expect(variableKeyStem('_copy')).toBe('_copy')
  })
})

describe('copyVariableKey', () => {
  it('adds a marker that the key rules allow - no spaces, no braces', () => {
    const key = copyVariableKey('baseUrl', free)
    expect(key).toBe('baseUrl_copy')
    expect(key).toMatch(/^[^\s{}]+$/)
  })

  it('counts up past keys already in the environment', () => {
    const taken = new Set(['baseUrl_copy', 'baseUrl_copy2'])
    expect(copyVariableKey('baseUrl', (candidate) => taken.has(candidate))).toBe('baseUrl_copy3')
  })

  it('counts from the stem when duplicating a duplicate', () => {
    const taken = new Set(['baseUrl', 'baseUrl_copy'])
    expect(copyVariableKey('baseUrl_copy', (candidate) => taken.has(candidate))).toBe('baseUrl_copy2')
  })

  it('leaves a blank key blank rather than inventing one', () => {
    expect(copyVariableKey('', free)).toBe('')
    expect(copyVariableKey('   ', free)).toBe('   ')
  })

  it('stays within the 200 character limit by trimming the stem', () => {
    const key = copyVariableKey('k'.repeat(200), free)
    expect(key.length).toBe(200)
    expect(key.endsWith('_copy')).toBe(true)
  })
})
