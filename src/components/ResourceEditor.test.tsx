import { render, screen } from '@testing-library/react'
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
    body: null, auth: { type: 'none' },
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

function renderEditor(draft: ResourceDraft, proxy: ProxySettings | null = null) {
  return render(
    <ResourceEditor
      draft={draft}
      dirty={false}
      saving={false}
      error={null}
      onChange={vi.fn()}
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
