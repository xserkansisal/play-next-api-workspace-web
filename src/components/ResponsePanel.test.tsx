import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResponsePanel } from '@/components/ResponsePanel'
import { getRuntimeVariables, resetRuntimeVariablesCache } from '@/lib/runtime-variables'
import { findSyncRule, resetSyncRulesCache, setSyncRule } from '@/lib/sync-rules'
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

describe('ResponsePanel server retry', () => {
  const failure = { sentAt: '2026-01-01T00:00:00.000Z', url: 'http://localhost:7799/a', result: { kind: 'failure' as const, message: 'blocked', durationMs: 1, corsBlocked: true } }

  it('offers the retry only when the caller supplies it', () => {
    const { rerender } = render(<ResponsePanel sending={false} response={failure} />)
    expect(screen.queryByRole('button', { name: /send from the server instead/i })).toBeNull()
    rerender(<ResponsePanel sending={false} response={failure} onRetryFromServer={() => {}} />)
    expect(screen.getByRole('button', { name: /send from the server instead/i })).toBeTruthy()
  })

  it('invokes the retry when clicked', async () => {
    const onRetryFromServer = vi.fn()
    render(<ResponsePanel sending={false} response={failure} onRetryFromServer={onRetryFromServer} />)
    await userEvent.click(screen.getByRole('button', { name: /send from the server instead/i }))
    expect(onRetryFromServer).toHaveBeenCalledOnce()
  })
})

describe('ResponsePanel sync control', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetRuntimeVariablesCache()
    resetSyncRulesCache()
  })

  const jsonResponse = (body: string): RecordedResponse => ({
    sentAt: '2026-01-01T00:00:00.000Z',
    result: {
      kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 1,
      sizeBytes: body.length, headers: { 'content-type': 'application/json' }, bodyText: body,
    },
  })

  async function saveVariable(name: string, path: string) {
    await userEvent.click(screen.getByRole('button', { name: /save a value as a variable/i }))
    await userEvent.type(screen.getByLabelText('Variable name'), name)
    await userEvent.type(screen.getByLabelText('Value path'), path)
    await userEvent.click(screen.getByRole('button', { name: 'Save variable' }))
  }

  it('saves a whole object as JSON', async () => {
    render(<ResponsePanel sending={false} response={jsonResponse('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    await saveVariable('mathState', 'mathState')
    expect(getRuntimeVariables().mathState).toBe('{"spin":1}')
  })

  it('offers no sync control until a variable is saved', async () => {
    render(<ResponsePanel sending={false} response={jsonResponse('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    await userEvent.click(screen.getByRole('button', { name: /save a value as a variable/i }))
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('creates a rule bound to this request when sync is switched on', async () => {
    render(<ResponsePanel sending={false} response={jsonResponse('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    await saveVariable('mathState', 'mathState')
    await userEvent.click(screen.getByRole('checkbox'))
    expect(findSyncRule('req-a', 'mathState')).toEqual({ requestKey: 'req-a', name: 'mathState', path: 'mathState' })
    expect(findSyncRule('req-b', 'mathState')).toBeNull()
  })

  it('removes the rule when sync is switched off', async () => {
    render(<ResponsePanel sending={false} response={jsonResponse('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    await saveVariable('mathState', 'mathState')
    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)
    await userEvent.click(checkbox)
    expect(findSyncRule('req-a', 'mathState')).toBeNull()
  })

  it('offers no sync control when the request cannot be identified', async () => {
    render(<ResponsePanel sending={false} response={jsonResponse('{"mathState":{"spin":1}}')} requestKey={null} />)
    await saveVariable('mathState', 'mathState')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reports a failed sync instead of leaving a stale value unexplained', () => {
    const response: RecordedResponse = {
      ...jsonResponse('{"error":"bad bet"}'),
      syncOutcomes: [{ name: 'mathState', path: 'gameData.mathState', ok: false, error: 'no "gameData" field.' }],
    }
    render(<ResponsePanel sending={false} response={response} requestKey="req-a" />)
    expect(screen.getByRole('alert').textContent).toContain('Sync failed for {{mathState}}')
    expect(screen.getByRole('alert').textContent).toContain('may now be stale')
  })

  it('confirms a successful sync', () => {
    const response: RecordedResponse = {
      ...jsonResponse('{"mathState":{"spin":2}}'),
      syncOutcomes: [{ name: 'mathState', path: 'mathState', ok: true }],
    }
    render(<ResponsePanel sending={false} response={response} requestKey="req-a" />)
    expect(screen.getByText(/Synced \{\{mathState\}\} from this response/)).toBeTruthy()
  })
})

describe('ResponsePanel sync survives a send', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetRuntimeVariablesCache()
    resetSyncRulesCache()
  })

  const ok = (body: string): RecordedResponse => ({
    sentAt: '2026-01-01T00:00:00.000Z',
    result: {
      kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 1,
      sizeBytes: body.length, headers: { 'content-type': 'application/json' }, bodyText: body,
    },
  })

  it('can still be switched off after a send collapses the panel', async () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'mathState' })
    // A send swaps the panel for its sending branch, which unmounts the extract form entirely.
    const { rerender } = render(<ResponsePanel sending={false} response={ok('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    rerender(<ResponsePanel sending response={ok('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    rerender(<ResponsePanel sending={false} response={ok('{"mathState":{"spin":2}}')} requestKey="req-a" />)

    const stop = screen.getByRole('button', { name: 'Stop syncing mathState' })
    await userEvent.click(stop)
    expect(findSyncRule('req-a', 'mathState')).toBeNull()
  })

  it('lists the active rule with its path even before anything is saved in this panel', () => {
    setSyncRule({ requestKey: 'req-a', name: 'mathState', path: 'gameData.mathState' })
    render(<ResponsePanel sending={false} response={ok('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    expect(screen.getByText('gameData.mathState')).toBeTruthy()
  })

  it('does not list rules belonging to another request', () => {
    setSyncRule({ requestKey: 'req-b', name: 'other', path: 'x' })
    render(<ResponsePanel sending={false} response={ok('{}')} requestKey="req-a" />)
    expect(screen.queryByRole('button', { name: /stop syncing/i })).toBeNull()
  })
})
