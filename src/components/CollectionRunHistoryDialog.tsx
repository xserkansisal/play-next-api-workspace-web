import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { describeApiError, workspaceApi } from '@/lib/api'
import type { CollectionRunDetail, CollectionRunSummary } from '@/lib/api'

const PAGE_SIZE = 25

function assertionErrorMessage(errorCode?: string): string {
  switch (errorCode) {
    case 'CONTRACT_STATUS_UNEXPECTED':
      return 'Response status does not match the OpenAPI contract'
    case 'CONTRACT_CONTENT_TYPE_UNEXPECTED':
      return 'Response content type does not match the OpenAPI contract'
    case 'CONTRACT_INVALID_JSON':
      return 'Response is not valid JSON'
    case 'CONTRACT_RESPONSE_TRUNCATED':
      return 'Response was truncated and could not be validated'
    case 'CONTRACT_SCHEMA_MISMATCH':
      return 'Response body does not match the OpenAPI schema'
    case 'CONTRACT_SCHEMA_INVALID':
      return 'OpenAPI response schema is invalid'
    case 'ASSERTION_FAILED':
      return 'Assertion failed'
    default:
      return errorCode ?? 'Assertion failed'
  }
}

interface CollectionRunHistoryDialogProps {
  collectionId: string
  collectionName: string
  folderName?: string
  initialRun?: CollectionRunDetail
  onClose: () => void
}

export function CollectionRunHistoryDialog({
  collectionId,
  collectionName,
  folderName,
  initialRun,
  onClose,
}: CollectionRunHistoryDialogProps) {
  const [runs, setRuns] = useState<CollectionRunSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState(initialRun?.id ?? '')
  const [detail, setDetail] = useState<CollectionRunDetail | null>(initialRun ?? null)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void workspaceApi.collectionRuns(collectionId, PAGE_SIZE, offset)
      .then((page) => {
        if (cancelled) return
        setRuns(page.runs)
        setTotal(page.total)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeApiError(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [collectionId, offset, initialRun?.id])

  async function selectRun(run: CollectionRunSummary) {
    setSelectedId(run.id)
    setLoadingDetail(true)
    setError(null)
    try {
      setDetail(await workspaceApi.collectionRun(collectionId, run.id))
    } catch (cause) {
      setDetail(null)
      setError(describeApiError(cause))
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog collection-run-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-run-title">
        <header className="modal-heading">
          <div>
            <h2 id="collection-run-title">{collectionName} run history</h2>
            <p>
              Your server-side runs for this collection; folder runs are included.
              {folderName ? ` Opened from ${folderName}.` : ''}
            </p>
          </div>
          <button aria-label="Close run history" onClick={onClose}>×</button>
        </header>
        <p className="run-history-warning">Response previews may contain sensitive data from your API.</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="collection-run-content">
          <nav className="collection-run-list" aria-label="Collection runs">
            {loading && <p role="status">Loading run history…</p>}
            {!loading && runs.length === 0 && <p className="collection-run-empty">No saved runs yet.</p>}
            {runs.map((run) => (
              <button
                type="button"
                className={`collection-run-entry ${selectedId === run.id ? 'selected' : ''}`}
                key={run.id}
                onClick={() => void selectRun(run)}
              >
                <strong className={`run-status run-status-${run.status}`}>{run.status}</strong>
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <small>{run.passedCount}/{run.requestCount} passed · {Math.round(run.durationMs)} ms</small>
              </button>
            ))}
          </nav>
          <section className="collection-run-detail" aria-label="Run details">
            {loadingDetail && <p role="status">Loading run details…</p>}
            {!loadingDetail && !detail && <p className="collection-run-empty">Select a run to inspect its results.</p>}
            {!loadingDetail && detail && (
              <>
                <div className="run-detail-heading">
                  <div>
                    <strong className={`run-status run-status-${detail.status}`}>{detail.status}</strong>
                    <span>{detail.passedCount} passed · {detail.failedCount} failed · {detail.requestCount} requests</span>
                  </div>
                  <small>{Math.round(detail.durationMs)} ms · {new Date(detail.startedAt).toLocaleString()}</small>
                </div>
                <div className="run-results">
                  {detail.results.map((result) => (
                    <article className="run-result" key={result.id}>
                      <div className="run-result-heading">
                        <strong>{result.position + 1}. {result.itemName}</strong>
                        <span className={`run-status run-status-${result.status}`}>{result.status}</span>
                      </div>
                      <p>
                        {result.httpStatus === null ? 'No HTTP response' : `HTTP ${result.httpStatus}`}
                        {' · '}{Math.round(result.durationMs)} ms
                        {result.errorCode ? ` · ${result.errorCode}` : ''}
                      </p>
                      {result.assertions.map((assertion, index) => (
                        <div className="run-assertion" key={`${assertion.name}-${index}`}>
                          <p className={assertion.passed ? 'run-assertion-passed' : 'run-assertion-failed'}>
                            {assertion.passed ? '✓' : '✕'} {assertion.name}
                            {!assertion.passed && ` · ${assertionErrorMessage(assertion.errorCode)}`}
                          </p>
                          {!assertion.passed && (assertion.path || assertion.expected || assertion.actual) && (
                            <dl className="run-assertion-diagnostics">
                              {assertion.path && <div><dt>Path</dt><dd><code>{assertion.path}</code></dd></div>}
                              {assertion.expected && <div><dt>Expected</dt><dd>{assertion.expected}</dd></div>}
                              {assertion.actual && <div><dt>Actual</dt><dd>{assertion.actual}</dd></div>}
                            </dl>
                          )}
                        </div>
                      ))}
                      {result.responsePreview && (
                        <details className="run-response">
                          <summary>Response preview{result.responseTruncated ? ' (truncated)' : ''} · {result.responseSizeBytes ?? 0} bytes</summary>
                          <pre>{result.responsePreview}</pre>
                        </details>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
        <footer className="modal-actions collection-run-actions">
          <span>{total === 0 ? '0 runs' : `${offset + 1}–${Math.min(offset + runs.length, total)} of ${total}`}</span>
          <Button variant="outline" size="sm" onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} disabled={offset === 0 || loading}>Newer</Button>
          <Button variant="outline" size="sm" onClick={() => setOffset((value) => value + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total || loading}>Older</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </footer>
      </section>
    </div>
  )
}
