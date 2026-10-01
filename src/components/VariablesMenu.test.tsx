import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VariablesMenu } from '@/components/VariablesMenu'
import { workspaceApi } from '@/lib/api'
import { resetScopedVariables } from '@/lib/scoped-variables'
import type { VariableResolution } from '@/lib/variable-scopes'

const resolved: Record<string, VariableResolution> = {
  alpha: { value: 'first', origin: 'user', shadowed: [] },
  beta: { value: 'second', origin: 'environment', shadowed: [] },
  gamma: { value: 'third', origin: 'global', shadowed: [] },
}

function renderMenu(variables = resolved) {
  return render(<VariablesMenu resolved={variables} hasEnvironment />)
}

async function visibleRows() {
  await screen.findByRole('row', { name: /alpha/ })
  return screen.getAllByRole('row').slice(1)
}

async function expectOrder(names: string[]) {
  await waitFor(async () => {
    expect((await visibleRows()).map((row) => row.querySelector('code')?.textContent)).toEqual(names.map((name) => `{{${name}}}`))
  })
}

beforeEach(() => {
  resetScopedVariables()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(workspaceApi, 'variableOrder').mockResolvedValue(['alpha', 'beta', 'gamma'])
  vi.spyOn(workspaceApi, 'setVariableOrder').mockImplementation(async (order) => order)
  vi.spyOn(workspaceApi, 'setVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
  vi.spyOn(workspaceApi, 'deleteVariable').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('VariablesMenu', () => {
  it('creates personal variables after validating their names', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: /add personal variable/i }))
    await user.type(screen.getByRole('textbox', { name: 'Personal variable name' }), 'newToken')
    await user.type(screen.getByRole('textbox', { name: 'Personal variable value' }), 'secret')
    await user.click(within(screen.getByRole('form', { name: 'Create personal variable' })).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(workspaceApi.setVariable).toHaveBeenCalledWith('user', 'newToken', 'secret'))
    expect(screen.queryByRole('textbox', { name: 'Personal variable name' })).not.toBeInTheDocument()
  })

  it('shows validation and save failures rather than losing the entered value silently', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: /add personal variable/i }))
    await user.type(screen.getByRole('textbox', { name: 'Personal variable name' }), 'not valid')
    await user.click(within(screen.getByRole('form', { name: 'Create personal variable' })).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot contain spaces/)

    await user.clear(screen.getByRole('textbox', { name: 'Personal variable name' }))
    await user.type(screen.getByRole('textbox', { name: 'Personal variable name' }), 'good')
    vi.mocked(workspaceApi.setVariable).mockRejectedValueOnce(new Error('offline'))
    await user.click(within(screen.getByRole('form', { name: 'Create personal variable' })).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    expect(screen.getByRole('textbox', { name: 'Personal variable name' })).toHaveValue('good')
  })

  it('edits and removes existing personal values', async () => {
    const user = userEvent.setup()
    renderMenu()
    const value = await screen.findByRole('textbox', { name: 'Value for alpha' })
    await user.clear(value)
    await user.type(value, 'updated')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(workspaceApi.setVariable).toHaveBeenCalledWith('user', 'alpha', 'updated'))
    await user.click(screen.getByRole('button', { name: 'Remove alpha' }))
    await waitFor(() => expect(workspaceApi.deleteVariable).toHaveBeenCalledWith('user', 'alpha'))
  })

  it.each([
    ['up', 'Move gamma up', ['alpha', 'gamma', 'beta']],
    ['down', 'Move alpha down', ['beta', 'alpha', 'gamma']],
    ['top', 'Move gamma to top', ['gamma', 'alpha', 'beta']],
    ['bottom', 'Move alpha to bottom', ['beta', 'gamma', 'alpha']],
  ])('reorders by the %s control and persists the full visible order', async (_direction, buttonName, expected) => {
    const user = userEvent.setup()
    renderMenu()
    await visibleRows()
    await user.click(screen.getByRole('button', { name: buttonName }))
    await expectOrder(expected)
    await waitFor(() => expect(workspaceApi.setVariableOrder).toHaveBeenLastCalledWith(expected))
  })

  it('supports drag-and-drop reordering in the merged user/environment/global list', async () => {
    renderMenu()
    const rows = await visibleRows()
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn(() => 'gamma') }
    fireEvent.dragStart(rows[2]!, { dataTransfer })
    fireEvent.dragOver(rows[0]!, { dataTransfer })
    fireEvent.drop(rows[0]!, { dataTransfer })
    await expectOrder(['gamma', 'alpha', 'beta'])
    await waitFor(() => expect(workspaceApi.setVariableOrder).toHaveBeenLastCalledWith(['gamma', 'alpha', 'beta']))
  })

  it('exposes keyboard-operable reorder controls and a labelled drag handle', async () => {
    const user = userEvent.setup()
    renderMenu()
    await visibleRows()
    const moveDown = screen.getByRole('button', { name: 'Move alpha down' })
    moveDown.focus()
    await user.keyboard('{Enter}')
    await expectOrder(['beta', 'alpha', 'gamma'])
    expect(screen.getByRole('button', { name: 'Drag alpha to reorder' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
  })

  it('surfaces an account-order save failure', async () => {
    const user = userEvent.setup()
    vi.mocked(workspaceApi.setVariableOrder).mockRejectedValueOnce(new Error('order offline'))
    renderMenu()
    await visibleRows()
    await user.click(screen.getByRole('button', { name: 'Move gamma to top' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('order offline')
  })

  it('does not enable reordering if the account order cannot be loaded', async () => {
    vi.mocked(workspaceApi.variableOrder).mockRejectedValueOnce(new Error('order unavailable'))
    const user = userEvent.setup()
    renderMenu()
    await visibleRows()
    expect(await screen.findByRole('alert')).toHaveTextContent('order unavailable')
    const moveButton = screen.getByRole('button', { name: 'Move alpha down' })
    expect(moveButton).toBeDisabled()
    await user.click(moveButton)
    expect(workspaceApi.setVariableOrder).not.toHaveBeenCalled()
  })

  it('retains names from the stored order even when only a subset is currently visible', async () => {
    vi.mocked(workspaceApi.variableOrder).mockResolvedValue(['alpha', 'legacy', 'gamma'])
    const user = userEvent.setup()
    renderMenu({ alpha: resolved.alpha!, gamma: resolved.gamma! })
    await visibleRows()
    await user.click(screen.getByRole('button', { name: 'Move gamma to top' }))
    await waitFor(() => expect(workspaceApi.setVariableOrder).toHaveBeenLastCalledWith(['gamma', 'legacy', 'alpha']))
  })
})
