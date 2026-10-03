import { describe, expect, it } from 'vitest'

import {
  describeOrigin,
  resolveVariables,
  shadowedNames,
  toVariableMap,
  validateVariableName,
  VARIABLE_PRECEDENCE,
} from '@/lib/variable-scopes'

describe('resolveVariables', () => {
  it('carries secret metadata only when the effective value comes from a secret environment variable', () => {
    expect(resolveVariables([], [{ key: 'deploymentTarget', value: 'private', enabled: true, isSecret: true }]).deploymentTarget)
      .toMatchObject({ value: 'private', origin: 'environment', isSecret: true })
    expect(resolveVariables(
      [{ scope: 'user', key: 'deploymentTarget', value: 'personal' }],
      [{ key: 'deploymentTarget', value: 'private', enabled: true, isSecret: true }],
    ).deploymentTarget).toMatchObject({ value: 'personal', origin: 'user' })
  })

  it('prefers a personal value over the shared ones, which is the point of capturing it', () => {
    const resolved = resolveVariables(
      [
        { scope: 'user', key: 'token', value: 'mine' },
        { scope: 'global', key: 'token', value: 'shared' },
      ],
      [{ key: 'token', value: 'from-environment', enabled: true }],
    )

    expect(resolved.token).toEqual({ value: 'mine', origin: 'user', shadowed: ['environment', 'global'] })
  })

  it('lets the environment beat a global, matching how Postman resolves an imported collection', () => {
    const resolved = resolveVariables(
      [{ scope: 'global', key: 'baseUrl', value: 'http://global' }],
      [{ key: 'baseUrl', value: 'http://environment', enabled: true }],
    )

    expect(resolved.baseUrl).toEqual({ value: 'http://environment', origin: 'environment', shadowed: ['global'] })
    expect(VARIABLE_PRECEDENCE).toEqual(['user', 'environment', 'global'])
  })

  it('falls through to a global when nothing narrower defines the name', () => {
    const resolved = resolveVariables([{ scope: 'global', key: 'baseUrl', value: 'http://global' }], [])
    expect(resolved.baseUrl).toEqual({ value: 'http://global', origin: 'global', shadowed: [] })
  })

  it('ignores a disabled environment row entirely, so it neither wins nor counts as shadowed', () => {
    const resolved = resolveVariables(
      [{ scope: 'global', key: 'baseUrl', value: 'http://global' }],
      [{ key: 'baseUrl', value: 'http://off', enabled: false }],
    )

    expect(resolved.baseUrl).toEqual({ value: 'http://global', origin: 'global', shadowed: [] })
  })

  it('keeps an empty string, which is a real captured value and not an absence', () => {
    const resolved = resolveVariables([{ scope: 'user', key: 'token', value: '' }], [{ key: 'token', value: 'fallback', enabled: true }])
    expect(resolved.token.value).toBe('')
  })

  it('merges names that exist at only one layer each', () => {
    const resolved = resolveVariables(
      [{ scope: 'user', key: 'token', value: 'abc' }, { scope: 'global', key: 'region', value: 'eu' }],
      [{ key: 'baseUrl', value: 'http://x', enabled: true }],
    )

    expect(toVariableMap(resolved)).toEqual({ token: 'abc', region: 'eu', baseUrl: 'http://x' })
  })

  it('returns nothing for an empty workspace rather than failing', () => {
    expect(resolveVariables([], [])).toEqual({})
    expect(shadowedNames({})).toEqual([])
  })
})

describe('shadowedNames', () => {
  it('lists only the names that are defined more than once', () => {
    const resolved = resolveVariables(
      [
        { scope: 'user', key: 'token', value: 'mine' },
        { scope: 'global', key: 'token', value: 'shared' },
        { scope: 'user', key: 'alone', value: 'x' },
      ],
      [{ key: 'baseUrl', value: 'http://x', enabled: true }],
    )

    expect(shadowedNames(resolved)).toEqual(['token'])
  })
})

describe('describeOrigin', () => {
  it('names each layer in words a user can act on', () => {
    expect(describeOrigin('user')).toBe('your variables')
    expect(describeOrigin('global')).toBe('team variables')
    expect(describeOrigin('environment')).toBe('the selected environment')
  })
})

describe('validateVariableName', () => {
  it('accepts a usable name and trims it', () => {
    expect(validateVariableName('  token ')).toEqual({ ok: true, name: 'token' })
  })

  it('rejects anything that would break the {{name}} reference it is used through', () => {
    expect(validateVariableName('')).toMatchObject({ ok: false })
    expect(validateVariableName('my token')).toMatchObject({ ok: false, error: expect.stringContaining('spaces') })
    expect(validateVariableName('{token}')).toMatchObject({ ok: false, error: expect.stringContaining('{') })
  })
})
