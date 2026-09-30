import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ResponsePanel } from '@/components/ResponsePanel'
import { getRuntimeVariables, resetRuntimeVariablesCache } from '@/lib/runtime-variables'
import type { RecordedResponse } from '@/lib/request-runner'

function recorded(bodyText: string, headers: Record<string, string> = {}): RecordedResponse {
  return {
    sentAt: '2026-01-01T00:00:00.000Z',
    result: { kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 5, sizeBytes: bodyText.length, headers, bodyText },
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  resetRuntimeVariablesCache()
})

describe('ResponsePanel value extraction', () => {
  it('captures a response value as a runtime variable', async () => {
    const user = userEvent.setup()
    render(<ResponsePanel sending={false} response={recorded('{"data":{"accessToken":"abc123"}}')} />)

    await user.click(screen.getByRole('button', { name: 'Save a value as a variable' }))
    await user.type(screen.getByLabelText('Variable name'), 'token')
    await user.type(screen.getByLabelText('Value path'), 'data.accessToken')

    expect(screen.getByText('abc123')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save variable' }))

    expect(getRuntimeVariables()).toEqual({ token: 'abc123' })
    expect(screen.getByRole('status')).toHaveTextContent('Saved as {{token}}')
  })

  it('shows why a path does not resolve and stores nothing', async () => {
    const user = userEvent.setup()
    render(<ResponsePanel sending={false} response={recorded('{"data":{"other":1}}')} />)

    await user.click(screen.getByRole('button', { name: 'Save a value as a variable' }))
    await user.type(screen.getByLabelText('Variable name'), 'token')
    await user.type(screen.getByLabelText('Value path'), 'data.accessToken')

    expect(screen.getByRole('alert')).toHaveTextContent('no "accessToken" field')

    await user.click(screen.getByRole('button', { name: 'Save variable' }))
    expect(getRuntimeVariables()).toEqual({})
  })

  it('rejects a name that could not be referenced as a variable', async () => {
    const user = userEvent.setup()
    render(<ResponsePanel sending={false} response={recorded('{"token":"abc"}')} />)

    await user.click(screen.getByRole('button', { name: 'Save a value as a variable' }))
    await user.type(screen.getByLabelText('Variable name'), 'my token')
    await user.type(screen.getByLabelText('Value path'), 'token')
    await user.click(screen.getByRole('button', { name: 'Save variable' }))

    expect(screen.getByRole('alert')).toHaveTextContent('cannot contain spaces')
    expect(getRuntimeVariables()).toEqual({})
  })

  it('is not offered for a failed request', () => {
    render(<ResponsePanel sending={false} response={{ sentAt: '2026-01-01T00:00:00.000Z', result: { kind: 'failure', message: 'boom', durationMs: 1 } }} />)
    expect(screen.queryByRole('button', { name: 'Save a value as a variable' })).not.toBeInTheDocument()
  })
})
