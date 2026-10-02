import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EnvironmentPicker } from '@/components/EnvironmentPicker'

const environments = [
  { id: 'dev', name: 'Development', variables: [] },
  { id: 'stage', name: 'Staging', variables: [] },
]

describe('EnvironmentPicker', () => {
  it('filters options and applies the selected environment', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<EnvironmentPicker environments={environments} value="dev" onChange={onChange} />)

    await user.click(screen.getByRole('combobox', { name: 'Environment' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search environments' }), 'stag')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.click(screen.getByRole('option', { name: /Staging/ }))
    expect(onChange).toHaveBeenCalledWith('stage')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports keyboard navigation and restores focus when dismissed', async () => {
    const user = userEvent.setup()
    render(<EnvironmentPicker environments={environments} value="dev" onChange={vi.fn()} />)

    const trigger = screen.getByRole('combobox', { name: 'Environment' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')

    const search = screen.getByRole('searchbox', { name: 'Search environments' })
    expect(search).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /No environment/ })).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows a helpful empty state when the search has no matches', async () => {
    const user = userEvent.setup()
    render(<EnvironmentPicker environments={environments} value="" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox', { name: 'Environment' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search environments' }), 'production')

    expect(screen.getByText('No environments match “production”.')).toBeInTheDocument()
  })
})
