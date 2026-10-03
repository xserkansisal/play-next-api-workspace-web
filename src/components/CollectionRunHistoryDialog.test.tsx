import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CollectionRunHistoryDialog } from '@/components/CollectionRunHistoryDialog'
import { workspaceApi } from '@/lib/api'
import type { CollectionRunDetail } from '@/lib/api'

const run: CollectionRunDetail = {
  id: 'run-1',
  collectionId: 'collection-1',
  folderId: null,
  environmentId: null,
  status: 'failed',
  requestCount: 1,
  passedCount: 0,
  failedCount: 1,
  startedAt: '2026-10-03T07:00:00.000Z',
  finishedAt: '2026-10-03T07:00:01.000Z',
  durationMs: 1000,
  results: [{
    id: 'result-1',
    position: 0,
    itemId: 'request-1',
    itemName: 'Create user',
    status: 'failed',
    httpStatus: 500,
    durationMs: 35,
    responseSizeBytes: 14,
    responsePreview: '{"error":"bad"}',
    responseTruncated: false,
    assertions: [{ name: 'returns success', passed: false, errorCode: 'ASSERTION_FAILED' }],
    errorCode: null,
  }],
}

describe('collection run history dialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the just-completed run, response preview, and loads selected history details', async () => {
    vi.spyOn(workspaceApi, 'collectionRuns').mockResolvedValue({
      runs: [
        { ...run, results: undefined } as never,
        { ...run, id: 'run-2', status: 'passed', failedCount: 0, passedCount: 1, results: undefined } as never,
      ],
      total: 2,
      limit: 25,
      offset: 0,
    })
    const getRun = vi.spyOn(workspaceApi, 'collectionRun').mockResolvedValue({ ...run, id: 'run-2', status: 'passed', failedCount: 0, passedCount: 1 })

    render(
      <CollectionRunHistoryDialog
        collectionId="collection-1"
        collectionName="Users"
        initialRun={run}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText(/Create user/)).toBeInTheDocument()
    expect(screen.getByText('Response previews may contain sensitive data from your API.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /passed.*1\/1 passed/i }))
    await waitFor(() => expect(getRun).toHaveBeenCalledWith('collection-1', 'run-2'))
    expect(await screen.findByText(/1 passed · 0 failed · 1 requests/)).toBeInTheDocument()
  })
})
