import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
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
  const treeProps: React.ComponentProps<typeof WorkspaceTree> = {
    collections,
    selected: null,
    onSelect: vi.fn(),
    onCreateCollection: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateRequest: vi.fn(),
    onDelete: vi.fn(),
    onClone: vi.fn(),
    cloningId: null,
    onShowTrash: vi.fn(),
    onShowHistory: vi.fn(),
    collapsed: false,
    environments: [],
    onActivateEnvironment: vi.fn(),
    resolvedVariables: {},
    variablesByScope: { user: [], environment: [], global: [] },
    variableFilter: '',
    onVariableFilterChange: vi.fn(),
    onOpenVariableScope: vi.fn(),
    onCreateEnvironment: vi.fn(),
    activeEnvironmentId: '',
    width: 260,
    onResize: vi.fn(),
    ...props,
  }
  function StatefulTree() {
    const [variableFilter, setVariableFilter] = useState(treeProps.variableFilter)
    return <WorkspaceTree
      {...treeProps}
      variableFilter={variableFilter}
      onVariableFilterChange={(value) => {
        setVariableFilter(value)
        treeProps.onVariableFilterChange(value)
      }}
    />
  }
  return render(<StatefulTree />)
}

describe('WorkspaceTree expand/collapse all', () => {
  it('hides write actions and Trash for a viewer while keeping resources readable', () => {
    renderTree({ canEdit: false, canAccessTrash: false })

    expect(screen.getByRole('button', { name: 'Payments' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New collection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicate Payments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trash' })).not.toBeInTheDocument()
  })

  it('shows each viewer beside the collection, folder, and request they have open', () => {
    renderTree({
      presenceByResource: {
        'collection:c1': [{
          userId: 'u3',
          firstName: 'Ece',
          lastName: 'Demir',
          location: { kind: 'collection', collectionId: 'c1' },
        }],
        'folder:c1:f1': [{
          userId: 'u2',
          firstName: 'Mehmet',
          lastName: 'Kaya',
          location: { kind: 'folder', collectionId: 'c1', itemId: 'f1' },
        }],
        'request:c1:r1': [{
          userId: 'u1',
          firstName: 'Ayse',
          lastName: 'Yilmaz',
          location: { kind: 'request', collectionId: 'c1', itemId: 'r1' },
        }],
      },
    })

    expect(screen.getByRole('img', { name: 'Viewing now: Ece Demir' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Viewing now: Mehmet Kaya' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Viewing now: Ayse Yilmaz' })).toBeInTheDocument()
  })

  it('marks only collapsed parents of a viewed child, so open folders stay uncluttered', async () => {
    const user = userEvent.setup()
    renderTree({
      presenceByResource: {
        'request:c1:r1': [{
          userId: 'u1',
          firstName: 'Ayse',
          lastName: 'Yilmaz',
          location: { kind: 'request', collectionId: 'c1', itemId: 'r1' },
        }],
      },
    })

    expect(screen.getByRole('img', { name: 'Viewing now: Ayse Yilmaz' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Viewing inside/ })).toBeNull()

    await user.click(screen.getByLabelText('Collapse Nested'))
    expect(screen.getByRole('img', { name: 'Viewing inside: Ayse Yilmaz → Deep request' })).toBeInTheDocument()

    await user.click(screen.getByLabelText('Collapse all'))

    expect(screen.queryByRole('img', { name: 'Viewing now: Ayse Yilmaz' })).toBeNull()
    expect(screen.getByRole('img', { name: 'Viewing inside: Ayse Yilmaz → Charges / Nested / Deep request' })).toBeInTheDocument()
  })

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
    await user.type(screen.getByLabelText('Search collections and environments and variables'), 'Deep')

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
        onActivateEnvironment={vi.fn()}
        resolvedVariables={{}}
        variablesByScope={{ user: [], environment: [], global: [] }}
        variableFilter=""
        onVariableFilterChange={vi.fn()}
        onOpenVariableScope={vi.fn()}
        onCreateEnvironment={vi.fn()}
        activeEnvironmentId=""
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

  it('does not activate an environment when its name is opened', async () => {
    const user = userEvent.setup()
    const onActivateEnvironment = vi.fn()
    renderTree({ environments, onActivateEnvironment })

    await user.click(screen.getByTitle('localhost-develop'))

    expect(onActivateEnvironment).not.toHaveBeenCalled()
  })

  it('activates an environment only from its adjacent selection button', async () => {
    const user = userEvent.setup()
    const onActivateEnvironment = vi.fn()
    renderTree({ environments, onActivateEnvironment })

    await user.click(screen.getByRole('button', { name: 'Use staging' }))

    expect(onActivateEnvironment).toHaveBeenCalledWith('e2')
  })

  it('keeps the no-environment option available in the tree', async () => {
    const user = userEvent.setup()
    const onActivateEnvironment = vi.fn()
    renderTree({ environments, activeEnvironmentId: 'e1', onActivateEnvironment })

    await user.click(screen.getByRole('button', { name: 'Use no environment' }))

    expect(onActivateEnvironment).toHaveBeenCalledWith('')
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

  it('filters environments using the shared search and reports unmatched collections', async () => {
    const user = userEvent.setup()
    renderTree({ environments })

    await user.type(screen.getByLabelText('Search collections and environments and variables'), 'stag')
    expect(screen.queryByTitle('localhost-develop')).toBeNull()
    expect(screen.getByTitle('staging')).toBeTruthy()
    expect(screen.getByText('No matching collections.')).toBeTruthy()
  })

  it('filters environments out when the shared search matches only a collection', async () => {
    const user = userEvent.setup()
    renderTree({ environments })

    await user.type(screen.getByLabelText('Search collections and environments and variables'), 'Payments')

    expect(screen.getByTitle('Payments')).toBeTruthy()
    expect(screen.queryByTitle('localhost-develop')).toBeNull()
    expect(screen.queryByTitle('staging')).toBeNull()
    expect(screen.getByText('No matching environments.')).toBeTruthy()
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

  it('keeps Variables as a sibling section and folds it independently', async () => {
    const user = userEvent.setup()
    const { container } = renderTree({
      environments,
      resolvedVariables: { token: { value: 'secret', origin: 'user', shadowed: [] } },
    })

    const variablesSection = container.querySelector('.variables-section')
    const environmentsSection = container.querySelector('.environments-section')
    expect(variablesSection).toBeTruthy()
    expect(variablesSection?.parentElement).toBe(environmentsSection?.parentElement)
    expect(environmentsSection?.contains(variablesSection)).toBe(false)
    expect(screen.getByRole('button', { name: 'Open Only me variables' })).toBeTruthy()

    await user.click(screen.getByLabelText('Collapse Environments'))
    expect(screen.queryByTitle('staging')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Only me variables' })).toBeTruthy()

    await user.click(screen.getByLabelText('Collapse Variables'))
    expect(screen.queryByRole('button', { name: 'Open Only me variables' })).toBeNull()
    expect(screen.getByLabelText('Expand Variables')).toBeTruthy()
    expect(screen.getByLabelText('Expand Environments')).toBeTruthy()
  })

  it('shows defined and request-usable counts for each scope', () => {
    const { container } = renderTree({
      resolvedVariables: {
        shared: { value: 'personal', origin: 'user', shadowed: ['global'] },
        one: { value: '1', origin: 'global', shadowed: [] },
        two: { value: '2', origin: 'global', shadowed: [] },
        three: { value: '3', origin: 'global', shadowed: [] },
      },
      variablesByScope: {
        user: [{ key: 'shared', value: 'personal' }],
        environment: [],
        global: [
          { key: 'shared', value: 'default' },
          { key: 'one', value: '1' },
          { key: 'two', value: '2' },
          { key: 'three', value: '3' },
        ],
      },
    })

    expect(container.querySelectorAll('.sidebar-variable-icon')).toHaveLength(3)
    expect(container.querySelector('.sidebar-variable-scope[aria-label="Open Team variables"] .sidebar-variable-count')?.textContent?.replace(/\s/g, '')).toBe('4(3)')
    expect(screen.getByRole('button', { name: 'Open Team variables' })).toHaveAttribute('title', '4 defined, 3 usable in requests')
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
    await user.click(screen.getByLabelText('Collapse Variables'))
    unmount()

    renderTree({ environments })
    expect(screen.getByLabelText('Expand Environments')).toBeTruthy()
    expect(screen.getByLabelText('Expand Collections')).toBeTruthy()
    expect(screen.getByLabelText('Expand Variables')).toBeTruthy()
  })

  it('shows a count so a folded section still says how much is inside', () => {
    renderTree({ environments })
    const header = screen.getByLabelText('Collapse Environments')
    expect(header.textContent).toContain('2')
  })
})

describe('request method badges', () => {
  function withMethods(): CollectionResource[] {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
    return [{
      id: 'c1',
      name: 'Payments',
      description: '',
      items: methods.map((method, index) => ({
        ...request(`r${index}`, `Call ${method}`),
        method,
      })),
    }]
  }

  it('labels each request with its method instead of an undifferentiated dot', () => {
    const { container } = renderTree({ collections: withMethods() })
    const badges = [...container.querySelectorAll('.tree-method')].map((node) => node.textContent?.trim())
    // Rows are name-sorted, so this is "Call DELETE" through "Call PUT".
    // DELETE is the only method abbreviated, because it is the only one that does not fit.
    expect(badges).toEqual(['DEL', 'GET', 'PATCH', 'POST', 'PUT'])
  })

  it('colour-codes the badge by method, so the tree is scannable without reading each label', () => {
    const { container } = renderTree({ collections: withMethods() })
    const classes = [...container.querySelectorAll('.tree-method')].map((node) => node.className)
    expect(classes).toEqual([
      'tree-method method-delete',
      'tree-method method-get',
      'tree-method method-patch',
      'tree-method method-post',
      'tree-method method-put',
    ])
  })

  it('keeps the full method available on hover, since DEL is an abbreviation', () => {
    const { container } = renderTree({ collections: withMethods() })
    const del = container.querySelector('.method-delete')
    expect(del?.getAttribute('title')).toBe('DELETE')
  })

  it('does not put a method badge on folders or collections', () => {
    const { container } = renderTree()
    expect(container.querySelectorAll('.tree-method').length).toBe(1)
  })
})

describe('ordering inside a collection', () => {
  const mixed: CollectionResource[] = [{
    id: 'c1',
    name: 'Payments',
    description: '',
    items: [
      request('r1', 'zebra request'),
      folder('f1', 'Zebra folder'),
      request('r2', 'alpha request'),
      folder('f2', 'Alpha folder', [request('r3', 'inner zebra'), folder('f3', 'Inner folder')]),
    ],
  }]

  function names(container: HTMLElement) {
    return [...container.querySelectorAll('.tree-row:not(.collection):not(.environment) .tree-name')].map((n) => n.textContent?.trim())
  }

  it('groups folders above requests, each alphabetical, so structure stays scannable', () => {
    const { container } = renderTree({ collections: mixed })
    expect(names(container)).toEqual([
      'Alpha folder', 'Inner folder', 'inner zebra',
      'Zebra folder',
      'alpha request', 'zebra request',
    ])
  })

  it('applies the same grouping inside nested folders, not just at the collection root', () => {
    const { container } = renderTree({ collections: mixed })
    const all = names(container)
    expect(all.indexOf('Inner folder')).toBeLessThan(all.indexOf('inner zebra'))
  })
})

describe('the active environment', () => {
  function rowFor(name: string) {
    return screen.getByTitle(new RegExp(`^${name}`)).closest('.tree-row')
  }

  it('marks the environment applied to requests, not merely the one open in the editor', () => {
    renderTree({ environments, activeEnvironmentId: 'e1', selected: { kind: 'environment', environmentId: 'e2' } })

    expect(rowFor('localhost-develop')?.className).toContain('active-environment')
    // e2 is open in the editor, but e1 is the one whose variables resolve.
    expect(rowFor('staging')?.className).not.toContain('active-environment')
    expect(rowFor('staging')?.className).toContain('selected')
  })

  it('labels the active row and disables its selection button', () => {
    renderTree({ environments, activeEnvironmentId: 'e2' })

    const activeButton = screen.getByRole('button', { name: 'staging is active' })
    expect(activeButton.closest('.tree-row')).toBe(rowFor('staging'))
    expect(activeButton).toBeDisabled()
  })

  it('marks no environment active when none is selected', () => {
    const { container } = renderTree({ environments, activeEnvironmentId: '' })
    expect(container.querySelectorAll('.active-environment').length).toBe(0)
    expect(screen.queryByRole('button', { name: 'localhost-develop is active' })).toBeNull()
    expect(screen.getByRole('button', { name: 'No environment is active' })).toBeDisabled()
  })
})

describe('collection indent guides', () => {
  it('gives each row its depth, so the stylesheet can draw one guide per ancestor level', () => {
    const { container } = renderTree()
    const depthOf = (name: string) =>
      (screen.getByTitle(name).closest('.tree-row') as HTMLElement).style.getPropertyValue('--indent')

    // Payments is a collection (top level) and carries no inline depth.
    expect((screen.getByTitle('Payments').closest('.tree-row') as HTMLElement).style.getPropertyValue('--indent')).toBe('')
    expect(depthOf('Charges')).toBe('1')
    expect(depthOf('Nested')).toBe('2')
    expect(depthOf('Deep request')).toBe('3')
    expect(container.querySelectorAll('.tree-row:not(.environment)').length).toBe(4)
  })
})

describe('dragging rows to reparent them', () => {
  // jsdom has no DataTransfer; the component only needs these four members.
  function transfer() {
    const store: Record<string, string> = {}
    return {
      effectAllowed: '',
      dropEffect: '',
      setData: (key: string, value: string) => { store[key] = value },
      getData: (key: string) => store[key] ?? '',
    }
  }

  function rowOf(name: string) {
    return screen.getByTitle(name).closest('.tree-row') as HTMLElement
  }

  function dragOnto(from: string, to: string) {
    const dataTransfer = transfer()
    fireEvent.dragStart(rowOf(from), { dataTransfer })
    fireEvent.dragOver(rowOf(to), { dataTransfer })
    fireEvent.drop(rowOf(to), { dataTransfer })
  }

  it('moves a request into the folder it is dropped on', () => {
    const onMove = vi.fn()
    renderTree({ onMove })

    dragOnto('Deep request', 'Charges')

    expect(onMove).toHaveBeenCalledWith(
      { collectionId: 'c1', itemId: 'r1' },
      { kind: 'folder', collectionId: 'c1', itemId: 'f1' },
    )
  })

  it('moves a node to the collection root when dropped on the collection row', () => {
    const onMove = vi.fn()
    renderTree({ onMove })

    dragOnto('Nested', 'Payments')

    expect(onMove).toHaveBeenCalledWith(
      { collectionId: 'c1', itemId: 'f2' },
      { kind: 'collection', collectionId: 'c1' },
    )
  })

  it('refuses to drop a folder into its own subfolder', () => {
    const onMove = vi.fn()
    renderTree({ onMove })

    dragOnto('Charges', 'Nested')

    expect(onMove).not.toHaveBeenCalled()
  })

  it('refuses a drop back onto the parent the node already has', () => {
    const onMove = vi.fn()
    renderTree({ onMove })

    dragOnto('Deep request', 'Nested')

    expect(onMove).not.toHaveBeenCalled()
  })

  it('marks the row in flight and rings the destination under the pointer', () => {
    renderTree({ onMove: vi.fn() })
    const dataTransfer = transfer()

    fireEvent.dragStart(rowOf('Deep request'), { dataTransfer })
    fireEvent.dragOver(rowOf('Charges'), { dataTransfer })

    expect(rowOf('Deep request').className).toContain('dragging')
    expect(rowOf('Charges').className).toContain('drop-into')
    // The illegal destination never lights up.
    expect(rowOf('Nested').className).not.toContain('drop-into')
  })

  it('clears the drag state once the gesture ends', () => {
    renderTree({ onMove: vi.fn() })
    const dataTransfer = transfer()

    fireEvent.dragStart(rowOf('Deep request'), { dataTransfer })
    fireEvent.dragOver(rowOf('Charges'), { dataTransfer })
    fireEvent.dragEnd(rowOf('Deep request'), { dataTransfer })

    expect(rowOf('Deep request').className).not.toContain('dragging')
    expect(rowOf('Charges').className).not.toContain('drop-into')
  })

  it('accepts no drops at all when the tree is rendered without a move handler', () => {
    const { container } = renderTree()
    const dataTransfer = transfer()

    fireEvent.dragStart(rowOf('Deep request'), { dataTransfer })
    fireEvent.dragOver(rowOf('Charges'), { dataTransfer })

    expect(container.querySelectorAll('.drop-into').length).toBe(0)
  })
})

describe('container icons', () => {
  function toggleFor(name: string) {
    return screen.getByLabelText(new RegExp(`^(Collapse|Expand) ${name}$`))
  }

  it('gives collections an archive box and folders a folder, so the two tiers stay distinct', () => {
    const { container } = renderTree()
    expect(toggleFor('Payments').querySelector('.tree-collection-icon')).toBeTruthy()
    expect(toggleFor('Charges').querySelector('.tree-folder-icon')).toBeTruthy()
    // The old text mark is gone; the icon is the only collection glyph.
    expect(container.querySelectorAll('.tree-collection-mark').length).toBe(0)
  })

  it('swaps the collection icon between its open and closed shapes', async () => {
    const user = userEvent.setup()
    renderTree()
    const shapeOf = (name: string) =>
      [...toggleFor(name).querySelectorAll('.tree-collection-icon path')].map((p) => p.getAttribute('d')).join('|')

    const openShape = shapeOf('Payments')
    await user.click(toggleFor('Payments'))
    const closedShape = shapeOf('Payments')

    expect(toggleFor('Payments').getAttribute('aria-label')).toBe('Expand Payments')
    expect(closedShape).not.toBe(openShape)
    expect(closedShape.length).toBeGreaterThan(0)
  })

  it('keeps the expand/collapse label on the icon button, since the glyph alone is not readable', () => {
    renderTree()
    expect(toggleFor('Payments').getAttribute('aria-label')).toBe('Collapse Payments')
    expect(toggleFor('Charges').getAttribute('aria-label')).toBe('Collapse Charges')
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

describe('header tool icons', () => {
  // These were Unicode glyphs whose size and weight varied by platform font. Asserting on SVG keeps
  // anyone from reintroducing a glyph, which would also lose the create badge.
  it('draws every tool button as an icon rather than a text glyph', () => {
    renderTree()
    for (const label of ['Expand all', 'Collapse all', 'New request', 'New folder', 'New collection']) {
      const button = screen.getByLabelText(label)
      expect(button.querySelector('svg.tool-icon')).toBeTruthy()
      expect(button.textContent).toBe('')
    }
  })

  it('badges the three create actions so they read as creating, not navigating', () => {
    renderTree()
    for (const label of ['New request', 'New folder', 'New collection']) {
      const icon = screen.getByLabelText(label).querySelector('svg.tool-icon')!
      // Base shape is scaled into a group; the badge is a sibling so it keeps full size.
      expect(icon.querySelector('g[transform]')).toBeTruthy()
      expect(icon.children.length).toBe(2)
    }
    expect(screen.getByLabelText('Expand all').querySelector('g[transform]')).toBeNull()
  })

  it('points the fold arrows outward to expand and inward to collapse', () => {
    renderTree()
    const shape = (label: string) =>
      [...screen.getByLabelText(label).querySelectorAll('path')].map((p) => p.getAttribute('d')).join('|')

    expect(shape('Expand all')).not.toBe(shape('Collapse all'))
  })
})
