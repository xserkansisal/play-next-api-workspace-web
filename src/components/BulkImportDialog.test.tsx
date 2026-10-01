import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { BulkImportDialog } from '@/components/BulkImportDialog'
import type { BulkImportResult } from '@/lib/api'
import type { CollectionResource } from '@/lib/workspace-types'

beforeAll(() => {
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value(this: File) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    },
  })
})

const collection: CollectionResource = {
  id: 'collection-1',
  name: 'Shop API',
  description: '',
  items: [{
    id: 'folder-1',
    type: 'folder',
    collectionId: 'collection-1',
    parentId: null,
    name: 'Products',
    description: '',
    items: [],
  }],
}

const previewResult: BulkImportResult = {
  collectionId: collection.id,
  parentId: 'folder-1',
  dryRun: true,
  created: { folders: 1, requests: 1 },
  renamed: [{ path: ['Auth'], from: 'Auth', to: 'Auth (copy)' }],
  warnings: [{ path: ['Auth', 'Login'], code: 'SENSITIVE_HEADER', header: 'Authorization' }],
  roots: [],
  changedAt: '2026-10-02T00:00:00.000Z',
}

const committedResult: BulkImportResult = { ...previewResult, dryRun: false, roots: [{ id: 'new-root', kind: 'folder' }] }
const fileContent = JSON.stringify({
  onConflict: 'rename',
  items: [{ type: 'folder', name: 'Auth', items: [{ type: 'request', name: 'Login', method: 'POST', url: '{{baseUrl}}/login' }] }],
})

function renderDialog(overrides: Partial<React.ComponentProps<typeof BulkImportDialog>> = {}) {
  const props = {
    collections: [collection],
    initialCollectionId: collection.id,
    initialParentId: 'folder-1',
    onCancel: vi.fn(),
    onComplete: vi.fn(),
    onPreview: vi.fn(async () => previewResult),
    onImport: vi.fn(async () => ({ result: committedResult })),
    ...overrides,
  }
  return { ...render(<BulkImportDialog {...props} />), props }
}

describe('BulkImportDialog', () => {
  it('previews with the selected parent and conflict policy before committing', async () => {
    const user = userEvent.setup()
    const { props } = renderDialog()
    await user.upload(screen.getByLabelText('Bulk import JSON file'), new File([fileContent], 'api-import.json', { type: 'application/json' }))

    expect(await screen.findByText(/Valid bulk import file/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview import' }))

    expect(await screen.findByText('Folders that will be renamed')).toBeInTheDocument()
    expect(screen.getByText(/Authorization may contain a sensitive value/)).toBeInTheDocument()
    expect(props.onPreview).toHaveBeenCalledWith(collection.id, expect.objectContaining({
      parentId: 'folder-1',
      onConflict: 'rename',
      dryRun: true,
    }))

    await user.click(screen.getByRole('button', { name: 'Import 2 items' }))
    expect(await screen.findByText('Your API items are ready')).toBeInTheDocument()
    expect(props.onImport).toHaveBeenCalledWith(collection.id, expect.objectContaining({
      parentId: 'folder-1',
      onConflict: 'rename',
      dryRun: false,
    }))

    await user.click(screen.getByRole('button', { name: 'View collection' }))
    expect(props.onComplete).toHaveBeenCalledWith(collection.id, 'folder-1')
  })

  it('offers a rename preview when fail-on-conflict returns 409', async () => {
    const user = userEvent.setup()
    const conflict = Object.assign(new Error('A folder named "Auth" already exists'), {
      isAxiosError: true,
      response: { data: { error: { code: 'FOLDER_NAME_CONFLICT', message: 'A folder named "Auth" already exists' } } },
    })
    const onPreview = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(previewResult)
    renderDialog({ onPreview })
    await user.upload(screen.getByLabelText('Bulk import JSON file'), new File([
      JSON.stringify({ onConflict: 'fail', items: [{ type: 'folder', name: 'Auth' }] }),
    ], 'api-import.json', { type: 'application/json' }))
    await user.click(await screen.findByRole('button', { name: 'Preview import' }))

    expect(await screen.findByText('No items were written. Choose Rename on conflict to preview the automatic folder names.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview with Rename' }))
    await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(collection.id, expect.objectContaining({
      onConflict: 'rename',
      dryRun: true,
    })))
    expect(await screen.findByText('Folders that will be renamed')).toBeInTheDocument()
  })

  it('shows file validation errors and does not enable preview', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(screen.getByLabelText('Bulk import JSON file'), new File(['{"items": []}'], 'empty.json', { type: 'application/json' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one item')
    expect(screen.getByRole('button', { name: 'Preview import' })).toBeDisabled()
  })
})
