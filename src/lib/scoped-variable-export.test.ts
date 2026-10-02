import { describe, expect, it } from 'vitest'

import { exportScopedVariables, SCOPED_VARIABLE_EXPORT_FORMAT, SCOPED_VARIABLE_EXPORT_VERSION } from '@/lib/scoped-variable-export'

describe('exportScopedVariables', () => {
  it.each(['user', 'global'] as const)('exports only %s variables with scope and format metadata', (scope) => {
    const exported = exportScopedVariables(scope, [
      { scope: 'user', key: 'personalToken', value: 'mine' },
      { scope: 'global', key: 'sharedUrl', value: 'https://example.com' },
    ])

    expect(exported).toEqual({
      format: SCOPED_VARIABLE_EXPORT_FORMAT,
      version: SCOPED_VARIABLE_EXPORT_VERSION,
      scope,
      variables: scope === 'user'
        ? [{ key: 'personalToken', value: 'mine' }]
        : [{ key: 'sharedUrl', value: 'https://example.com' }],
    })
  })

  it('exports an empty variables array when the selected scope has no values', () => {
    expect(exportScopedVariables('global', [])).toEqual({
      format: SCOPED_VARIABLE_EXPORT_FORMAT,
      version: SCOPED_VARIABLE_EXPORT_VERSION,
      scope: 'global',
      variables: [],
    })
  })
})
