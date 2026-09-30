import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResponsePanel } from '@/components/ResponsePanel'
import { workspaceApi } from '@/lib/api'
import { getScopedVariables, resetScopedVariables } from '@/lib/scoped-variables'
import { findSyncRule, resetSyncRulesCache, setSyncRule } from '@/lib/sync-rules'
import type { RecordedResponse } from '@/lib/request-runner'
import type { VariableScope } from '@/lib/variable-scopes'

/** What the store holds, flattened to the shape these assertions care about. */
function stored(): Record<string, { scope: VariableScope; value: string }> {
  return Object.fromEntries(getScopedVariables().map((entry) => [entry.key, { scope: entry.scope, value: entry.value }]))
}

function recorded(bodyText: string, headers: Record<string, string> = {}): RecordedResponse {
  return {
    sentAt: '2026-01-01T00:00:00.000Z',
    result: { kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 5, sizeBytes: bodyText.length, headers, bodyText },
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  resetScopedVariables()
  vi.spyOn(workspaceApi, 'setVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
})

afterEach(() => {
  vi.restoreAllMocks()
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

    // Personal unless the user says otherwise: a captured value is nearly always tied to this
    // person's session, and defaulting to the shared scope would change what teammates send.
    await waitFor(() => expect(stored()).toEqual({ token: { scope: 'user', value: 'abc123' } }))
    expect(workspaceApi.setVariable).toHaveBeenCalledWith('user', 'token', 'abc123')
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
    expect(stored()).toEqual({})
  })

  it('saves to the shared scope when that is chosen', async () => {
    const user = userEvent.setup()
    render(<ResponsePanel sending={false} response={recorded('{"data":{"accessToken":"abc123"}}')} />)

    await user.click(screen.getByRole('button', { name: 'Save a value as a variable' }))
    await user.type(screen.getByLabelText('Variable name'), 'token')
    await user.type(screen.getByLabelText('Value path'), 'data.accessToken')
    await user.selectOptions(screen.getByLabelText('Variable scope'), 'global')
    await user.click(screen.getByRole('button', { name: 'Save variable' }))

    await waitFor(() => expect(stored()).toEqual({ token: { scope: 'global', value: 'abc123' } }))
  })

  it('reports a rejected save instead of confirming one that did not happen', async () => {
    vi.spyOn(workspaceApi, 'setVariable').mockRejectedValue(new Error('API is down'))
    const user = userEvent.setup()
    render(<ResponsePanel sending={false} response={recorded('{"token":"abc"}')} />)

    await user.click(screen.getByRole('button', { name: 'Save a value as a variable' }))
    await user.type(screen.getByLabelText('Variable name'), 'token')
    await user.type(screen.getByLabelText('Value path'), 'token')
    await user.click(screen.getByRole('button', { name: 'Save variable' }))

    // Silently failing would leave the next request sending the previous value with no sign why.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('API is down'))
    expect(stored()).toEqual({})
    expect(screen.queryByText(/Saved as/)).toBeNull()
  })

  it('rejects a name that could not be referenced as a variable', async () => {
    const user = userEvent.setup()
    render(<ResponsePanel sending={false} response={recorded('{"token":"abc"}')} />)

    await user.click(screen.getByRole('button', { name: 'Save a value as a variable' }))
    await user.type(screen.getByLabelText('Variable name'), 'my token')
    await user.type(screen.getByLabelText('Value path'), 'token')
    await user.click(screen.getByRole('button', { name: 'Save variable' }))

    expect(screen.getByRole('alert')).toHaveTextContent('cannot contain spaces')
    expect(stored()).toEqual({})
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
    resetScopedVariables()
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
    await waitFor(() => expect(stored().mathState?.value).toBe('{"spin":1}'))
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
    // The scope is on the rule, so a rule created against the shared variable keeps refreshing
    // that one instead of quietly starting a personal copy that then shadows it.
    expect(findSyncRule('req-a', 'mathState')).toEqual({ requestKey: 'req-a', name: 'mathState', path: 'mathState', scope: 'user' })
    expect(findSyncRule('req-b', 'mathState')).toBeNull()
  })

  it('binds the rule to the scope the variable was saved at', async () => {
    render(<ResponsePanel sending={false} response={jsonResponse('{"mathState":{"spin":1}}')} requestKey="req-a" />)
    await userEvent.click(screen.getByRole('button', { name: /save a value as a variable/i }))
    await userEvent.type(screen.getByLabelText('Variable name'), 'mathState')
    await userEvent.type(screen.getByLabelText('Value path'), 'mathState')
    await userEvent.selectOptions(screen.getByLabelText('Variable scope'), 'global')
    await userEvent.click(screen.getByRole('button', { name: 'Save variable' }))
    await userEvent.click(await screen.findByRole('checkbox'))

    expect(findSyncRule('req-a', 'mathState')?.scope).toBe('global')
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
      syncOutcomes: [{ name: 'mathState', path: 'gameData.mathState', scope: 'user' as const, ok: false, error: 'no "gameData" field.' }],
    }
    render(<ResponsePanel sending={false} response={response} requestKey="req-a" />)
    expect(screen.getByRole('alert').textContent).toContain('Sync failed for {{mathState}}')
    expect(screen.getByRole('alert').textContent).toContain('may now be stale')
  })

  it('confirms a successful sync', () => {
    const response: RecordedResponse = {
      ...jsonResponse('{"mathState":{"spin":2}}'),
      syncOutcomes: [{ name: 'mathState', path: 'mathState', scope: 'user' as const, ok: true }],
    }
    render(<ResponsePanel sending={false} response={response} requestKey="req-a" />)
    expect(screen.getByText(/Synced \{\{mathState\}\} from this response/)).toBeTruthy()
  })
})

describe('ResponsePanel sync survives a send', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetScopedVariables()
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

describe('copying the raw response body', () => {
  const bodyResponse = (body: string, contentType: string): RecordedResponse => ({
    sentAt: '2026-01-01T00:00:00.000Z',
    result: {
      kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 1,
      sizeBytes: body.length, headers: { 'content-type': contentType }, bodyText: body,
    },
  })
  const jsonResponse = (body: string) => bodyResponse(body, 'application/json')
  const textResponse = (body: string) => bodyResponse(body, 'text/plain')

  it('offers a copy button on the Raw view, which the tree does not cover', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    writeText.mockClear()
    render(<ResponsePanel sending={false} response={jsonResponse('{"a":1}')} />)

    // The tree has its own Copy, which follows its filter; the views never show both at once.
    expect(document.querySelector('.response-copy-raw')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Raw' }))
    expect(document.querySelector('.response-copy-raw')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2))
    expect(await screen.findByText('Copied the response body')).toBeInTheDocument()
  })

  it('offers it for a body that is not JSON at all, where there is no tree to copy from', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    writeText.mockClear()
    render(<ResponsePanel sending={false} response={textResponse('plain words')} />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('plain words')
  })

  it('says so when the clipboard refuses, rather than leaving a button that does nothing', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Document is not focused'))
    render(<ResponsePanel sending={false} response={textResponse('plain words')} />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText(/Could not reach the clipboard/)).toBeInTheDocument()
  })

  it('offers nothing to copy for an empty body', () => {
    render(<ResponsePanel sending={false} response={textResponse('')} />)
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  })
})
