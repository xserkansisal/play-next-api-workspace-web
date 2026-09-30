import { describe, expect, it } from 'vitest'

import { describeMissingVariables, diagnoseMissingVariables } from '@/lib/variable-diagnostics'
import type { EnvironmentResource } from '@/lib/workspace-types'

function environment(id: string, name: string, variables: [string, string, boolean][]): EnvironmentResource {
  return { id, name, variables: variables.map(([key, value, enabled]) => ({ key, value, enabled })) }
}

const local = environment('e1', 'localhost-develop', [
  ['url', 'http://localhost', true],
  ['retired', 'old', false],
])
const staging = environment('e2', 'staging', [['token', 'abc', true]])

describe('diagnoseMissingVariables', () => {
  it('reports a variable defined nowhere as undefined', () => {
    const [entry] = diagnoseMissingVariables(['nope'], [local, staging], 'e1')
    expect(entry).toEqual({ name: 'nope', reason: 'undefined', definedIn: [] })
  })

  it('distinguishes a variable that exists here but is switched off', () => {
    const [entry] = diagnoseMissingVariables(['retired'], [local, staging], 'e1')
    expect(entry).toEqual({ name: 'retired', reason: 'disabled-here', definedIn: ['localhost-develop'] })
  })

  it('names the environment that does define it when another one is selected', () => {
    const [entry] = diagnoseMissingVariables(['token'], [local, staging], 'e1')
    expect(entry).toEqual({ name: 'token', reason: 'in-other-environment', definedIn: ['staging'] })
  })

  it('reports that no environment is selected rather than blaming a selection that does not exist', () => {
    const [entry] = diagnoseMissingVariables(['url'], [local, staging], '')
    expect(entry).toEqual({ name: 'url', reason: 'no-environment', definedIn: ['localhost-develop'] })
  })

  it('still reports undefined when nothing defines it and no environment is selected', () => {
    const [entry] = diagnoseMissingVariables(['ghost'], [local, staging], '')
    expect(entry.reason).toBe('undefined')
  })

  it('does not treat a disabled variable in another environment as available there', () => {
    const [entry] = diagnoseMissingVariables(['retired'], [local, staging], 'e2')
    expect(entry.reason).toBe('undefined')
  })
})

describe('describeMissingVariables', () => {
  it('tells the user to pick an environment instead of pointing at a selection that is not set', () => {
    const message = describeMissingVariables(diagnoseMissingVariables(['url'], [local], ''))
    expect(message).toContain('no environment is selected')
    expect(message).toContain('"localhost-develop"')
    expect(message).not.toContain('the selected environment')
  })

  it('points at the environment that has the value', () => {
    const message = describeMissingVariables(diagnoseMissingVariables(['token'], [local, staging], 'e1'))
    expect(message).toContain('defined in "staging"')
    expect(message).toContain('Switch environment')
  })

  it('says a variable is switched off rather than missing', () => {
    const message = describeMissingVariables(diagnoseMissingVariables(['retired'], [local], 'e1'))
    expect(message).toContain('switched off')
  })

  it('reproduces the real failure: two variables absent from a 64-variable environment', () => {
    const real = environment('e1', 'localhost-develop', [
      ['url', 'http://localhost', true],
      ['underwater-name', 'underwater', true],
    ])
    const message = describeMissingVariables(
      diagnoseMissingVariables(['allways-slot-it-name', 'allways-slot-it-port'], [real], 'e1'),
    )
    expect(message).toContain('{{allways-slot-it-name}}, {{allways-slot-it-port}}')
    expect(message).toContain('not defined in any environment')
    expect(message).toContain('Request was not sent.')
  })

  it('groups several different reasons into one readable message', () => {
    const message = describeMissingVariables(
      diagnoseMissingVariables(['retired', 'token', 'ghost'], [local, staging], 'e1'),
    )
    expect(message).toContain('switched off')
    expect(message).toContain('defined in "staging"')
    expect(message).toContain('not defined in any environment')
    expect(message.endsWith('Request was not sent.')).toBe(true)
  })

  it('uses singular wording for one variable and plural for several', () => {
    const one = describeMissingVariables(diagnoseMissingVariables(['ghost'], [local], 'e1'))
    expect(one).toContain('is not defined in any environment')
    const many = describeMissingVariables(diagnoseMissingVariables(['ghost', 'spirit'], [local], 'e1'))
    expect(many).toContain('are not defined in any environment')
  })
})
