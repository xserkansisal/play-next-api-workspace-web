import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { CollectionExportDialog } from '@/components/CollectionExportDialog'
import { OpenApiCreateDialog } from '@/components/OpenApiCreateDialog'
import { OpenApiSyncDialog } from '@/components/OpenApiSyncDialog'
import type { OpenApiSyncApplyResult, OpenApiSyncPreview } from '@/lib/openapi'
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

const SPEC = 'openapi: 3.1.0\ninfo:\n  title: Shop\n  version: 1.0.0\npaths: {}\n'

function apiError(code: string, status = 400, details?: Record<string, unknown>) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: { code, message: `API said ${code}`, ...(details ? { details } : {}) } },
  })
}

const collection: CollectionResource = {
  id: 'c1',
  name: 'Shop API',
  description: '',
  items: [
    { id: 'r1', type: 'request', collectionId: 'c1', parentId: null, name: 'Old list products', method: 'GET', url: '/products' },
    { id: 'r2', type: 'request', collectionId: 'c1', parentId: null, name: 'Update product', method: 'PUT', url: '/products/1' },
    { id: 'r3', type: 'request', collectionId: 'c1', parentId: null, name: 'Legacy export', method: 'GET', url: '/export' },
  ] as CollectionResource['items'],
}

function makePreview(token = 'a'): OpenApiSyncPreview {
  return {
    collectionId: 'c1',
    linked: false,
    source: { title: 'Shop', version: '1.0.0' },
    previewToken: token.repeat(64),
    warnings: [{ code: 'UNSUPPORTED_SECURITY', method: 'get', path: '/products' }],
    changes: [
      { key: 'operationId:listProducts', kind: 'adopt', method: 'GET', path: '/products', operationId: 'listProducts', candidateItemIds: ['r1'] },
      {
        key: 'operationId:updateProduct',
        kind: 'conflict',
        method: 'PUT',
        path: '/products/{id}',
        itemId: 'r2',
        changedFields: ['url'],
        before: { url: '/products/1' },
        after: { url: '/products/{{id}}' },
      },
      { key: 'operationId:export', kind: 'delete', method: 'GET', path: '/export', itemId: 'r3' },
      { key: 'operationId:health', kind: 'missing', method: 'GET', path: '/health', itemId: 'gone', recreatable: true },
      { key: 'operationId:createProduct', kind: 'add', method: 'POST', path: '/products' },
    ],
  }
}

const applyResult: OpenApiSyncApplyResult = {
  collectionId: 'c1',
  changedAt: '2024-01-01T00:00:00.000Z',
  deletedItemIds: ['r3'],
  applied: { added: 1, adopted: 1, updated: 0, moved: 0, deleted: 1, recreated: 1 },
  pending: [],
}

async function choosePreview(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('OpenAPI file'), new File([SPEC], 'shop.yaml'))
  await user.click(screen.getByRole('button', { name: 'Preview changes' }))
  await screen.findByRole('heading', { name: 'Review sync changes' })
  await screen.findByRole('region', { name: 'Conflicts' })
}

describe('OpenApiSyncDialog', () => {
  it('requires conflict choices and sends only the selected decisions', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn().mockResolvedValue(makePreview())
    const onApply = vi.fn().mockResolvedValue({ result: applyResult })
    render(<OpenApiSyncDialog collections={[collection]} onCancel={vi.fn()} onPreview={onPreview} onApply={onApply} onComplete={vi.fn()} />)

    await choosePreview(user)
    expect(onPreview).toHaveBeenCalledWith('c1', SPEC)
    expect(screen.getByText(/Request: Update product/)).toBeInTheDocument()
    expect(screen.getByText(/GET \/products: the security requirement cannot be represented/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resolve 1 conflict(s)' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText(/Choose a version for 1 conflict/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Use document version' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /Adopt existing request/ }), 'Adopt Old list products')
    await user.click(screen.getByRole('checkbox', { name: 'Move to Trash' }))
    await user.click(screen.getByRole('checkbox', { name: 'Recreate request' }))
    await user.dblClick(screen.getByRole('button', { name: 'Apply sync' }))

    await screen.findByRole('heading', { name: 'Sync applied' })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith('c1', {
      spec: SPEC,
      previewToken: 'a'.repeat(64),
      adopt: { 'operationId:listProducts': 'r1' },
      conflicts: { 'operationId:updateProduct': 'spec' },
      deleteItemIds: ['r3'],
      recreate: ['operationId:health'],
    })
  })

  it('keeps deletions opt-in', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn().mockResolvedValue({ result: applyResult })
    render(<OpenApiSyncDialog collections={[collection]} onCancel={vi.fn()} onPreview={vi.fn().mockResolvedValue(makePreview())} onApply={onApply} onComplete={vi.fn()} />)

    await choosePreview(user)
    await user.click(screen.getByRole('radio', { name: 'Keep local request' }))
    await user.click(screen.getByRole('button', { name: 'Apply sync' }))

    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(onApply.mock.calls[0][1]).toMatchObject({ adopt: {}, deleteItemIds: [], recreate: [], conflicts: { 'operationId:updateProduct': 'keep' } })
  })

  it('shows response contract changes as informational and not as an extra sync decision', async () => {
    const user = userEvent.setup()
    const preview = makePreview()
    preview.changes[1] = {
      ...preview.changes[1]!,
      changedFields: ['url', 'responses'],
      contractChanged: true,
    }
    render(<OpenApiSyncDialog
      collections={[collection]}
      onCancel={vi.fn()}
      onPreview={vi.fn().mockResolvedValue(preview)}
      onApply={vi.fn().mockResolvedValue({ result: applyResult })}
      onComplete={vi.fn()}
    />)

    await choosePreview(user)
    expect(screen.getByText(/Response contract changed\. After applying this sync/)).toBeInTheDocument()
    expect(screen.getByText('Changed: url')).toBeInTheDocument()
    expect(screen.queryByText('Changed: url, responses')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve 1 conflict(s)' })).toBeEnabled()
  })

  it('clears choices and re-previews when the preview is stale', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn().mockResolvedValueOnce(makePreview('a')).mockResolvedValueOnce(makePreview('b'))
    const onApply = vi.fn().mockRejectedValueOnce(apiError('OPENAPI_SYNC_PREVIEW_STALE', 409)).mockResolvedValueOnce({ result: applyResult })
    render(<OpenApiSyncDialog collections={[collection]} onCancel={vi.fn()} onPreview={onPreview} onApply={onApply} onComplete={vi.fn()} />)

    await choosePreview(user)
    await user.click(screen.getByRole('radio', { name: 'Use document version' }))
    await user.click(screen.getByRole('button', { name: 'Apply sync' }))

    expect(await screen.findByText(/sync source changed after this preview/)).toBeInTheDocument()
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('radio', { name: 'Use document version' })).not.toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Keep local request' }))
    await user.click(screen.getByRole('button', { name: 'Apply sync' }))
    await screen.findByRole('heading', { name: 'Sync applied' })
    expect(onApply.mock.calls[1][1].previewToken).toBe('b'.repeat(64))
  })

  it('shows the rate limit wait time', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn().mockRejectedValue(apiError('RATE_LIMITED', 429, { retryAfterSeconds: 42 }))
    render(<OpenApiSyncDialog collections={[collection]} onCancel={vi.fn()} onPreview={onPreview} onApply={vi.fn()} onComplete={vi.fn()} />)

    await user.upload(screen.getByLabelText('OpenAPI file'), new File([SPEC], 'shop.yaml'))
    await user.click(screen.getByRole('button', { name: 'Preview changes' }))
    expect(await screen.findByText(/try again in 42 seconds/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry preview' })).toBeInTheDocument()
  })

  it('rejects unsupported files before calling the API', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const onPreview = vi.fn()
    render(<OpenApiSyncDialog collections={[collection]} onCancel={vi.fn()} onPreview={onPreview} onApply={vi.fn()} onComplete={vi.fn()} />)

    await user.upload(screen.getByLabelText('OpenAPI file'), new File(['x'], 'spec.txt'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/\.json, \.yaml, or \.yml/)
    expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled()
  })
})

describe('OpenApiCreateDialog', () => {
  it('sends the raw spec and opens the collection when there are no warnings', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ collection: { ...collection, id: 'new' }, warnings: [] })
    const onOpen = vi.fn()
    render(<OpenApiCreateDialog onCancel={vi.fn()} onCreate={onCreate} onOpen={onOpen} />)

    await user.upload(screen.getByLabelText('OpenAPI file'), new File([SPEC], 'shop.yaml'))
    await user.type(screen.getByLabelText(/Collection name/), ' Shop ')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new'))
    expect(onCreate).toHaveBeenCalledWith({ spec: SPEC, name: 'Shop' })
  })

  it('shows warnings before opening the collection', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({
      collection: { ...collection, id: 'new' },
      warnings: [{ code: 'SENSITIVE_PARAMETER_VALUE', method: 'GET', path: '/me', parameter: 'api_key', location: 'query' }],
    })
    const onOpen = vi.fn()
    render(<OpenApiCreateDialog onCancel={vi.fn()} onCreate={onCreate} onOpen={onOpen} />)

    await user.upload(screen.getByLabelText('OpenAPI file'), new File([SPEC], 'shop.json'))
    await user.click(screen.getByRole('button', { name: 'Create collection' }))

    expect(await screen.findByText(/query parameter "api_key" looks sensitive/)).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Open collection' }))
    expect(onOpen).toHaveBeenCalledWith('new')
  })
})

describe('CollectionExportDialog', () => {
  it('exports OpenAPI with the chosen version and format', async () => {
    const user = userEvent.setup()
    const onExportOpenApi = vi.fn().mockResolvedValue(undefined)
    render(<CollectionExportDialog collectionName="Shop API" onCancel={vi.fn()} onExportPostman={vi.fn()} onExportOpenApi={onExportOpenApi} />)

    await user.selectOptions(screen.getByLabelText('OpenAPI version'), '3.0')
    await user.selectOptions(screen.getByLabelText('File format'), 'yaml')
    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(onExportOpenApi).toHaveBeenCalledWith({ version: '3.0', format: 'yaml' })
  })

  it('shows API errors such as duplicate operations', async () => {
    const user = userEvent.setup()
    const onExportOpenApi = vi.fn().mockRejectedValue(apiError('OPENAPI_DUPLICATE_OPERATION', 422))
    render(<CollectionExportDialog collectionName="Shop API" onCancel={vi.fn()} onExportPostman={vi.fn()} onExportOpenApi={onExportOpenApi} />)

    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByText(/OPENAPI_DUPLICATE_OPERATION/)).toBeInTheDocument()
  })

  it('keeps the Postman export available', async () => {
    const user = userEvent.setup()
    const onExportPostman = vi.fn()
    render(<CollectionExportDialog collectionName="Shop API" onCancel={vi.fn()} onExportPostman={onExportPostman} onExportOpenApi={vi.fn()} />)

    await user.click(screen.getByRole('radio', { name: /Postman v2.1 collection/ }))
    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(onExportPostman).toHaveBeenCalled()
  })
})
