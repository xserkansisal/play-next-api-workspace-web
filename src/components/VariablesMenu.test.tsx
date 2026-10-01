import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VariablesMenu } from '@/components/VariablesMenu'
import { workspaceApi } from '@/lib/api'
import { resetScopedVariables } from '@/lib/scoped-variables'
import { getVariableOrder, resetVariableOrder } from '@/lib/variable-order-storage'
import type { VariableResolution } from '@/lib/variable-scopes'

const resolved: Record<string, VariableResolution> = {
  beta: { value: '1', origin: 'user', shadowed: [] },
  alpha: { value: '3', origin: 'user', shadowed: [] },
  gamma: { value: '2', origin: 'user', shadowed: [] },
  host: { value: 'h', origin: 'environment', shadowed: [] },
}

function renderMenu(props: Partial<Parameters<typeof VariablesMenu>[0]> = {}) {
  return render(
    <VariablesMenu resolved={resolved} hasEnvironment environmentId="env-1"
      onAddEnvironmentVariable={vi.fn()} onEditEnvironmentVariable={vi.fn()} onRemoveEnvironmentVariable={vi.fn()} {...props} />,
  )
}

function userRows() {
  const group = screen.getByText('Only me').closest('details')!
  return within(group).getAllByRole('row').slice(1).map((row) => row.querySelector('code')?.textContent)
}

describe('VariablesMenu ordering', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetVariableOrder()
    vi.spyOn(workspaceApi, 'saveVariableOrderPreferences').mockResolvedValue(null)
  })

  afterEach(() => vi.restoreAllMocks())

  it('sorts by key by default and cycles a column through asc, desc and manual', async () => {
    const user = userEvent.setup()
    renderMenu()
    expect(userRows()).toEqual(['alpha', 'beta', 'gamma'])

    const valueHeader = within(screen.getByText('Only me').closest('details')!).getByRole('button', { name: /Value/ })
    await user.click(valueHeader)
    expect(userRows()).toEqual(['beta', 'gamma', 'alpha'])
    await user.click(valueHeader)
    expect(userRows()).toEqual(['alpha', 'gamma', 'beta'])
    await user.click(valueHeader)
    expect(getVariableOrder().sort).toBeNull()
  })

  it('moves a row from its menu and switches to a manual order saved for the user', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Move gamma' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move to top' }))
    expect(userRows()).toEqual(['gamma', 'alpha', 'beta'])
    expect(getVariableOrder().sort).toBeNull()
    expect(getVariableOrder().manual.user).toEqual(['gamma', 'alpha', 'beta'])
    // The other groups keep what they showed, rather than jumping when the sort switched off.
    expect(getVariableOrder().manual.environments['env-1']).toEqual(['host'])

    await user.click(screen.getByRole('button', { name: 'Move gamma' }))
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    expect(userRows()).toEqual(['alpha', 'gamma', 'beta'])
  })

  it('moves a row with the keyboard on its handle', async () => {
    const user = userEvent.setup()
    renderMenu()
    screen.getByRole('button', { name: 'Reorder alpha' }).focus()
    await user.keyboard('{End}')
    expect(userRows()).toEqual(['beta', 'gamma', 'alpha'])
  })

  it('reorders by drag and drop', () => {
    renderMenu()
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' }
    // jsdom does not carry pointer coordinates on drag events, so this drops on the lower half.
    const target = screen.getByRole('button', { name: 'Reorder gamma' }).closest('tr')!
    target.getBoundingClientRect = () => ({ top: -100, height: 20, bottom: -80, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) })

    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder alpha' }), { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(userRows()).toEqual(['beta', 'gamma', 'alpha'])
    expect(getVariableOrder().manual.user).toEqual(['beta', 'gamma', 'alpha'])
  })
})

describe('VariablesMenu adding', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetVariableOrder()
    resetScopedVariables()
  })

  afterEach(() => vi.restoreAllMocks())

  it('adds one of my variables through the API', async () => {
    const setVariable = vi.spyOn(workspaceApi, 'setVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'New Only me variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Only me variable key' }), 'apiKey')
    await user.type(screen.getByRole('textbox', { name: 'New Only me variable value' }), 'secret{Enter}')
    expect(setVariable).toHaveBeenCalledWith('user', 'apiKey', 'secret')
    expect(screen.queryByRole('textbox', { name: 'New Only me variable key' })).toBeNull()
  })

  it('adds an environment variable through the environment handler, even to an empty group', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderMenu({ resolved: {}, onAddEnvironmentVariable: onAdd })
    await user.click(screen.getByRole('button', { name: 'New Environment variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Environment variable key' }), 'host')
    await user.click(screen.getByRole('button', { name: 'Add Environment variable' }))
    expect(onAdd).toHaveBeenCalledWith('host', '')
  })

  it('rejects an invalid key without calling the API, and cannot add to an environment that is not selected', async () => {
    const setVariable = vi.spyOn(workspaceApi, 'setVariable')
    const user = userEvent.setup()
    renderMenu({ environmentId: null })
    expect(screen.getByRole('button', { name: 'New Environment variable' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'New Everyone variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Everyone variable key' }), 'has space{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('cannot contain spaces')
    expect(setVariable).not.toHaveBeenCalled()
  })

  it('says so when the new value is hidden by a narrower definition', async () => {
    vi.spyOn(workspaceApi, 'setVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'New Everyone variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Everyone variable key' }), 'host{Enter}')
    expect(await screen.findByText(/Added "host", but it is also defined in the selected environment/)).toBeTruthy()
  })
})
