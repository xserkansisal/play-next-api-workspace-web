import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { VersionHistoryDialog } from '@/components/VersionHistoryDialog'
import { workspaceApi } from '@/lib/api'
import type { RequestResource } from '@/lib/workspace-types'

const request: RequestResource = {
  id: 'request-1',
  collectionId: 'collection-1',
  parentId: null,
  type: 'request',
  name: 'List orders',
  description: '',
  method: 'GET',
  url: '/current',
  queryParams: [],
  headers: [],
  body: null,
  auth: { type: 'none' },
}

const version = {
  id: 'version-1',
  snapshot: {
    type: 'request' as const,
    name: 'List orders',
    description: '',
    method: 'GET' as const,
    url: '/previous',
    queryParams: [],
    headers: [],
    body: null,
    auth: { type: 'none' as const },
  },
  createdAt: '2026-10-01T12:00:00.000Z',
  createdBy: 'ada@example.com',
}

describe('resource version history', () => {
  it('previews a selected snapshot, warns about unsaved edits, restores and refreshes history', async () => {
    const user = userEvent.setup()
    const restored = { ...request, url: '/previous' }
    const history = vi.spyOn(workspaceApi, 'itemVersions').mockResolvedValue([version])
    const restore = vi.spyOn(workspaceApi, 'restoreItemVersion').mockResolvedValue(restored)
    const onRestored = vi.fn()

    render(
      <VersionHistoryDialog
        draft={{ kind: 'request', collectionId: 'collection-1', resource: request }}
        dirty
        onClose={vi.fn()}
        onRestored={onRestored}
      />,
    )

    expect(await screen.findByText(/ada@example\.com/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /changes between current editor/i })).toHaveTextContent('/previous')
    await user.click(screen.getByRole('button', { name: 'Restore selected version' }))
    expect(screen.getByRole('alert')).toHaveTextContent('replace your unsaved editor changes')
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }))

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restored))
    expect(restore).toHaveBeenCalledWith('collection-1', 'request-1', 'version-1')
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('Version restored')
  })

  it('shows restore conflicts and does not update the resource on failure', async () => {
    const user = userEvent.setup()
    vi.spyOn(workspaceApi, 'itemVersions').mockResolvedValue([version])
    vi.spyOn(workspaceApi, 'restoreItemVersion').mockRejectedValue(new Error('Name conflict (409)'))
    const onRestored = vi.fn()
    render(
      <VersionHistoryDialog
        draft={{ kind: 'request', collectionId: 'collection-1', resource: request }}
        dirty={false}
        onClose={vi.fn()}
        onRestored={onRestored}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Restore selected version' }))
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }))

    expect(await screen.findByText('Name conflict (409)', { exact: true })).toBeInTheDocument()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('lets viewers inspect versions without offering restore actions', async () => {
    vi.spyOn(workspaceApi, 'itemVersions').mockResolvedValue([version])
    render(
      <VersionHistoryDialog
        draft={{ kind: 'request', collectionId: 'collection-1', resource: request }}
        dirty={false}
        canRestore={false}
        onClose={vi.fn()}
        onRestored={vi.fn()}
      />,
    )

    expect(await screen.findByText(/ada@example\.com/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument()
  })
})
