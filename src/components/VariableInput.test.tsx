import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VariableInput } from '@/components/VariableInput'

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
