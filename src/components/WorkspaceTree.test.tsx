import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

// Collapsed state now persists in localStorage, so without this each test would inherit whatever
// the previous one collapsed.
beforeEach(() => {
  window.localStorage.clear()
})

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
      onClone={vi.fn()}
      cloningId={null}
      onShowTrash={vi.fn()}
      onShowHistory={vi.fn()}
      collapsed={false}
      environments={[]}
      onCreateEnvironment={vi.fn()}
      width={260}
      onResize={vi.fn()}
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
        onClone={vi.fn()}
        cloningId={null}
        onShowTrash={vi.fn()}
        onShowHistory={vi.fn()}
        collapsed={false}
        environments={[]}
        onCreateEnvironment={vi.fn()}
        width={260}
        onResize={vi.fn()}
      />,
    )

    expect(screen.getByTitle('Move List refunds to Trash')).toBeTruthy()
    expect(screen.queryByTitle('Move Charges to Trash')).toBeNull()
  })

  it('reopens with the same nodes collapsed after a reload', async () => {
    const user = userEvent.setup()
    const first = renderTree()
    await user.click(screen.getByLabelText('Collapse Charges'))
    expect(screen.queryByText('Nested')).toBeNull()

    // Unmounting and mounting again is what a page reload does to this component.
    first.unmount()
    renderTree()
    expect(screen.queryByText('Nested')).toBeNull()
    expect(screen.getByText('Payments')).toBeTruthy()
  })

  it('does not forget collapsed state on a render where the tree is still empty', () => {
    // Collections arrive asynchronously; an empty first render must not wipe saved state.
    const first = renderTree()
    first.unmount()
    window.localStorage.setItem('play-next-api-workspace.collapsed-tree-nodes.v1', JSON.stringify(['f1']))

    const loading = renderTree({ collections: [] })
    loading.unmount()

    renderTree()
    expect(screen.queryByText('Nested')).toBeNull()
  })

})

const environments = [
  { id: 'e1', name: 'localhost-develop', variables: [], createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' },
  { id: 'e2', name: 'staging', variables: [], createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' },
] as unknown as React.ComponentProps<typeof WorkspaceTree>['environments']

describe('environments in the sidebar tree', () => {
  it('lists environments alongside collections, rather than behind a separate view', () => {
    renderTree({ environments })
    expect(screen.getByRole('navigation', { name: 'Environments' })).toBeTruthy()
    expect(screen.getByTitle('localhost-develop')).toBeTruthy()
    expect(screen.getByTitle('staging')).toBeTruthy()
  })

  it('opens an environment from the tree', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderTree({ environments, onSelect })

    await user.click(screen.getByTitle('localhost-develop'))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'environment', environmentId: 'e1' })
  })

  it('marks the open environment as selected', () => {
    renderTree({ environments, selected: { kind: 'environment', environmentId: 'e2' } })
    const row = screen.getByTitle('staging').closest('.tree-row')
    expect(row?.className).toContain('selected')
  })

  it('deletes an environment from the tree', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderTree({ environments, onDelete })

    await user.click(screen.getByLabelText('Move staging to Trash'))
    expect(onDelete).toHaveBeenCalledWith({ kind: 'environment', environmentId: 'e2' })
  })

  it('says so when there are none, rather than showing an empty area', () => {
    renderTree({ environments: [] })
    expect(screen.getByText('No environments yet.')).toBeTruthy()
  })

  it('filters environments by the same search as collections', async () => {
    const user = userEvent.setup()
    renderTree({ environments })

    await user.type(screen.getByLabelText('Search collections'), 'stag')
    expect(screen.queryByTitle('localhost-develop')).toBeNull()
    expect(screen.getByTitle('staging')).toBeTruthy()
    // The collections side reports its own emptiness rather than looking broken.
    expect(screen.getByText('No matching collections.')).toBeTruthy()
  })
})

describe('foldable sidebar sections', () => {
  it('folds the environments section away and back', async () => {
    const user = userEvent.setup()
    renderTree({ environments })

    await user.click(screen.getByLabelText('Collapse Environments'))
    expect(screen.queryByTitle('staging')).toBeNull()
    // The header stays, so the section can be brought back.
    expect(screen.getByLabelText('Expand Environments')).toBeTruthy()

    await user.click(screen.getByLabelText('Expand Environments'))
    expect(screen.getByTitle('staging')).toBeTruthy()
  })

  it('folds the collections section without touching the environments one', async () => {
    const user = userEvent.setup()
    renderTree({ environments })

    await user.click(screen.getByLabelText('Collapse Collections'))
    expect(screen.queryByTitle('Move Payments to Trash')).toBeNull()
    expect(screen.getByTitle('staging')).toBeTruthy()
  })

  it('remembers a folded section across a remount, like any other collapsed node', async () => {
    const user = userEvent.setup()
    const { unmount } = renderTree({ environments })
    await user.click(screen.getByLabelText('Collapse Environments'))
    unmount()

    renderTree({ environments })
    expect(screen.queryByTitle('staging')).toBeNull()
  })

  it('does not let pruning forget a folded section, which owns no resource id', async () => {
    const user = userEvent.setup()
    const { unmount } = renderTree({ environments })
    // Pruning runs against the collection/folder ids; a section id belongs to neither and would be
    // dropped if it were not registered as known.
    await user.click(screen.getByLabelText('Collapse Environments'))
    await user.click(screen.getByLabelText('Collapse Collections'))
    unmount()

    renderTree({ environments })
    expect(screen.getByLabelText('Expand Environments')).toBeTruthy()
    expect(screen.getByLabelText('Expand Collections')).toBeTruthy()
  })

  it('shows a count so a folded section still says how much is inside', () => {
    renderTree({ environments })
    const header = screen.getByLabelText('Collapse Environments')
    expect(header.textContent).toContain('2')
  })
})

describe('sidebar width', () => {
  it('applies the width it is given', () => {
    const { container } = renderTree({ width: 420 })
    const sidebar = container.querySelector('.sidebar') as HTMLElement
    expect(sidebar.style.width).toBe('420px')
    // min-width is set too, or the stylesheet's own minimum would win over a narrower drag.
    expect(sidebar.style.minWidth).toBe('420px')
  })

  it('caps the applied width on a narrow window, so a stored width cannot cover the editor', () => {
    const original = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true })
    try {
      const { container } = renderTree({ width: 640 })
      const sidebar = container.querySelector('.sidebar') as HTMLElement
      expect(sidebar.style.width).toBe('300px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: original, configurable: true })
    }
  })

  it('leaves the width to the stylesheet when collapsed, so the rail is not forced open', () => {
    const { container } = renderTree({ width: 420, collapsed: true })
    const sidebar = container.querySelector('.sidebar') as HTMLElement
    expect(sidebar.style.width).toBe('')
  })

  it('hides the drag handle when collapsed, since there is nothing to resize', () => {
    renderTree({ collapsed: true })
    expect(screen.queryByLabelText('Resize sidebar')).toBeNull()
  })

  it('reports the pointer position while dragging', async () => {
    const onResize = vi.fn()
    renderTree({ onResize })
    const handle = screen.getByLabelText('Resize sidebar')

    // jsdom has no PointerEvent constructor; MouseEvent carries the clientX this code reads.
    const pointer = (type: string, clientX = 0) =>
      new MouseEvent(type, { bubbles: true, clientX })

    handle.dispatchEvent(pointer('pointerdown'))
    window.dispatchEvent(pointer('pointermove', 330))
    expect(onResize).toHaveBeenCalledWith(330)

    window.dispatchEvent(pointer('pointerup'))
    window.dispatchEvent(pointer('pointermove', 500))
    // Still 330: releasing must stop the drag, or the sidebar would follow the pointer forever.
    expect(onResize).toHaveBeenCalledTimes(1)
  })
})

describe('duplicating from the tree', () => {
  it('offers a duplicate button on collections, folders, requests and environments', async () => {
    const user = userEvent.setup()
    const onClone = vi.fn()
    renderTree({
      onClone,
      environments: [{ id: 'e1', name: 'Local', variables: [] }],
    })

    await user.click(screen.getByLabelText('Duplicate Payments'))
    await user.click(screen.getByLabelText('Duplicate Charges'))
    await user.click(screen.getByLabelText('Duplicate Nested'))
    await user.click(screen.getByLabelText('Duplicate Deep request'))
    await user.click(screen.getByLabelText('Duplicate Local'))

    expect(onClone.mock.calls.map(([resource]) => resource)).toEqual([
      { kind: 'collection', collectionId: 'c1' },
      { kind: 'folder', collectionId: 'c1', itemId: 'f1' },
      { kind: 'folder', collectionId: 'c1', itemId: 'f2' },
      { kind: 'request', collectionId: 'c1', itemId: 'r1' },
      { kind: 'environment', environmentId: 'e1' },
    ])
  })

  it('will not start a second copy of the row already being copied', async () => {
    const user = userEvent.setup()
    const onClone = vi.fn()
    renderTree({ onClone, cloningId: 'f1' })

    await user.click(screen.getByLabelText('Duplicate Charges'))
    expect(onClone).not.toHaveBeenCalled()

    // Only that row waits; the rest of the tree is still usable.
    await user.click(screen.getByLabelText('Duplicate Nested'))
    expect(onClone).toHaveBeenCalledTimes(1)
  })
})
