import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { VariableInput, VariableTextarea, type VariableLookup } from '@/components/VariableInput'

describe('VariableInput', () => {
  it('marks defined and undefined references differently', () => {
    const { container } = render(
      <VariableInput aria-label="URL" value="{{baseUrl}}/users/{{userId}}" onChange={() => {}}
        variables={{ baseUrl: { value: 'https://api.test', origin: 'environment', shadowed: [] } }} />,
    )
    expect(container.querySelector('.var-token.found')?.textContent).toBe('{{baseUrl}}')
    expect(container.querySelector('.var-token.missing')?.textContent).toBe('{{userId}}')
    const input = screen.getByLabelText('URL')
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

  it('also works in the raw body textarea', async () => {
    const user = userEvent.setup()
    render(<Controlled textarea />)
    const body = screen.getByLabelText('Body')
    await user.type(body, 'token={{{{auth')
    await user.keyboard('{Tab}')
    expect(body).toHaveValue('token={{authToken}}')
  })
})
