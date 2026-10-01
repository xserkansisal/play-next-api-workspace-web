import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AuthEditor } from '@/components/AuthEditor'
import type { RequestAuth, ResourceAuth } from '@/lib/workspace-types'

describe('AuthEditor', () => {
  it('shows the inherit option as the request default and reports a live preview of what it resolves to', () => {
    const onChange = vi.fn()
    render(
      <AuthEditor
        mode="request"
        auth={{ type: 'inherit' }}
        onChange={onChange}
        variables={{}}
        effective={{ auth: { type: 'bearer', token: 'secret' }, source: { kind: 'collection', id: 'c1', name: 'Billing API', auth: { type: 'bearer', token: 'secret' } } }}
      />,
    )
    expect(screen.getByLabelText('Authentication type')).toHaveValue('inherit')
    expect(screen.getByText(/Resolves to: Bearer Token \(from collection "Billing API"\)/)).toBeInTheDocument()
  })

  it('falls back to a "no auth" preview when there is nothing to inherit', () => {
    render(<AuthEditor mode="resource" auth={null} onChange={vi.fn()} variables={{}} />)
    expect(screen.getByText(/Resolves to: No Auth/)).toBeInTheDocument()
  })

  it('switching to Basic Auth shows username/password fields and reports changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AuthEditor mode="request" auth={{ type: 'inherit' }} onChange={onChange} variables={{}} />)
    await user.selectOptions(screen.getByLabelText('Authentication type'), 'basic')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'basic', username: '', password: '' })
  })

  it('edits basic auth username and password fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const auth: RequestAuth = { type: 'basic', username: '', password: '' }
    render(<AuthEditor mode="request" auth={auth} onChange={onChange} variables={{}} />)
    await user.type(screen.getByLabelText('Basic auth username'), 'a')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'basic', username: 'a', password: '' })
  })

  it('switching to Bearer Token shows a token field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const auth: RequestAuth = { type: 'bearer', token: '' }
    render(<AuthEditor mode="request" auth={auth} onChange={onChange} variables={{}} />)
    await user.type(screen.getByLabelText('Bearer token'), 'x')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'bearer', token: 'x' })
  })

  it('switching to API Key shows location/key/value fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const auth: RequestAuth = { type: 'api-key', in: 'header', key: '', value: '' }
    render(<AuthEditor mode="request" auth={auth} onChange={onChange} variables={{}} />)
    await user.selectOptions(screen.getByLabelText('API key location'), 'query')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'api-key', in: 'query', key: '', value: '' })
  })

  it('in resource mode, the inherit option means "no setting of my own" (null)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const auth: ResourceAuth = { type: 'none' }
    render(<AuthEditor mode="resource" auth={auth} onChange={onChange} variables={{}} />)
    await user.selectOptions(screen.getByLabelText('Authentication type'), 'inherit')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('explains that explicit No Auth on a resource stops inheritance below it', () => {
    render(<AuthEditor mode="resource" auth={{ type: 'none' }} onChange={vi.fn()} variables={{}} />)
    expect(screen.getByText(/stops inheritance for anything below it/)).toBeInTheDocument()
  })
})
