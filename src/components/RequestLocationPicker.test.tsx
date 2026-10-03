import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RequestLocationPicker, type RequestLocationOption } from '@/components/RequestLocationPicker'

const locations: RequestLocationOption[] = [
  { value: '["c1",null]', label: 'Commerce API', collectionId: 'c1' },
  { value: '["c1","f1"]', label: 'Commerce API / Orders', collectionId: 'c1', parentId: 'f1' },
  { value: '["c2",null]', label: 'Identity API', collectionId: 'c2' },
]

describe('RequestLocationPicker', () => {
  it('searches destinations and applies the selected location', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RequestLocationPicker options={locations} value='["c1","f1"]' onChange={onChange} />)

    await user.click(screen.getByRole('combobox', { name: 'Request location' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search locations' }), 'identity')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.click(screen.getByRole('option', { name: 'Identity API' }))
    expect(onChange).toHaveBeenCalledWith(locations[2])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps long destination lists inside a bounded popover and dismisses with Escape', async () => {
    const options = Array.from({ length: 100 }, (_, index) => ({
      value: `["c1","f${index}"]`,
      label: `Commerce API / Folder ${index}`,
      collectionId: 'c1',
      parentId: `f${index}`,
    }))
    const user = userEvent.setup()
    render(<RequestLocationPicker options={options} value={options[0]!.value} onChange={vi.fn()} />)

    const trigger = screen.getByRole('combobox', { name: 'Request location' })
    await user.click(trigger)

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('listbox').parentElement).toHaveStyle({ maxHeight: '360px' })
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
