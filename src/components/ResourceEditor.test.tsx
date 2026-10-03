import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ResourceEditor } from '@/components/ResourceEditor'
import type { ProxySettings } from '@/lib/api'
import type { RecordedResponse } from '@/lib/request-runner'
import type { ResourceDraft } from '@/lib/workspace-types'

const response: RecordedResponse = {
  result: {
    kind: 'success',
    status: 200,
    statusText: 'OK',
    ok: true,
    durationMs: 12,
    sizeBytes: 11,
    headers: { 'content-type': 'application/json' },
    bodyText: '{"ok":true}',
  },
  sentAt: '2024-01-01T00:00:00.000Z',
}

const requestDraft = {
  kind: 'request',
  collectionId: 'c1',
  resource: {
    id: 'r1', collectionId: 'c1', parentId: null, type: 'request', name: 'Charge',
    description: '', method: 'GET', url: 'https://example.com', queryParams: [], headers: [],
    body: null, auth: { type: 'none' }, preRequestScript: '', postResponseScript: '',
  },
} as unknown as ResourceDraft

const folderDraft = {
  kind: 'folder',
  collectionId: 'c1',
  resource: { id: 'f1', collectionId: 'c1', parentId: null, type: 'folder', name: 'Charges', description: '', items: [] },
} as unknown as ResourceDraft

const collectionDraft = {
  kind: 'collection',
  resource: { id: 'c1', name: 'Payments', description: '', items: [] },
} as unknown as ResourceDraft

const environmentDraft = {
  kind: 'environment',
  resource: {
    id: 'e1', name: 'Local', variables: [
      { key: 'baseUrl', value: 'http://localhost', enabled: true },
      { key: 'token', value: 'abc', enabled: false },
    ],
  },
} as unknown as ResourceDraft

function renderEditor(draft: ResourceDraft, proxy: ProxySettings | null = null, onChange = vi.fn()) {
  return render(
    <ResourceEditor
      draft={draft}
      dirty={false}
      saving={false}
      error={null}
      onChange={onChange}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onSend={vi.fn()}
      sending={false}
      sendError={null}
      response={response}
      runnerId="browser"
      onRunnerChange={vi.fn()}
      proxy={proxy}
    />,
  )
}

describe('the response area belongs to a request', () => {
  it('keeps Send available to viewers while disabling content editing and hiding writes', () => {
    render(
      <ResourceEditor
        draft={requestDraft}
        dirty={false}
        saving={false}
        error={null}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        canEdit={false}
        onSend={vi.fn()}
        sending={false}
        sendError={null}
        response={null}
        runnerId="browser"
        onRunnerChange={vi.fn()}
        proxy={null}
      />,
    )

    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Request name' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move to Trash' })).not.toBeInTheDocument()
  })

  it('shows the response for a request', () => {
    const { container } = renderEditor(requestDraft)
    expect(container.querySelector('.response-panel')).toBeTruthy()
    // A delivered response is headed by its status rather than by the word "Response".
    expect(screen.getByText('200 OK')).toBeTruthy()
  })

  it('does not show a response under a folder, which cannot be sent', () => {
    // A leftover response from the last request made a folder look like it had just run one.
    const { container } = renderEditor(folderDraft)
    expect(container.querySelector('.response-panel')).toBeNull()
    expect(screen.queryByText('200 OK')).toBeNull()
  })

  it('does not show a response under a collection either', () => {
    const { container } = renderEditor(collectionDraft)
    expect(container.querySelector('.response-panel')).toBeNull()
  })

  it('labels migrated null authorship as Unknown user', () => {
    const collection = collectionDraft as Extract<ResourceDraft, { kind: 'collection' }>
    renderEditor({
      kind: 'collection',
      resource: { ...collection.resource, createdBy: null, updatedBy: null },
    })

    expect(screen.getByText('Created by Unknown user · Last updated by Unknown user')).toBeInTheDocument()
  })

  it('drops the splitter along with it, so the form is not pinned to half the height', () => {
    const { container } = renderEditor(folderDraft)
    expect(container.querySelector('.resize-handle')).toBeNull()
    const panel = container.querySelector('.request-panel') as HTMLElement
    expect(panel.style.flex).toBe('')
  })

  it('keeps the splitter for a request', () => {
    const { container } = renderEditor(requestDraft)
    expect(container.querySelector('.resize-handle')).toBeTruthy()
    const panel = container.querySelector('.request-panel') as HTMLElement
    expect(panel.style.flex).not.toBe('')
  })

  it('shows collection contents and supports opening and creating its direct children', async () => {
    const user = userEvent.setup()
    const onOpenResource = vi.fn()
    const onCreateRequest = vi.fn()
    const onCreateFolder = vi.fn()
    const collection = {
      ...collectionDraft,
      resource: {
        ...collectionDraft.resource,
        items: [
          { id: 'request-1', collectionId: 'c1', parentId: null, type: 'request', name: 'Create', description: '', method: 'POST', url: '/items', queryParams: [], headers: [], body: null, auth: { type: 'inherit' } },
          { id: 'folder-1', collectionId: 'c1', parentId: null, type: 'folder', name: 'Follow-up', description: '', items: [] },
        ],
      },
    } as unknown as ResourceDraft

    render(
      <ResourceEditor
        draft={collection}
        dirty={false}
        saving={false}
        error={null}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onSend={vi.fn()}
        sending={false}
        sendError={null}
        response={null}
        runnerId="browser"
        onRunnerChange={vi.fn()}
        proxy={null}
        onOpenResource={onOpenResource}
        onCreateRequest={onCreateRequest}
        onCreateFolder={onCreateFolder}
      />,
    )

    expect(screen.getByText('1 request · 1 folder')).toBeInTheDocument()
    expect(screen.getByText('POST · /items')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/Collection name/)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Open folder Follow-up' }))
    expect(onOpenResource).toHaveBeenCalledWith({ kind: 'folder', collectionId: 'c1', itemId: 'folder-1' })
    await user.click(screen.getByRole('button', { name: 'New request' }))
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    expect(onCreateRequest).toHaveBeenCalledOnce()
    expect(onCreateFolder).toHaveBeenCalledOnce()
  })

  it('shows a collection-specific empty state and hides creation actions from viewers', () => {
    render(
      <ResourceEditor
        draft={collectionDraft}
        dirty={false}
        saving={false}
        error={null}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        canEdit={false}
        onSend={vi.fn()}
        sending={false}
        sendError={null}
        response={null}
        runnerId="browser"
        onRunnerChange={vi.fn()}
        proxy={null}
      />,
    )

    expect(screen.getByText('This collection is empty')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Collection name' })).toBeDisabled()
  })
})

describe('what the runner tooltip says is reachable', () => {
  it('names the configured hosts', () => {
    const { container } = renderEditor(requestDraft, { enabled: true, anyHost: false, allowedHosts: ['localhost:7799'] })
    const select = container.querySelector('.runner-select') as HTMLSelectElement
    expect(select.title).toContain('Allowed hosts: localhost:7799.')
  })

  it('says every host is allowed rather than printing a bare asterisk', () => {
    // "Allowed hosts: *." reads like a host named "*"; the reader should not have to decode it.
    const { container } = renderEditor(requestDraft, { enabled: true, anyHost: true, allowedHosts: ['*'] })
    const select = container.querySelector('.runner-select') as HTMLSelectElement
    expect(select.title).toContain('Any host is allowed.')
    expect(select.title).not.toContain('Allowed hosts')
  })

  it('points at the setting when the proxy is off', () => {
    const { container } = renderEditor(requestDraft, { enabled: false, anyHost: false, allowedHosts: [] })
    const select = container.querySelector('.runner-select') as HTMLSelectElement
    expect(select.title).toContain('PROXY_ALLOWED_HOSTS')
  })
})

describe('one-time proxy methods', () => {
  it('allows a viewer to send HEAD without changing the saved method', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onSend = vi.fn()
    render(
      <ResourceEditor
        draft={requestDraft}
        dirty={false}
        saving={false}
        error={null}
        onChange={onChange}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        canEdit={false}
        onSend={onSend}
        sending={false}
        sendError={null}
        response={null}
        runnerId="browser"
        onRunnerChange={vi.fn()}
        proxy={null}
      />,
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'HTTP method' }), 'HEAD')
    expect(screen.getByText('HEAD will be used for this send only. The saved method remains GET.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('HEAD')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('request body type selection', () => {
  async function openBodyTab() {
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('tab', { name: 'Body' })[0])
    return user
  }

  it('keeps an empty selected body instead of clearing it and manages Content-Type', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderEditor(requestDraft, null, onChange)
    await user.click(screen.getAllByRole('tab', { name: 'Body' })[0])
    await user.selectOptions(screen.getByLabelText('Body type'), 'json')

    const changed = onChange.mock.calls[0][0] as Extract<ResourceDraft, { kind: 'request' }>
    expect(changed.resource.body).toEqual({ type: 'json', content: '' })
    expect(changed.resource.headers).toEqual([
      { key: 'Content-Type', value: 'application/json', description: '', enabled: true },
    ])
  })

  describe('request scripts', () => {
    it('edits both script hooks and displays the API limit', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderEditor({
        ...requestDraft,
        resource: {
          ...requestDraft.resource,
          preRequestScript: 'pm.environment.set("token", "abc")',
          postResponseScript: 'pm.test("success", () => {})',
        },
      } as ResourceDraft, null, onChange)
      await user.click(screen.getByRole('tab', { name: 'Scripts' }))

      expect(screen.getByLabelText('Pre-request script')).toHaveValue('pm.environment.set("token", "abc")')
      expect(screen.getByLabelText('Post-response script')).toHaveValue('pm.test("success", () => {})')
      expect(screen.getAllByText(/32,768 characters/)).toHaveLength(2)

      fireEvent.change(screen.getByLabelText('Pre-request script'), { target: { value: 'pm.environment.set("token", "new")' } })
      const changed = onChange.mock.calls.at(-1)?.[0] as Extract<ResourceDraft, { kind: 'request' }>
      expect(changed.resource.preRequestScript).toBe('pm.environment.set("token", "new")')
      expect(changed.resource.postResponseScript).toBe('pm.test("success", () => {})')
    })

    describe('folder overview', () => {
      it('summarizes nested contents and opens a child resource from the folder view', async () => {
        const user = userEvent.setup()
        const onOpenResource = vi.fn()
        const onCreateRequest = vi.fn()
        const onCreateFolder = vi.fn()
        const folder = {
          ...folderDraft,
          resource: {
            ...folderDraft.resource,
            items: [
              { id: 'request-1', collectionId: 'c1', parentId: 'f1', type: 'request', name: 'Create', description: '', method: 'POST', url: '/items', queryParams: [], headers: [], body: null, auth: { type: 'inherit' } },
              { id: 'folder-2', collectionId: 'c1', parentId: 'f1', type: 'folder', name: 'Follow-up', description: '', items: [
                { id: 'request-2', collectionId: 'c1', parentId: 'folder-2', type: 'request', name: 'Read', description: '', method: 'GET', url: '/items/1', queryParams: [], headers: [], body: null, auth: { type: 'inherit' } },
                { id: 'folder-3', collectionId: 'c1', parentId: 'folder-2', type: 'folder', name: 'Nested', description: '', items: [
                  { id: 'request-3', collectionId: 'c1', parentId: 'folder-3', type: 'request', name: 'Delete', description: '', method: 'DELETE', url: '/items/1', queryParams: [], headers: [], body: null, auth: { type: 'inherit' } },
                ] },
              ] },
            ],
          },
        } as unknown as ResourceDraft

        render(
          <ResourceEditor
            draft={folder}
            dirty={false}
            saving={false}
            error={null}
            onChange={vi.fn()}
            onSave={vi.fn()}
            onDelete={vi.fn()}
            onSend={vi.fn()}
            sending={false}
            sendError={null}
            response={null}
            runnerId="browser"
            onRunnerChange={vi.fn()}
            proxy={null}
            onOpenResource={onOpenResource}
            onCreateRequest={onCreateRequest}
            onCreateFolder={onCreateFolder}
          />,
        )

        expect(screen.getByText('3 requests · 2 folders')).toBeInTheDocument()
        expect(screen.getByText('POST · /items')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Open folder Follow-up' }))
        expect(onOpenResource).toHaveBeenCalledWith({ kind: 'folder', collectionId: 'c1', itemId: 'folder-2' })
        await user.click(screen.getByRole('button', { name: 'New request' }))
        await user.click(screen.getByRole('button', { name: 'New folder' }))
        expect(onCreateRequest).toHaveBeenCalledOnce()
        expect(onCreateFolder).toHaveBeenCalledOnce()
      })

      it('shows a useful empty state and only exposes creation actions to editors', () => {
        render(
          <ResourceEditor
            draft={folderDraft}
            dirty={false}
            saving={false}
            error={null}
            onChange={vi.fn()}
            onSave={vi.fn()}
            onDelete={vi.fn()}
            canEdit={false}
            onSend={vi.fn()}
            sending={false}
            sendError={null}
            response={null}
            runnerId="browser"
            onRunnerChange={vi.fn()}
            proxy={null}
            onOpenResource={vi.fn()}
          />,
        )

        expect(screen.getByText('This folder is empty')).toBeInTheDocument()
        expect(screen.getByText(/Add requests here to keep related steps together/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument()
      })
    })
  })

  it('sets the raw default media type and keeps the raw editor available', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderEditor(requestDraft, null, onChange)
    await user.click(screen.getAllByRole('tab', { name: 'Body' })[0])
    await user.selectOptions(screen.getByLabelText('Body type'), 'raw')

    const changed = onChange.mock.calls[0][0] as Extract<ResourceDraft, { kind: 'request' }>
    expect(changed.resource.body).toEqual({ type: 'raw', content: '' })
    expect(changed.resource.headers[0]).toMatchObject({ key: 'Content-Type', value: 'text/plain', enabled: true })
  })

  it('edits URL-encoded duplicate fields in their original order', async () => {
    const draft = {
      ...requestDraft,
      resource: { ...requestDraft.resource, body: { type: 'form-urlencoded', content: 'tag=one&tag=two' } },
    } as unknown as ResourceDraft
    const onChange = vi.fn()
    renderEditor(draft, null, onChange)
    await userEvent.setup().click(screen.getAllByRole('tab', { name: 'Body' })[0])

    expect(screen.getByLabelText('URL-encoded key 1')).toHaveValue('tag')
    expect(screen.getByLabelText('URL-encoded key 2')).toHaveValue('tag')
    fireEvent.change(screen.getByLabelText('URL-encoded value 1'), { target: { value: 'changed' } })

    const changed = onChange.mock.calls.at(-1)?.[0] as Extract<ResourceDraft, { kind: 'request' }>
    expect(changed.resource.body?.content).toBe('tag=changed&tag=two')
  })

  it('shows invalid saved multipart content without replacing it', async () => {
    const draft = {
      ...requestDraft,
      resource: { ...requestDraft.resource, body: { type: 'multipart', content: '{broken' } },
    } as unknown as ResourceDraft
    const onChange = vi.fn()
    renderEditor(draft, null, onChange)
    const user = await openBodyTab()

    expect(screen.getByRole('alert')).toHaveTextContent('Multipart fields must be valid JSON.')
    expect(screen.getByLabelText('Multipart fields JSON')).toHaveValue('{broken')
    expect(onChange).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Multipart fields JSON'), 'x')
    expect(onChange).toHaveBeenCalled()
  })
})

describe('duplicating an environment variable', () => {
  it('puts the copy directly below the original with a key that is free', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderEditor(environmentDraft, null, onChange)

    await user.click(screen.getByLabelText('Duplicate variable 1'))

    expect(onChange).toHaveBeenCalledTimes(1)
    // A key that repeated the original would be rejected on save, and the save rewrites the
    // whole list, so the rest of the user's edits would go with it.
    expect(onChange.mock.calls[0][0].resource.variables).toEqual([
      { key: 'baseUrl', value: 'http://localhost', enabled: true },
      { key: 'baseUrl_copy', value: 'http://localhost', enabled: true },
      { key: 'token', value: 'abc', enabled: false },
    ])
  })

  it('carries the value and the enabled state of the row it copied', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderEditor(environmentDraft, null, onChange)

    await user.click(screen.getByLabelText('Duplicate variable 2'))

    expect(onChange.mock.calls[0][0].resource.variables[2]).toEqual({ key: 'token_copy', value: 'abc', enabled: false })
  })
})

describe('reordering environment variables', () => {
  const keys = (onChange: ReturnType<typeof vi.fn>) =>
    (onChange.mock.calls.at(-1)?.[0].resource.variables as { key: string }[]).map(({ key }) => key)

  it('moves a variable with the row menu', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderEditor(environmentDraft, null, onChange)

    await user.click(screen.getByLabelText('Move token'))
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move to bottom' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Move to top' }))

    expect(keys(onChange)).toEqual(['token', 'baseUrl'])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves a variable with the keyboard on its handle', () => {
    const onChange = vi.fn()
    renderEditor(environmentDraft, null, onChange)

    fireEvent.keyDown(screen.getByLabelText('Reorder baseUrl'), { key: 'ArrowDown' })

    expect(keys(onChange)).toEqual(['token', 'baseUrl'])
  })

  it('moves a variable by dragging it onto another row', () => {
    const onChange = vi.fn()
    renderEditor(environmentDraft, null, onChange)
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' }
    // jsdom drops clientY from drag events, so the hover lands on the lower half: "after" the row.
    const target = screen.getByLabelText('Reorder token').parentElement!

    fireEvent.dragStart(screen.getByLabelText('Reorder baseUrl'), { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    expect(keys(onChange)).toEqual(['token', 'baseUrl'])
  })
})
