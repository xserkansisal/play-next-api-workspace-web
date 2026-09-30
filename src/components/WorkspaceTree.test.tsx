import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceTree } from '@/components/WorkspaceTree'
import type { CollectionResource } from '@/lib/workspace-types'

function folder(id: string, name: string, items: CollectionResource['items'] = []) {
  return { id, collectionId: 'c1', parentId: null, type: 'folder' as const, name, description: '', items }
}

function request(id: string, name: string) {
  return {
    id, collectionId: 'c1', parentId: null, type: 'request' as const, name, description: '',
    method: 'GET' as const, url: 'https://example.com', queryParams: [], headers: [], body: null,
    auth: { type: 'none' as const },
  }
}

const collections: CollectionResource[] = [{
  id: 'c1',
  name: 'Payments',
  description: '',
  items: [folder('f1', 'Charges', [folder('f2', 'Nested', [request('r1', 'Deep request')])])],
}]

function renderTree(props: Partial<React.ComponentProps<typeof WorkspaceTree>> = {}) {
  return render(
    <WorkspaceTree
      collections={collections}
      selected={null}
      onSelect={vi.fn()}
      onCreateCollection={vi.fn()}
      onCreateFolder={vi.fn()}
      onCreateRequest={vi.fn()}
      onDelete={vi.fn()}
      onShowEnvironments={vi.fn()}
      onShowTrash={vi.fn()}
      onShowHistory={vi.fn()}
      collapsed={false}
      {...props}
    />,
  )
}

describe('WorkspaceTree expand/collapse all', () => {
  it('collapses every collection and folder in one action', async () => {
    const user = userEvent.setup()
    renderTree()
    expect(screen.getByTitle('Move Deep request to Trash')).toBeTruthy()

    await user.click(screen.getByLabelText('Collapse all'))

    expect(screen.queryByTitle('Move Deep request to Trash')).toBeNull()
    expect(screen.queryByTitle('Move Charges to Trash')).toBeNull()
    expect(screen.getByTitle('Move Payments to Trash')).toBeTruthy()
  })

  it('expands everything again, including folders collapsed one at a time', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByLabelText('Collapse Nested'))
    expect(screen.queryByTitle('Move Deep request to Trash')).toBeNull()

    await user.click(screen.getByLabelText('Expand all'))
    expect(screen.getByTitle('Move Deep request to Trash')).toBeTruthy()
  })

  it('disables Expand all when nothing is collapsed and Collapse all when everything is', async () => {
    const user = userEvent.setup()
    renderTree()
    expect(screen.getByLabelText<HTMLButtonElement>('Expand all').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLButtonElement>('Collapse all').disabled).toBe(false)

    await user.click(screen.getByLabelText('Collapse all'))

    expect(screen.getByLabelText<HTMLButtonElement>('Expand all').disabled).toBe(false)
    expect(screen.getByLabelText<HTMLButtonElement>('Collapse all').disabled).toBe(true)
  })

  it('disables both while a search is active, because search already reveals matches', async () => {
    const user = userEvent.setup()
    renderTree()
    await user.type(screen.getByLabelText('Search collections'), 'Deep')

    expect(screen.getByLabelText<HTMLButtonElement>('Expand all').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLButtonElement>('Collapse all').disabled).toBe(true)
  })

  it('leaves a newly appearing folder expanded after a collapse all', async () => {
    const user = userEvent.setup()
    const { rerender } = renderTree()
    await user.click(screen.getByLabelText('Collapse all'))

    // A folder arriving later (created here, or over SSE) must not inherit the collapsed state
    // of the nodes that existed when "Collapse all" was pressed.
    const withNewCollection: CollectionResource[] = [
      ...collections,
      { id: 'c2', name: 'Refunds', description: '', items: [request('r2', 'List refunds')] },
    ]
    rerender(
      <WorkspaceTree
        collections={withNewCollection}
        selected={null}
        onSelect={vi.fn()}
        onCreateCollection={vi.fn()}
        onCreateFolder={vi.fn()}
        onCreateRequest={vi.fn()}
        onDelete={vi.fn()}
        onShowEnvironments={vi.fn()}
        onShowTrash={vi.fn()}
        onShowHistory={vi.fn()}
        collapsed={false}
      />,
    )

    expect(screen.getByTitle('Move List refunds to Trash')).toBeTruthy()
    expect(screen.queryByTitle('Move Charges to Trash')).toBeNull()
  })
})
