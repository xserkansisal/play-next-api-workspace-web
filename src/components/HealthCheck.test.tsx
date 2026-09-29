import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HealthCheck } from '@/components/HealthCheck'
import { apiClient } from '@/lib/api'

describe('HealthCheck', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading then the healthy response', async () => {
    let resolve!: (value: unknown) => void
    const get = vi.spyOn(apiClient, 'get').mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )

    render(<HealthCheck />)
    await userEvent.click(screen.getByRole('button', { name: /check api health/i }))

    expect(get).toHaveBeenCalledWith('/health', {
      baseURL: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, ''),
    })
    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled()
    expect(screen.getByText(/contacting api/i)).toBeInTheDocument()

    resolve({ data: { status: 'ok' } })

    expect(await screen.findByText(/api is healthy/i)).toBeInTheDocument()
    expect(screen.getByText(/"status": "ok"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check api health/i })).toBeEnabled()
  })

  it('shows an error when the API responds with a failure status', async () => {
    const config = { headers: new AxiosHeaders() }
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, {
        status: 503,
        statusText: 'Service Unavailable',
        data: {},
        headers: {},
        config,
      }),
    )

    render(<HealthCheck />)
    await userEvent.click(screen.getByRole('button', { name: /check api health/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Health check failed: API responded with 503 Service Unavailable',
    )
  })
})
