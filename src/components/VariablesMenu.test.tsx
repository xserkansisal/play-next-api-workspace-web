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

function renderMenuVariablesByScope(currentResolved: Record<string, VariableResolution>) {
  return {
    user: Object.entries(currentResolved).filter(([, entry]) => entry.origin === 'user').map(([key, entry]) => ({ key, value: entry.value })),
    environment: Object.entries(currentResolved).filter(([, entry]) => entry.origin === 'environment').map(([key, entry]) => ({ key, value: entry.value, enabled: true })),
    global: Object.entries(currentResolved).filter(([, entry]) => entry.origin === 'global').map(([key, entry]) => ({ key, value: entry.value })),
  }
}

function renderMenu(props: Partial<Parameters<typeof VariablesMenu>[0]> = {}) {
  const currentResolved = props.resolved ?? resolved
  const variablesByScope = props.variablesByScope ?? renderMenuVariablesByScope(currentResolved)
  return render(
    <VariablesMenu resolved={currentResolved} variablesByScope={variablesByScope} hasEnvironment environmentId="env-1"
      onAddEnvironmentVariable={vi.fn()} onEditEnvironmentVariable={vi.fn()} onRemoveEnvironmentVariable={vi.fn()} {...props} />,
  )
}

function userRows() {
  const group = screen.getByText('Only me').closest('.runtime-vars-group') as HTMLElement
  return within(group).getAllByRole('row').slice(1).map((row) => row.querySelector('code')?.textContent)
}

describe('VariablesMenu standalone scope detail', () => {
  it('shows the selected scope context and a filtered count', () => {
    renderMenu({ standalone: true, selectedOrigin: 'environment', filter: 'host' })

    expect(screen.getByRole('heading', { name: 'Environments' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '1 variable defined, 1 usable in requests' })).toBeInTheDocument()
    expect(screen.getAllByText('Environments')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Add variable' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'New Environments variable' })).toBeNull()
    expect(document.querySelector('.standalone-variables details.runtime-vars-group')).toBeNull()
    expect(document.querySelector('.standalone-variables .runtime-vars-group-standalone')).toBeInTheDocument()
    expect(screen.getByText('host')).toBeInTheDocument()
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    const guidance = document.querySelector('.variables-guidance') as HTMLElement
    expect(guidance.closest('.variables-detail-header')).toBeInTheDocument()
    expect(guidance.querySelectorAll('.variables-guidance-item')).toHaveLength(2)
    expect(document.querySelectorAll('.standalone-variables .runtime-vars-order-status')).toHaveLength(0)
    const table = document.querySelector('.runtime-vars-table') as HTMLElement
    expect(guidance.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps overridden definitions visible and explains that they cannot be used by requests', () => {
    renderMenu({
      standalone: true,
      selectedOrigin: 'global',
      resolved: {
        shared: { value: 'personal', origin: 'user', shadowed: ['global'] },
        one: { value: '1', origin: 'global', shadowed: [] },
        two: { value: '2', origin: 'global', shadowed: [] },
        three: { value: '3', origin: 'global', shadowed: [] },
      },
      variablesByScope: {
        user: [{ key: 'shared', value: 'personal' }],
        environment: [],
        global: [
          { key: 'shared', value: 'default' },
          { key: 'one', value: '1' },
          { key: 'two', value: '2' },
          { key: 'three', value: '3' },
        ],
      },
    })

    expect(screen.getByRole('group', { name: '4 variables defined, 3 usable in requests' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Overridden by Only me' })).toBeInTheDocument()
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('counts disabled environment values separately from overridden values', () => {
    renderMenu({
      standalone: true,
      selectedOrigin: 'environment',
      resolved: {
        off: { value: 'global value', origin: 'global', shadowed: [] },
        ready: { value: 'active value', origin: 'environment', shadowed: [] },
      },
      variablesByScope: {
        user: [],
        environment: [
          { key: 'off', value: 'disabled value', enabled: false },
          { key: 'ready', value: 'active value', enabled: true },
        ],
        global: [{ key: 'off', value: 'global value' }],
      },
    })

    expect(screen.getByRole('group', { name: '2 variables defined, 1 usable in requests' })).toBeInTheDocument()
    expect(screen.getByText('1 disabled')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Disabled' })).toBeInTheDocument()
    expect(screen.queryByText('Overridden by Team')).toBeNull()
    expect(screen.queryByText('1 overridden')).toBeNull()
  })
})

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

    const valueHeader = within(screen.getByText('Only me').closest('.runtime-vars-group')!).getByRole('button', { name: /Value/ })
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
    expect(within(screen.getByText('Only me').closest('.runtime-vars-group')!).getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
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

  describe('VariablesMenu filtering', () => {
    it('opens in the tree and shows variables matching either key or value', () => {
      const { container, rerender } = renderMenu({ filter: '2' })

      expect(container.querySelector('.sidebar-variables')).toHaveAttribute('open')
      expect(screen.getByText('gamma')).toBeInTheDocument()
      expect(screen.queryByText('alpha')).not.toBeInTheDocument()

      rerender(
        <VariablesMenu resolved={resolved} variablesByScope={renderMenuVariablesByScope(resolved)} hasEnvironment environmentId="env-1" filter="host"
          onAddEnvironmentVariable={vi.fn()} onEditEnvironmentVariable={vi.fn()} onRemoveEnvironmentVariable={vi.fn()} />,
      )
      expect(screen.getByText('host')).toBeInTheDocument()
      expect(screen.queryByText('gamma')).not.toBeInTheDocument()
    })

    it('reports when the shared search has no variable matches', () => {
      renderMenu({ filter: 'missing' })
      expect(screen.getByText('No matching variables.')).toBeInTheDocument()
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('adds one of my variables through the API', async () => {
    const createVariable = vi.spyOn(workspaceApi, 'createVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'New Only me variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Only me variable key' }), 'apiKey')
    await user.type(screen.getByRole('textbox', { name: 'New Only me variable value' }), 'secret{Enter}')
    expect(createVariable).toHaveBeenCalledWith('user', 'apiKey', 'secret')
    expect(screen.queryByRole('textbox', { name: 'New Only me variable key' })).toBeNull()
  })

  it('prefills the new-variable row when opened from autocomplete', () => {
    const handled = vi.fn()
    renderMenu({ standalone: true, selectedOrigin: 'user', initialAddKey: 'newToken', onInitialAddHandled: handled })
    expect(screen.getByRole('textbox', { name: 'New Only me variable key' })).toHaveValue('newToken')
    expect(handled).toHaveBeenCalledOnce()
  })

  it('adds an environment variable through the environment handler, even to an empty group', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderMenu({ resolved: {}, onAddEnvironmentVariable: onAdd })
    await user.click(screen.getByRole('button', { name: 'New Environments variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Environments variable key' }), 'host')
    await user.click(screen.getByRole('button', { name: 'Add Environments variable' }))
    expect(onAdd).toHaveBeenCalledWith('host', '')
  })

  it('rejects an invalid key without calling the API, and cannot add to an environment that is not selected', async () => {
    const setVariable = vi.spyOn(workspaceApi, 'setVariable')
    const user = userEvent.setup()
    renderMenu({ environmentId: null })
    expect(screen.getByRole('button', { name: 'New Environments variable' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'New Team variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Team variable key' }), 'has space{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('cannot contain spaces')
    expect(setVariable).not.toHaveBeenCalled()
  })

  it('says when a new value is overridden by a higher-priority scope', async () => {
    vi.spyOn(workspaceApi, 'createVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'New Team variable' }))
    await user.type(screen.getByRole('textbox', { name: 'New Team variable key' }), 'host{Enter}')
    expect(await screen.findByText(/Added "host", but the selected environment takes precedence/)).toBeTruthy()
  })
})
