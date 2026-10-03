import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TeamActivityView } from '@/components/TeamActivityView'
import { workspaceApi } from '@/lib/api'
import type { ActivityEntry } from '@/lib/api'

const entry: ActivityEntry = {
  id: 'event-1',
  actor: 'alex@example.com',
  action: 'item.updated',
  resourceType: 'request',
  resourceId: 'request-1',
  resourceName: 'Create order',
  collectionId: 'collection-1',
  details: {
    changedFields: ['name', 'url'],
    url: 'https://private.example/secret',
    body: 'private body',
  },
  createdAt: '2026-10-03T06:15:00.000Z',
}

afterEach(() => vi.restoreAllMocks())

describe('TeamActivityView', () => {
  it('renders a safe summary and links only to resources that still exist', async () => {
    const onOpenResource = vi.fn()
    vi.spyOn(workspaceApi, 'activity').mockResolvedValue({ entries: [entry], nextCursor: null })
    render(
      <TeamActivityView
        teamId="team-1"
        collections={[{
          id: 'collection-1',
          name: 'Orders',
          description: '',
          items: [{
            id: 'request-1',
            collectionId: 'collection-1',
            parentId: null,
            type: 'request',
            name: 'Create order',
            description: '',
            method: 'POST',
            url: '/orders',
            queryParams: [],
            headers: [],
            body: null,
            auth: { type: 'none' },
          }],
        }]}
        environments={[]}
        onOpenResource={onOpenResource}
      />,
    )

    const resourceLink = await screen.findByRole('button', { name: 'Create order' })
    expect(screen.getByText(/updated an item/)).toBeInTheDocument()
    expect(screen.getByText('name, url')).toBeInTheDocument()
    expect(screen.queryByText(/private\.example|private body/)).not.toBeInTheDocument()
    fireEvent.click(resourceLink)
    expect(onOpenResource).toHaveBeenCalledWith({ kind: 'request', collectionId: 'collection-1', itemId: 'request-1' })
  })

  it('loads subsequent pages using the exact opaque cursor', async () => {
    const activity = vi.spyOn(workspaceApi, 'activity')
      .mockResolvedValueOnce({ entries: [entry], nextCursor: 'opaque+/cursor==' })
      .mockResolvedValueOnce({ entries: [{ ...entry, id: 'event-2', resourceName: 'Update customer' }], nextCursor: null })
    render(<TeamActivityView teamId="team-1" collections={[]} environments={[]} onOpenResource={vi.fn()} />)

    await screen.findByText('Create order')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Update customer')
    expect(activity).toHaveBeenNthCalledWith(2, 50, 'opaque+/cursor==')
  })

  it('drops an invalid cursor and reloads the first page', async () => {
    const invalidCursor = Object.assign(new Error('Invalid cursor'), {
      isAxiosError: true,
      response: { status: 400, data: { error: { code: 'ACTIVITY_CURSOR_INVALID' } } },
    })
    const activity = vi.spyOn(workspaceApi, 'activity')
      .mockResolvedValueOnce({ entries: [entry], nextCursor: 'expired' })
      .mockRejectedValueOnce(invalidCursor)
      .mockResolvedValueOnce({ entries: [{ ...entry, id: 'event-3', resourceName: 'Latest event' }], nextCursor: null })
    render(<TeamActivityView teamId="team-1" collections={[]} environments={[]} onOpenResource={vi.fn()} />)

    await screen.findByText('Create order')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Latest event')
    expect(activity).toHaveBeenNthCalledWith(3)
    expect(screen.queryByText('Create order')).not.toBeInTheDocument()
  })

  it('clears entries and requests the first page after changing teams', async () => {
    const activity = vi.spyOn(workspaceApi, 'activity')
      .mockResolvedValueOnce({ entries: [entry], nextCursor: null })
      .mockResolvedValueOnce({ entries: [{ ...entry, id: 'event-team-2', resourceName: 'Team two event' }], nextCursor: null })
    const props = { collections: [], environments: [], onOpenResource: vi.fn() }
    const { rerender } = render(<TeamActivityView teamId="team-1" {...props} />)
    await screen.findByText('Create order')

    rerender(<TeamActivityView teamId="team-2" {...props} />)
    await screen.findByText('Team two event')
    expect(activity).toHaveBeenNthCalledWith(2)
    expect(screen.queryByText('Create order')).not.toBeInTheDocument()
  })

  it('shows an empty state without requesting activity when no team is selected', async () => {
    const activity = vi.spyOn(workspaceApi, 'activity')
    render(<TeamActivityView teamId={null} collections={[]} environments={[]} onOpenResource={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'No team selected' })).toBeInTheDocument()
    await waitFor(() => expect(activity).not.toHaveBeenCalled())
  })
})
