import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { workspaceApi } from '@/lib/api'
import { presenceApi } from '@/lib/presence'
import { browserFetchRunner, serverProxyRunner } from '@/lib/request-runner'
import type { CollectionResource, FolderResource, RequestResource } from '@/lib/workspace-types'

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

  it('shows the team switcher for multiple teams and scopes the live stream to the active team', async () => {
    const onTeamChange = vi.fn()
    render(
      <App
        activeTeamId="team-1"
        teams={[
          { id: 'team-1', name: 'Game Studio', description: '', role: 'member', isMember: true },
          { id: 'team-2', name: 'Mobile Gaming', description: '', role: 'owner', isMember: true },
        ]}
        onTeamChange={onTeamChange}
      />,
    )

    const picker = await screen.findByRole('combobox', { name: 'Team' })
    expect(picker).toHaveAttribute('aria-valuetext', 'Game Studio')
    expect(picker.closest('.brand')).not.toBeNull()
    expect(MockEventSource.current.url).toContain('?teamId=team-1')
    await userEvent.click(picker)
    await userEvent.click(screen.getByRole('option', { name: /Mobile Gaming/ }))
    expect(onTeamChange).toHaveBeenCalledWith('team-2')
  })

  it('opens the selected team activity view', async () => {
    const activity = vi.spyOn(workspaceApi, 'activity').mockResolvedValue({ entries: [], nextCursor: null })
    render(
      <App
        activeTeamId="team-1"
        teams={[{ id: 'team-1', name: 'Game Studio', description: '', role: 'viewer', isMember: true }]}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /Team activity/ }))

    expect(await screen.findByRole('heading', { name: 'Team activity' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No team activity yet' })).toBeInTheDocument()
    expect(activity).toHaveBeenCalledOnce()
  })

  it('labels non-member teams as admin access in the team switcher', async () => {
    render(
      <App
        user={{ id: 'admin-1', email: 'admin@fluttersea.com', systemRole: 'admin' }}
        activeTeamId="team-1"
        teams={[{ id: 'team-1', name: 'External Team', description: '', role: 'owner', isMember: false }]}
      />,
    )

    await userEvent.click(await screen.findByRole('combobox', { name: 'Team' }))
    expect(screen.getByRole('option', { name: /External Team\s*Admin access/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument()
  })

  it('keeps viewers read-only and does not load Trash', async () => {
    render(
      <App
        user={{ id: 'viewer-1', email: 'viewer@fluttersea.com' }}
        activeTeamId="team-viewer"
        teams={[{ id: 'team-viewer', name: 'Read Only', description: '', role: 'viewer', isMember: true }]}
      />,
    )

    await screen.findByRole('heading', { name: 'Choose a request to get started' })
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bulk import' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New collection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trash/ })).not.toBeInTheDocument()
    expect(workspaceApi.trash).not.toHaveBeenCalled()
  })

  it('replaces the cached collection tree after restoring a whole-collection snapshot', async () => {
    const user = userEvent.setup()
    const restored: CollectionResource = {
      ...collection,
      name: 'Restored payments',
      items: [{ ...request, url: '/restored-orders' }],
    }
    vi.spyOn(workspaceApi, 'collectionSnapshots').mockResolvedValue({
      snapshots: [{ id: 'snapshot-1', itemCount: 1, createdAt: '2026-10-02T09:00:00.000Z', createdBy: 'ada@example.com' }],
      nextOffset: null,
    })
    vi.spyOn(workspaceApi, 'collectionSnapshot').mockResolvedValue({
      id: 'snapshot-1',
      itemCount: 1,
      createdAt: '2026-10-02T09:00:00.000Z',
      createdBy: 'ada@example.com',
      snapshot: { name: 'Restored payments', description: '', auth: null, items: [] },
    })
    vi.spyOn(workspaceApi, 'collectionSnapshotDiff').mockResolvedValue({
      from: { id: 'snapshot-1', name: 'Restored payments', description: '', auth: null },
      to: { id: 'current', name: 'Commerce API', description: '', auth: null },
      collectionFields: ['name'],
      items: { added: [], removed: [], moved: [], changed: [] },
    })
    const restore = vi.spyOn(workspaceApi, 'restoreCollectionSnapshot').mockResolvedValue(restored)

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Commerce API' }))
    await user.click(screen.getByRole('button', { name: 'Snapshots' }))
    await user.click(await screen.findByRole('button', { name: 'Restore selected snapshot' }))
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith(collection.id, 'snapshot-1'))
    await user.click(screen.getByRole('button', { name: 'Close snapshots' }))
    await user.click(screen.getByRole('button', { name: 'List orders' }))

    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/restored-orders')
    expect(screen.getByRole('button', { name: 'Restored payments' })).toBeInTheDocument()
  })

  it('opens a single import chooser for Postman and bulk imports', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: 'List orders' })
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bulk import' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('heading', { name: 'Bring your API into Play Next' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^OpenAPI Create, import, or sync/ }))
    await user.click(screen.getByRole('button', { name: /Compare and sync a collection/ }))
    expect(screen.getByRole('heading', { name: 'Sync a collection with OpenAPI' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByRole('button', { name: /^OpenAPI Create, import, or sync/ }))
    await user.click(screen.getByRole('button', { name: /Import once into a collection/ }))
    expect(screen.getByRole('heading', { name: 'Import OpenAPI into a collection' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByRole('button', { name: /Play Next bulk import/ }))
    expect(screen.getByRole('heading', { name: 'Import into a collection' })).toBeInTheDocument()
    expect(screen.getByLabelText('Bulk import JSON file')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByRole('button', { name: /Postman export/ }))
    expect(screen.getByRole('heading', { name: 'Import from Postman' })).toBeInTheDocument()
  })

  it('shows the active team name when the user belongs to only one team', async () => {
    render(
      <App
        activeTeamId="team-1"
        teams={[{ id: 'team-1', name: 'Game Studio', description: '', role: 'member', isMember: true }]}
      />,
    )

    const picker = await screen.findByRole('combobox', { name: 'Team' })
    expect(picker).toHaveAttribute('aria-valuetext', 'Game Studio')
    expect(picker).toBeEnabled()
    expect(picker).toHaveTextContent('Game Studio')
    await userEvent.click(picker)
    expect(within(screen.getByRole('listbox', { name: 'Teams' })).getAllByRole('option')).toHaveLength(1)
  })

  it('lets the active environment be changed from the top bar', async () => {
    vi.mocked(workspaceApi.environments).mockResolvedValue([
      { id: 'staging', name: 'Staging', variables: [] },
      { id: 'development', name: 'Development', variables: [] },
    ])
    const user = userEvent.setup()
    render(<App />)

    const picker = await screen.findByRole('combobox', { name: 'Environment' })
    expect(picker).toHaveTextContent('Staging')
    await user.click(picker)
    expect(screen.getAllByRole('option').map((option) => option.querySelector('.env-picker-option-name')?.textContent)).toEqual([
      'No environment',
      'Development',
      'Staging',
    ])

    await user.click(screen.getByRole('option', { name: /Development/ }))
    expect(picker).toHaveTextContent('Development')
    await user.click(picker)
    await user.click(screen.getByRole('option', { name: /No environment/ }))
    expect(picker).toHaveTextContent('No environment')
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

  it('refetches workspace data when the ready event reports a new server epoch', async () => {
    const user = userEvent.setup()
    const collections = vi.mocked(workspaceApi.collections)
    render(<App />)
    await screen.findByRole('button', { name: 'List orders' })
    const previousStream = MockEventSource.current
    previousStream.emit('ready', '{"epoch":"epoch-1"}')
    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(MockEventSource.current).not.toBe(previousStream))

    const callsBeforeRestart = collections.mock.calls.length
    MockEventSource.current.emit('ready', '{"epoch":"epoch-2"}')

    await waitFor(() => expect(collections.mock.calls.length).toBeGreaterThan(callsBeforeRestart))
    expect(await screen.findByText(/API restarted/i)).toBeInTheDocument()
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

  async function confirmDiscard(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
  }

  it('discards unsaved edits back to the last saved version', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
    const url = screen.getByRole('textbox', { name: 'Request URL' })
    await user.clear(url)
    await user.type(url, '/local-draft')
    expect(screen.getByText('● Unsaved changes')).toBeInTheDocument()

    await confirmDiscard(user)

    expect(confirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/orders')
    expect(screen.getByText('● Saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
  })

  it('keeps the edits when the discard is cancelled', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    const url = screen.getByRole('textbox', { name: 'Request URL' })
    await user.type(url, '/more')
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(url).toHaveValue('/orders/more')
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(url).toHaveValue('/orders/more')
  })

  it('closes a never-saved request when its changes are discarded', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'List orders' })
    await user.click(screen.getAllByRole('button', { name: 'New request' })[0]!)
    expect(await screen.findByRole('textbox', { name: 'Request name' })).toHaveValue('New request')

    await confirmDiscard(user)

    expect(screen.queryByRole('textbox', { name: 'Request name' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close New request' })).toBeNull()
  })

  it('lets a new request choose a destination and defaults to the opened folder', async () => {
    const folder: FolderResource = {
      id: 'folder-1',
      collectionId: collection.id,
      parentId: null,
      type: 'folder',
      name: 'Orders',
      description: '',
      items: [],
    }
    const withFolder = { ...collection, items: [folder, request] }
    vi.spyOn(workspaceApi, 'collection').mockResolvedValue(withFolder)
    const createItem = vi.spyOn(workspaceApi, 'createItem').mockResolvedValue({ ...request, id: 'created-request', parentId: null })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Orders' }))
    await user.click(within(document.querySelector('.folder-contents')!).getByRole('button', { name: 'New request' }))

    const location = await screen.findByRole('combobox', { name: 'Request location' })
    expect(location).toHaveAttribute('aria-valuetext', 'Commerce API / Orders')
    await user.click(location)
    expect(screen.getByRole('option', { name: 'Commerce API / Orders' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(location)
    await user.click(screen.getByRole('option', { name: 'Commerce API' }))
    expect(location).toHaveAttribute('aria-valuetext', 'Commerce API')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(createItem).toHaveBeenCalledWith(collection.id, expect.objectContaining({
      type: 'request',
      name: 'New request',
    })))
    expect(createItem.mock.calls[0]?.[1]).not.toHaveProperty('parentId')
  })

  it('moves a request to Trash only after it is confirmed in the dialog', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const remove = vi.spyOn(workspaceApi, 'deleteItem').mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))

    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Move “List orders” to Trash?' })).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Move to Trash' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(collection.id, request.id))
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('saves with Ctrl+S', async () => {
    const save = vi.spyOn(workspaceApi, 'saveRequest').mockImplementation(async (_collectionId, resource) => resource)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await user.type(screen.getByRole('textbox', { name: 'Request URL' }), '/x')
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(save).toHaveBeenCalledWith(collection.id, expect.objectContaining({ url: '/orders/x' })))
    expect(await screen.findByText('● Saved')).toBeInTheDocument()
  })
})

describe('closing a request tab with unsaved changes', () => {
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

  async function openEditedTab() {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await user.type(screen.getByRole('textbox', { name: 'Request URL' }), '/x')
    await user.click(screen.getByRole('button', { name: 'Close List orders' }))
    expect(screen.getByRole('dialog', { name: 'Save changes to “List orders”?' })).toBeInTheDocument()
    return user
  }

  it('keeps the tab open on Cancel', async () => {
    const user = await openEditedTab()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/orders/x')
  })

  it('closes without saving on Discard changes', async () => {
    const save = vi.spyOn(workspaceApi, 'saveRequest')
    const user = await openEditedTab()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close List orders' })).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('saves and then closes on Save and close', async () => {
    const save = vi.spyOn(workspaceApi, 'saveRequest').mockImplementation(async (_collectionId, resource) => resource)
    const user = await openEditedTab()
    await user.click(screen.getByRole('button', { name: 'Save and close' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close List orders' })).toBeNull())
    expect(save).toHaveBeenCalledWith(collection.id, expect.objectContaining({ url: '/orders/x' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the tab and shows the error when saving fails', async () => {
    vi.spyOn(workspaceApi, 'saveRequest').mockRejectedValue(new Error('Server unavailable'))
    const user = await openEditedTab()
    await user.click(screen.getByRole('button', { name: 'Save and close' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Server unavailable')
    expect(screen.getByRole('button', { name: 'Close List orders' })).toBeInTheDocument()
  })
})

describe('discarding from the tab menu, the keyboard and before leaving', () => {
  const second: RequestResource = { ...request, id: 'request-2', name: 'Create order', method: 'POST', url: '/orders/new' }
  const twoRequests: CollectionResource = { ...collection, items: [request, second] }

  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([twoRequests])
    vi.spyOn(workspaceApi, 'collection').mockResolvedValue(twoRequests)
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function editBoth() {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await user.type(screen.getByRole('textbox', { name: 'Request URL' }), '/a')
    await user.click(screen.getByRole('button', { name: 'Create order' }))
    await user.type(screen.getByRole('textbox', { name: 'Request URL' }), '/b')
    return user
  }

  function tabFor(name: string) {
    return screen.getByRole('button', { name: `Close ${name}` }).closest('.request-tab') as HTMLElement
  }

  it('discards one tab from its context menu, leaving the other tab untouched', async () => {
    const user = await editBoth()
    await user.pointer({ keys: '[MouseRight]', target: tabFor('List orders') })
    const menu = screen.getByRole('menu', { name: 'Tab actions' })
    await user.click(within(menu).getByRole('menuitem', { name: 'Discard changes' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard changes' }))

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/orders/new/b')
    expect(tabFor('Create order').querySelector('.tab-dirty')).not.toBeNull()
    expect(tabFor('List orders').querySelector('.tab-dirty')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'List orders' }))
    expect(screen.getAllByRole('textbox', { name: 'Request URL' }).at(-1)).toHaveValue('/orders')
  })

  it('discards every tab at once from the context menu', async () => {
    const user = await editBoth()
    await user.pointer({ keys: '[MouseRight]', target: tabFor('Create order') })
    await user.click(screen.getByRole('menuitem', { name: 'Discard changes in all tabs' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard unsaved changes in 2 tabs?' })).getByRole('button', { name: 'Discard changes' }))

    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/orders/new')
    expect(document.querySelectorAll('.tab-dirty')).toHaveLength(0)
  })

  it('closes other tabs after warning about their unsaved changes', async () => {
    const user = await editBoth()
    await user.pointer({ keys: '[MouseRight]', target: tabFor('List orders') })
    await user.click(screen.getByRole('menuitem', { name: 'Close other tabs' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Close 1 tab?' })
    expect(dialog).toHaveTextContent('Unsaved changes in 1 tab will be lost')
    await user.click(within(dialog).getByRole('button', { name: 'Close tabs' }))

    expect(screen.getByRole('button', { name: 'Close List orders' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close Create order' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/orders/a')
    expect(tabFor('List orders').querySelector('.tab-dirty')).not.toBeNull()
  })

  it('closes all tabs after warning about unsaved changes', async () => {
    const user = await editBoth()
    await user.pointer({ keys: '[MouseRight]', target: tabFor('Create order') })
    await user.click(screen.getByRole('menuitem', { name: 'Close all tabs' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Close 2 tabs?' })
    expect(dialog).toHaveTextContent('Unsaved changes in 2 tabs will be lost')
    await user.click(within(dialog).getByRole('button', { name: 'Close tabs' }))

    expect(screen.queryByRole('button', { name: 'Close List orders' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close Create order' })).toBeNull()
  })

  it('disables discard items when nothing is unsaved and closes the menu on Escape', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await user.pointer({ keys: '[MouseRight]', target: tabFor('List orders') })
    expect(screen.getByRole('menuitem', { name: 'Discard changes' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Discard changes in all tabs' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Close other tabs' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Close all tabs' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Close tab' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the discard confirmation with Ctrl+Shift+Backspace', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    await user.type(screen.getByRole('textbox', { name: 'Request URL' }), '/a')
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    // The shortcut only asks; it never discards on its own.
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/orders/a')
  })

  it('asks the browser to confirm leaving only while something is unsaved', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(leave()).toBe(false)
    await user.type(screen.getByRole('textbox', { name: 'Request URL' }), '/a')
    expect(leave()).toBe(true)
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

    expect(await screen.findByRole('cell', { name: 'Overrides Environments, Team' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Only me' })).toBeInTheDocument()
  })

  it('edits one of my variables from the Variables menu, renaming it on the server', async () => {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([{ scope: 'user', key: 'token', value: 'old' }])
    const updateVariable = vi.spyOn(workspaceApi, 'updateVariable').mockImplementation(async (scope, key, input) => ({ scope, key: input.key ?? key, value: input.value ?? '' }))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Open Only me variables' }))
    await user.click(await screen.findByRole('button', { name: 'Edit token' }))
    await user.clear(screen.getByRole('textbox', { name: 'Key for token' }))
    await user.type(screen.getByRole('textbox', { name: 'Key for token' }), 'authToken')
    await user.clear(screen.getByRole('textbox', { name: 'Value for token' }))
    await user.type(screen.getByRole('textbox', { name: 'Value for token' }), 'new{Enter}')

    await waitFor(() => expect(updateVariable).toHaveBeenCalledWith('user', 'token', { key: 'authToken', value: 'new' }))
    expect(await screen.findByRole('button', { name: 'Edit authToken' })).toBeTruthy()
  })

  it('deletes an environment variable by saving the latest copy of the environment without it', async () => {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
    const latest = { ...environment, variables: [...environment.variables, { key: 'other', value: 'x', enabled: true }] }
    vi.spyOn(workspaceApi, 'environment').mockResolvedValue(latest as never)
    const save = vi.spyOn(workspaceApi, 'saveEnvironment').mockImplementation(async (resource) => resource)
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open Environments variables' }))
    await user.click(await screen.findByRole('button', { name: 'Remove target' }))
    expect(save).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog', { name: 'Delete “target”?' })).getByRole('button', { name: 'Delete' }))

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

  it('exports only the currently open personal or global variable scope', async () => {
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([
      { scope: 'user', key: 'personalToken', value: 'mine' },
      { scope: 'global', key: 'sharedUrl', value: 'https://example.com' },
    ])
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
    const downloadedFiles: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFiles.push(this.download)
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open Only me variables' }))
    const exportButton = screen.getByRole('button', { name: 'Export' })
    expect(exportButton).toHaveAttribute('title', 'Export Only me variables as Play Next JSON')
    await user.click(exportButton)

    await user.click(screen.getByRole('button', { name: 'Open Team variables' }))
    expect(exportButton).toHaveAttribute('title', 'Export Team variables as Play Next JSON')
    await user.click(exportButton)

    expect(downloadedFiles).toEqual([
      'play-next-api-user-variables.json',
      'play-next-api-global-variables.json',
    ])
  })
})
