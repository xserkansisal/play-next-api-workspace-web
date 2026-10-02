import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { workspaceApi } from '@/lib/api'
import { presenceApi } from '@/lib/presence'
import { browserFetchRunner, serverProxyRunner } from '@/lib/request-runner'
import type { CollectionResource, RequestResource } from '@/lib/workspace-types'

const request: RequestResource = {
  id: 'request-1',
  collectionId: 'collection-1',
  parentId: null,
  type: 'request',
  name: 'List orders',
  description: '',
  method: 'GET',
  url: '/orders',
  queryParams: [],
  headers: [],
  body: null,
  auth: { type: 'none' },
}

const collection: CollectionResource = {
  id: 'collection-1',
  name: 'Commerce API',
  description: '',
  items: [request],
}

class MockEventSource extends EventTarget {
  static current: MockEventSource
  readonly url: string
  readonly withCredentials = false
  readyState = 0
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent<string>) => unknown) | null = null
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null
  close = vi.fn(() => { this.readyState = 2 })

  constructor(url: string) {
    super()
    this.url = url
    MockEventSource.current = this
  }

  emit(type: string, data: string) {
    const event = new MessageEvent(type, { data })
    if (type === 'message') this.onmessage?.call(this as unknown as EventSource, event)
    else this.dispatchEvent(event)
  }
}

describe('workspace live update flow', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([collection])
    vi.spyOn(workspaceApi, 'collection').mockResolvedValue(collection)
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'item').mockResolvedValue({ ...request, url: '/server-version' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('provides light and dark theme logo assets in the workspace header', () => {
    const { container } = render(<App user={{ id: 'self', email: 'serkan.taghan@sisal.com' }} />)

    expect(screen.getByRole('img', { name: 'Play Next' })).toHaveAttribute('src', '/assets/play-next-logo.png')
    expect(container.querySelector('.brand-logo-dark')).toHaveAttribute('src', '/assets/play-next-logo-dark.png')
    expect(container.querySelector('.account-menu > .theme-toggle')).toBe(container.querySelector('.account-menu')?.lastElementChild)
  })

  it('lets the active environment be changed from the top bar', async () => {
    vi.mocked(workspaceApi.environments).mockResolvedValue([
      { id: 'staging', name: 'Staging', variables: [] },
      { id: 'development', name: 'Development', variables: [] },
    ])
    const user = userEvent.setup()
    render(<App />)

    const picker = await screen.findByRole('combobox', { name: 'Environment' })
    expect(picker).toHaveValue('staging')
    expect([...picker.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'No environment',
      'Development',
      'Staging',
    ])

    await user.selectOptions(picker, 'development')
    expect(picker).toHaveValue('development')
    await user.selectOptions(picker, '')
    expect(picker).toHaveValue('')
  })

  it('keeps unsaved input unchanged until the user explicitly loads the reviewed server version', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    const url = screen.getByRole('textbox', { name: 'Request URL' })
    await user.clear(url)
    await user.type(url, '/local-draft')

    MockEventSource.current.emit('message', JSON.stringify({
      eventId: 'event-1',
      kind: 'request',
      id: request.id,
      collectionId: collection.id,
      operation: 'updated',
      changedAt: '2026-09-29T09:00:00.000Z',
    }))

    expect(await screen.findByText(/unsaved edits/i)).toBeInTheDocument()
    expect(url).toHaveValue('/local-draft')
    await user.click(screen.getByRole('button', { name: 'Review latest' }))
    expect(await screen.findByText('Latest on server')).toBeInTheDocument()
    expect(url).toHaveValue('/local-draft')
    await user.click(screen.getByRole('button', { name: 'Keep my draft' }))
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/local-draft')
    expect(workspaceApi.item).toHaveBeenCalledWith(collection.id, request.id)
    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(MockEventSource.current.url).toContain('?lastEventId=event-1'))
  })

  it('ignores the change event echoed back for content the server already matches', async () => {
    vi.mocked(workspaceApi.item).mockResolvedValue({ ...request })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))

    MockEventSource.current.emit('message', JSON.stringify({
      eventId: 'event-echo',
      kind: 'request',
      id: request.id,
      collectionId: collection.id,
      operation: 'updated',
      changedAt: '2026-09-29T09:00:00.000Z',
    }))

    await waitFor(() => expect(workspaceApi.item).toHaveBeenCalledWith(collection.id, request.id))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/a newer version is available/i)).not.toBeInTheDocument()
  })

  it('shows a line diff of what differs from the server version', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    MockEventSource.current.emit('message', JSON.stringify({
      eventId: 'event-2',
      kind: 'request',
      id: request.id,
      collectionId: collection.id,
      operation: 'updated',
      changedAt: '2026-09-29T09:00:00.000Z',
    }))
    await user.click(await screen.findByRole('button', { name: 'Review latest' }))
    const diff = await screen.findByRole('table', { name: /changes between your draft/i })
    expect(diff).toHaveTextContent('"url": "/orders",')
    expect(diff).toHaveTextContent('"url": "/server-version",')
    expect(screen.getByText('−1')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('restores a saved request version into the editor and refreshes its history', async () => {
    const user = userEvent.setup()
    const history = vi.spyOn(workspaceApi, 'itemVersions').mockResolvedValue([{
      id: 'version-1',
      snapshot: {
        type: 'request',
        name: request.name,
        description: request.description,
        method: request.method,
        url: '/older-orders',
        queryParams: request.queryParams,
        headers: request.headers,
        body: request.body,
        auth: request.auth,
      },
      createdAt: '2026-10-01T12:00:00.000Z',
      createdBy: 'ada@example.com',
    }])
    const restore = vi.spyOn(workspaceApi, 'restoreItemVersion').mockResolvedValue({ ...request, url: '/older-orders' })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await user.click(screen.getByRole('button', { name: 'Version history' }))
    expect(await screen.findByText(/ada@example\.com/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore selected version' }))
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }))

    await waitFor(() => expect(restore).toHaveBeenCalledWith(collection.id, request.id, 'version-1'))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/older-orders'))
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2))
    expect(screen.getByText('● Saved')).toBeInTheDocument()
  })

  it('refetches the workspace after a resync frame and exposes the recovery state', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'List orders' })
    await waitFor(() => expect(workspaceApi.collections).toHaveBeenCalledTimes(1))
    MockEventSource.current.emit('resync', '')
    expect(await screen.findByText(/live event history expired/i)).toBeInTheDocument()
    await waitFor(() => expect(workspaceApi.collections).toHaveBeenCalledTimes(2))
    expect(workspaceApi.environments).toHaveBeenCalledTimes(2)
    expect(workspaceApi.trash).toHaveBeenCalledTimes(2)
  })

  it('publishes the selected resource and renders live viewers from presence events', async () => {
    const heartbeat = vi.spyOn(presenceApi, 'heartbeat').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<App user={{ id: 'self', email: 'serkan.taghan@sisal.com' }} />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await waitFor(() => expect(heartbeat).toHaveBeenCalledWith(expect.any(String), {
      kind: 'request',
      collectionId: collection.id,
      itemId: request.id,
    }))

    MockEventSource.current.emit('presence', JSON.stringify({
      users: [{
        userId: 'teammate',
        firstName: 'Ayse',
        lastName: 'Yilmaz',
        avatarUrl: null,
        avatarColor: 'blue',
        location: { kind: 'request', collectionId: collection.id, itemId: request.id },
      }],
    }))

    expect(await screen.findAllByRole('img', { name: 'Viewing now: Ayse Yilmaz' })).toHaveLength(2)
    expect(screen.getByText('1 viewing')).toBeInTheDocument()
  })

  it('checks a restore conflict with the proposed environment rename before restoring', async () => {
    const user = userEvent.setup()
    const removed = {
      id: 'environment-removed',
      kind: 'environment' as const,
      name: 'Development',
      collectionId: null,
      parentId: null,
      deletedAt: '2026-09-29T09:00:00.000Z',
    }
    vi.mocked(workspaceApi.trash).mockResolvedValue([removed])
    vi.spyOn(workspaceApi, 'checkRestore')
      .mockResolvedValueOnce({
        id: removed.id,
        kind: 'environment',
        name: removed.name,
        canRestore: false,
        blocker: null,
        conflicts: [{
          id: removed.id,
          kind: 'environment',
          name: removed.name,
          collectionId: null,
          parentId: null,
          conflictingId: 'environment-active',
        }],
      })
      .mockResolvedValueOnce({
        id: removed.id,
        kind: 'environment',
        name: removed.name,
        canRestore: true,
        blocker: null,
        conflicts: [],
      })
    const restore = vi.spyOn(workspaceApi, 'restore').mockResolvedValue({
      kind: 'environment',
      environment: { id: removed.id, name: 'Development (restored)', variables: [] },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /trash/i }))
    await user.click(await screen.findByRole('button', { name: 'Restore…' }))
    const conflictName = await screen.findByRole('textbox', { name: /Rename environment/ })
    expect(conflictName).toHaveValue('Development (restored)')
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled())
    expect(workspaceApi.checkRestore).toHaveBeenNthCalledWith(2, removed.id, {
      nameOverrides: { [removed.id]: 'Development (restored)' },
    })
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith(removed.id, {
      nameOverrides: { [removed.id]: 'Development (restored)' },
    }))
  })
})

describe('duplicating from the workspace', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([collection])
    vi.spyOn(workspaceApi, 'collection').mockResolvedValue(collection)
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the copied collection returned by the server and opens it', async () => {
    const copy: CollectionResource = { ...collection, id: 'collection-2', name: 'Commerce API (copy)', items: [] }
    const clone = vi.spyOn(workspaceApi, 'cloneCollection').mockResolvedValue(copy)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByLabelText('Duplicate Commerce API'))

    expect(clone).toHaveBeenCalledWith('collection-1')
    // The server names the copy, so the tree shows what was actually written rather than a
    // name the client guessed at.
    expect(await screen.findByTitle('Commerce API (copy)')).toBeTruthy()
    expect(await screen.findByDisplayValue('Commerce API (copy)')).toBeTruthy()
  })

  it('puts a copied request beside the original and opens it as a tab', async () => {
    const copy: RequestResource = { ...request, id: 'request-2', name: 'List orders (copy)' }
    vi.spyOn(workspaceApi, 'cloneItem').mockResolvedValue(copy)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByLabelText('Duplicate List orders'))

    expect(await screen.findByRole('button', { name: 'List orders (copy)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'List orders' })).toBeTruthy()
  })

  it('reports a copy the server refused instead of showing one that does not exist', async () => {
    vi.spyOn(workspaceApi, 'cloneCollection').mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByLabelText('Duplicate Commerce API'))

    await waitFor(() => expect(screen.getByText(/nope/)).toBeTruthy())
    expect(screen.queryByTitle(/\(copy\)/)).toBeNull()
  })
})

describe('a browser send that CORS blocks', () => {
  const absolute: CollectionResource = {
    ...collection,
    items: [{ ...request, url: 'http://10.29.125.148:7799/orders' }],
  }

  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    window.localStorage.clear()
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([absolute])
    vi.spyOn(workspaceApi, 'collection').mockResolvedValue(absolute)
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'proxySettings').mockResolvedValue({ enabled: true, anyHost: true, allowedHosts: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function openAndSend() {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await waitFor(() => expect(workspaceApi.proxySettings).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    return user
  }

  it('re-sends from the API and shows its answer instead of an error the user cannot act on', async () => {
    // A confirmed CORS block: the no-cors probe reaches the host, the real request does not.
    vi.spyOn(browserFetchRunner, 'run').mockResolvedValue({
      kind: 'failure', durationMs: 5, corsBlocked: true, message: 'blocked by CORS',
    })
    const viaServer = vi.spyOn(serverProxyRunner, 'run').mockResolvedValue({
      kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 8, sizeBytes: 13,
      headers: { 'content-type': 'application/json' }, bodyText: '{"sent":"api"}',
    })

    await openAndSend()

    await waitFor(() => expect(viaServer).toHaveBeenCalled())
    expect(await screen.findByText(/200/)).toBeTruthy()
    // Where it came from is stated, not hidden: the request left a different machine, with a
    // different source address and none of the browser's cookies for that host.
    expect(await screen.findByText(/sent from the API instead/)).toBeTruthy()
    expect(screen.queryByText(/blocked by CORS/)).toBeNull()
  })

  it('keeps the original CORS error when the API cannot reach the host either', async () => {
    vi.spyOn(browserFetchRunner, 'run').mockResolvedValue({
      kind: 'failure', durationMs: 5, corsBlocked: true, message: 'blocked by CORS',
    })
    vi.spyOn(serverProxyRunner, 'run').mockResolvedValue({
      kind: 'failure', durationMs: 3, message: 'This server could not reach that host',
    })

    await openAndSend()

    // The first error names the real obstacle; the proxy's would describe a fallback the user
    // never asked for.
    expect(await screen.findByText(/blocked by CORS/)).toBeTruthy()
    expect(screen.queryByText(/sent from the API instead/)).toBeNull()
    // No offer to do again what was just tried and failed.
    expect(screen.queryByRole('button', { name: /send from the server/i })).toBeNull()
  })

  it('does not retry a host the browser never reached, since the API would fail too', async () => {
    vi.spyOn(browserFetchRunner, 'run').mockResolvedValue({
      kind: 'failure', durationMs: 5, message: 'nothing answered at all',
    })
    const viaServer = vi.spyOn(serverProxyRunner, 'run')

    await openAndSend()

    expect(await screen.findByText(/nothing answered at all/)).toBeTruthy()
    expect(viaServer).not.toHaveBeenCalled()
  })

  it('does not retry when the API proxy is switched off', async () => {
    vi.spyOn(workspaceApi, 'proxySettings').mockResolvedValue({ enabled: false, anyHost: false, allowedHosts: [] })
    vi.spyOn(browserFetchRunner, 'run').mockResolvedValue({
      kind: 'failure', durationMs: 5, corsBlocked: true, message: 'blocked by CORS',
    })
    const viaServer = vi.spyOn(serverProxyRunner, 'run')

    await openAndSend()

    expect(await screen.findByText(/blocked by CORS/)).toBeTruthy()
    expect(viaServer).not.toHaveBeenCalled()
  })
})

describe('which scope a {{name}} resolves from', () => {
  const environment = {
    id: 'env-1',
    name: 'develop',
    variables: [{ key: 'target', value: 'from-environment', enabled: true }],
  }
  const templated = {
    ...collection,
    items: [{ ...request, url: 'http://host.test/{{target}}' }],
  }

  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    window.localStorage.clear()
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([templated])
    vi.spyOn(workspaceApi, 'collection').mockResolvedValue(templated)
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([environment as never])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'proxySettings').mockResolvedValue({ enabled: false, anyHost: false, allowedHosts: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function openVariableScope(user: ReturnType<typeof userEvent.setup>, scope: string) {
    await user.click(await screen.findByRole('button', { name: `Open ${scope} variables` }))
  }

  async function sendAndReadUrl(variables: { scope: 'user' | 'global'; key: string; value: string }[]) {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue(variables)
    const run = vi.spyOn(browserFetchRunner, 'run').mockResolvedValue({
      kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 1, sizeBytes: 2,
      headers: {}, bodyText: '{}',
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(run).toHaveBeenCalled())
    return run.mock.calls[0]![0].url
  }

  it('uses my own value over the shared environment, which is why capturing one is worth doing', async () => {
    const url = await sendAndReadUrl([
      { scope: 'user', key: 'target', value: 'mine' },
      { scope: 'global', key: 'target', value: 'shared' },
    ])
    expect(url).toBe('http://host.test/mine')
  })

  it('lets the environment beat a global, matching how Postman resolves an imported collection', async () => {
    const url = await sendAndReadUrl([{ scope: 'global', key: 'target', value: 'shared' }])
    expect(url).toBe('http://host.test/from-environment')
  })

  it('falls through to a global when nothing narrower defines the name', async () => {
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([{ ...environment, variables: [] } as never])
    const url = await sendAndReadUrl([{ scope: 'global', key: 'target', value: 'shared' }])
    expect(url).toBe('http://host.test/shared')
  })

  it('says which names are defined more than once instead of leaving it to be guessed', async () => {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([
      { scope: 'user', key: 'target', value: 'mine' },
      { scope: 'global', key: 'target', value: 'shared' },
    ])
    render(<App />)
    await screen.findByRole('button', { name: 'List orders' })
    const user = userEvent.setup()
    await openVariableScope(user, 'Only me')

    expect(await screen.findByRole('cell', { name: 'Overrides Environments, Everyone' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Only me' })).toBeInTheDocument()
  })

  it('edits one of my variables from the Variables menu, renaming it on the server', async () => {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([{ scope: 'user', key: 'token', value: 'old' }])
    const setVariable = vi.spyOn(workspaceApi, 'setVariable').mockImplementation(async (scope, key, value) => ({ scope, key, value }))
    const deleteVariable = vi.spyOn(workspaceApi, 'deleteVariable').mockResolvedValue()
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Open Only me variables' }))
    await user.click(await screen.findByRole('button', { name: 'Edit token' }))
    await user.clear(screen.getByRole('textbox', { name: 'Key for token' }))
    await user.type(screen.getByRole('textbox', { name: 'Key for token' }), 'authToken')
    await user.clear(screen.getByRole('textbox', { name: 'Value for token' }))
    await user.type(screen.getByRole('textbox', { name: 'Value for token' }), 'new{Enter}')

    await waitFor(() => expect(deleteVariable).toHaveBeenCalledWith('user', 'token'))
    expect(setVariable).toHaveBeenCalledWith('user', 'authToken', 'new')
    expect(await screen.findByRole('button', { name: 'Edit authToken' })).toBeTruthy()
  })

  it('deletes an environment variable by saving the latest copy of the environment without it', async () => {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
    const latest = { ...environment, variables: [...environment.variables, { key: 'other', value: 'x', enabled: true }] }
    vi.spyOn(workspaceApi, 'environment').mockResolvedValue(latest as never)
    const save = vi.spyOn(workspaceApi, 'saveEnvironment').mockImplementation(async (resource) => resource)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open Environments variables' }))
    await user.click(await screen.findByRole('button', { name: 'Remove target' }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]![0].variables).toEqual([{ key: 'other', value: 'x', enabled: true }])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove target' })).toBeNull())
  })

  it('opens a blank environment editor and creates the environment only when saved', async () => {
    const created = { id: 'environment-1', name: 'Development', variables: [] }
    const create = vi.spyOn(workspaceApi, 'createEnvironment').mockResolvedValue(created)
    const prompt = vi.spyOn(window, 'prompt')
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('combobox', { name: 'Environment' })).toHaveValue('')
    await user.click(await screen.findByRole('button', { name: 'New environment' }))

    expect(await screen.findByRole('textbox', { name: 'Environment name' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Move to Trash' })).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: 'Environment name' }), 'Development')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Development', variables: [] }))
    expect(await screen.findByRole('button', { name: 'Development' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use Development' })).toBeEnabled()
  })

  it('opens the selected variable scope in the main detail area', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open Only me variables' }))

    expect(await screen.findByRole('heading', { name: 'Only me' })).toBeInTheDocument()
  })
})
