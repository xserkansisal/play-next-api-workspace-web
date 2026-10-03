import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CollectionSnapshotsDialog } from '@/components/CollectionSnapshotsDialog'
import { workspaceApi } from '@/lib/api'
import type { CollectionResource } from '@/lib/workspace-types'

const snapshots = [
  { id: 'snapshot-new', itemCount: 2, createdAt: '2026-10-03T09:00:00.000Z', createdBy: 'ada@example.com' },
  { id: 'snapshot-old', itemCount: 1, createdAt: '2026-10-02T09:00:00.000Z', createdBy: null },
]

const detail = {
  ...snapshots[0],
  snapshot: {
    name: 'Payments',
    description: '',
    auth: null,
    items: [{
      id: 'request-1',
      type: 'request' as const,
      name: 'Create payment',
      description: '',
      method: 'POST' as const,
      url: '/payments?token=private',
      queryParams: [],
      headers: [],
      body: null,
      auth: { type: 'bearer' as const, token: 'private-token' },
      preRequestScript: '',
      postResponseScript: '',
    }],
  },
}

const diff = {
  from: { id: 'snapshot-old', name: 'Payments', description: '', auth: null },
  to: { id: 'current', name: 'Payments', description: '', auth: null },
  collectionFields: ['name'] as Array<'name' | 'description' | 'auth'>,
  items: {
    added: [],
    removed: [],
    moved: [],
    changed: [{
      id: 'request-1',
      fields: ['url', 'auth'],
      before: { url: '/old', auth: { token: 'private-token' } },
      after: { url: '/new', auth: { token: 'private-token' } },
    }],
  },
}

const restoredCollection: CollectionResource = { id: 'collection-1', name: 'Payments', description: '', items: [] }

describe('collection snapshots dialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lists history, compares with current, and confirms atomic restore', async () => {
    const user = userEvent.setup()
    vi.spyOn(workspaceApi, 'collectionSnapshots').mockResolvedValue({ snapshots, nextOffset: null })
    vi.spyOn(workspaceApi, 'collectionSnapshot').mockResolvedValue(detail)
    const compare = vi.spyOn(workspaceApi, 'collectionSnapshotDiff').mockResolvedValue(diff)
    const restore = vi.spyOn(workspaceApi, 'restoreCollectionSnapshot').mockResolvedValue(restoredCollection)
    const onRestored = vi.fn()

    render(
      <CollectionSnapshotsDialog
        collectionId="collection-1"
        collectionName="Payments"
        dirty
        canRestore
        onClose={vi.fn()}
        onRestored={onRestored}
      />,
    )

    expect(await screen.findByText(/ada@example\.com/)).toBeInTheDocument()
    expect(await screen.findByText('name')).toBeInTheDocument()
    expect(compare).toHaveBeenCalledWith('collection-1', 'snapshot-old', 'current')
    expect(screen.getByText('Create payment')).toBeInTheDocument()
    expect(screen.queryByText('/payments?token=private')).not.toBeInTheDocument()
    expect(screen.queryByText('private-token')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restore selected snapshot' }))
    expect(screen.getByRole('alert')).toHaveTextContent('replace unsaved editor changes')
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }))

    await waitFor(() => expect(restore).toHaveBeenCalledWith('collection-1', 'snapshot-new'))
    expect(onRestored).toHaveBeenCalledWith(restoredCollection)
    expect(await screen.findByRole('status')).toHaveTextContent('Snapshot restored')
  })

  it('lets viewers browse and compare snapshots without exposing restore controls', async () => {
    vi.spyOn(workspaceApi, 'collectionSnapshots').mockResolvedValue({ snapshots, nextOffset: null })
    vi.spyOn(workspaceApi, 'collectionSnapshot').mockResolvedValue(detail)
    vi.spyOn(workspaceApi, 'collectionSnapshotDiff').mockResolvedValue(diff)

    render(
      <CollectionSnapshotsDialog
        collectionId="collection-1"
        collectionName="Payments"
        dirty={false}
        canRestore={false}
        onClose={vi.fn()}
        onRestored={vi.fn()}
      />,
    )

    expect(await screen.findByText(/ada@example\.com/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Compare from snapshot' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument()
  })

  it('loads the next snapshot page using the returned offset', async () => {
    const user = userEvent.setup()
    vi.spyOn(workspaceApi, 'collectionSnapshots')
      .mockResolvedValueOnce({ snapshots: [snapshots[0]], nextOffset: 25 })
      .mockResolvedValueOnce({ snapshots: [snapshots[1]], nextOffset: null })
    vi.spyOn(workspaceApi, 'collectionSnapshot').mockResolvedValue(detail)
    vi.spyOn(workspaceApi, 'collectionSnapshotDiff').mockResolvedValue(diff)

    render(
      <CollectionSnapshotsDialog
        collectionId="collection-1"
        collectionName="Payments"
        dirty={false}
        canRestore={false}
        onClose={vi.fn()}
        onRestored={vi.fn()}
      />,
    )

    await screen.findByText(/ada@example\.com/)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText(/Unknown user/)).toBeInTheDocument()
    expect(workspaceApi.collectionSnapshots).toHaveBeenNthCalledWith(2, 'collection-1', 25, 25)
  })

  it('shows backend conflicts without treating restore as successful', async () => {
    const user = userEvent.setup()
    vi.spyOn(workspaceApi, 'collectionSnapshots').mockResolvedValue({ snapshots, nextOffset: null })
    vi.spyOn(workspaceApi, 'collectionSnapshot').mockResolvedValue(detail)
    vi.spyOn(workspaceApi, 'collectionSnapshotDiff').mockResolvedValue(diff)
    vi.spyOn(workspaceApi, 'restoreCollectionSnapshot').mockRejectedValue(new Error('Snapshot conflict (SNAPSHOT_ITEM_MOVED)'))
    const onRestored = vi.fn()
    render(
      <CollectionSnapshotsDialog
        collectionId="collection-1"
        collectionName="Payments"
        dirty={false}
        canRestore
        onClose={vi.fn()}
        onRestored={onRestored}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Restore selected snapshot' }))
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }))

    expect(await screen.findByText('Snapshot conflict (SNAPSHOT_ITEM_MOVED)')).toBeInTheDocument()
    expect(onRestored).not.toHaveBeenCalled()
  })
})
