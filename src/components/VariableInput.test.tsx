import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { VariableCreationContext, type VariableCreationContextValue } from '@/components/VariableAutocomplete'
import { VariableInput, VariableTextarea, type VariableLookup } from '@/components/VariableInput'

describe('VariableInput', () => {
  it('marks defined and undefined references differently', () => {
    const { container } = render(
      <VariableInput aria-label="URL" value="{{baseUrl}}/users/{{userId}}" onChange={() => {}}
        variables={{ baseUrl: { value: 'https://api.test', origin: 'environment', shadowed: [] } }} />,
    )
    expect(container.querySelector('.var-token.found')?.textContent).toBe('{{baseUrl}}')
    expect(container.querySelector('.var-token.missing')?.textContent).toBe('{{userId}}')
    const input = screen.getByLabelText<HTMLInputElement>('URL')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('title')).toContain('{{userId}} is not defined')
    expect(input.getAttribute('title')).toContain('{{baseUrl}} = https://api.test')
  })
})

const lookup: VariableLookup = {
  baseUrl: { value: 'https://api.test', origin: 'environment', shadowed: [] },
  tenantId: { value: 'acme', origin: 'environment', shadowed: [] },
  authToken: { value: 'secret-value', origin: 'user', shadowed: ['environment'] },
}

function Controlled({ initial = '', textarea = false }: { initial?: string; textarea?: boolean }) {
  const [value, setValue] = useState(initial)
  return textarea
    ? <VariableTextarea aria-label="Body" value={value} variables={lookup} onChange={(event) => setValue(event.target.value)} />
    : <VariableInput aria-label="URL" value={value} variables={lookup} onChange={(event) => setValue(event.target.value)} />
}

describe('VariableInput autocomplete', () => {
  it('opens the variable list after typing {{ and inserts the chosen one with Enter', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const input = screen.getByLabelText('URL')
    await user.type(input, '{{{{baseUrl}}/{{{{')
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('authToken'),
      expect.stringContaining('baseUrl'),
      expect.stringContaining('tenantId'),
    ])
    expect(screen.getByRole('listbox')).not.toHaveTextContent('secret-value')
    await user.type(input, 'ten')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('{{baseUrl}}/{{tenantId}}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('navigates with arrow keys, picks with a click and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const input = screen.getByLabelText('URL')
    await user.type(input, '{{{{')
    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.type(input, ' {{{{')
    await user.click(screen.getByRole('option', { name: /baseUrl/ }))
    expect(input).toHaveValue('{{ {{baseUrl}}')
  })

  it('explains when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    await user.type(screen.getByLabelText('URL'), '{{{{nope')
    expect(screen.getByRole('status')).toHaveTextContent('{{nope}} is not defined')
  })

  it('offers to create an unmatched variable in each available scope', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const creation: VariableCreationContextValue = {
      options: [
        { origin: 'user', label: 'Only me' },
        { origin: 'environment', label: 'Development' },
        { origin: 'global', label: 'Everyone' },
      ],
      onCreate,
    }
    render(
      <VariableCreationContext.Provider value={creation}>
        <Controlled />
      </VariableCreationContext.Provider>,
    )
    await user.type(screen.getByLabelText('URL'), '{{{{newToken')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Create “newToken” in Only me'),
      expect.stringContaining('Create “newToken” in Development'),
      expect.stringContaining('Create “newToken” in Everyone'),
    ])
    await user.click(screen.getByRole('option', { name: /Create “newToken” in Development/ }))
    expect(onCreate).toHaveBeenCalledWith('newToken', 'environment')
    expect(screen.getByLabelText('URL')).toHaveValue('{{newToken}}')
  })

  it('uses arrow navigation and Enter to choose a variable creation scope', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const creation: VariableCreationContextValue = {
      options: [
        { origin: 'user', label: 'Only me' },
        { origin: 'global', label: 'Everyone' },
      ],
      onCreate,
    }
    render(
      <VariableCreationContext.Provider value={creation}>
        <Controlled />
      </VariableCreationContext.Provider>,
    )
    await user.type(screen.getByLabelText('URL'), '{{{{newToken')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onCreate).toHaveBeenCalledWith('newToken', 'global')
  })

  it('uses the whole closed variable name when the caret is in its middle', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const creation: VariableCreationContextValue = {
      options: [{ origin: 'user', label: 'Only me' }],
      onCreate,
    }
    render(
      <VariableCreationContext.Provider value={creation}>
        <Controlled initial="{{next-url}}" />
      </VariableCreationContext.Provider>,
    )
    const input = screen.getByLabelText<HTMLInputElement>('URL')
    await user.click(input)
    input.setSelectionRange(7, 7)
    fireEvent.select(input)
    expect(screen.getByRole('option', { name: /Create “next-url” in Only me/ })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onCreate).toHaveBeenCalledWith('next-url', 'user')
    expect(input).toHaveValue('{{next-url}}')
  })

  it('also works in the raw body textarea', async () => {
    const user = userEvent.setup()
    render(<Controlled textarea />)
    const body = screen.getByLabelText('Body')
    await user.type(body, 'token={{{{auth')
    await user.keyboard('{Tab}')
    expect(body).toHaveValue('token={{authToken}}')
  })
})
