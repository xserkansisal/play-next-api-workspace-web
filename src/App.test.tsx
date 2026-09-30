import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { workspaceApi } from '@/lib/api'
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
    vi.spyOn(workspaceApi, 'item').mockResolvedValue({ ...request, url: '/server-version' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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
