import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { describeApiError } from '@/lib/api'
import type { OpenApiExportOptions } from '@/lib/openapi'

interface CollectionExportDialogProps {
  collectionName: string
  onCancel: () => void
  onExportPostman: () => void
  /** Downloads the document. Throws on API errors. */
  onExportOpenApi: (options: OpenApiExportOptions) => Promise<void>
}

type ExportFormat = 'postman' | 'openapi'

export function CollectionExportDialog({ collectionName, onCancel, onExportPostman, onExportOpenApi }: CollectionExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('openapi')
  const [version, setVersion] = useState<OpenApiExportOptions['version']>('3.1')
  const [fileFormat, setFileFormat] = useState<OpenApiExportOptions['format']>('json')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (busy) return
    if (format === 'postman') {
      onExportPostman()
      return
    }
    setBusy(true)
    setError('')
    try {
      await onExportOpenApi({ version, format: fileFormat })
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog bulk-import-dialog openapi-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-export-title">
        <header className="modal-heading">
          <div>
            <h2 id="collection-export-title">Export "{collectionName}"</h2>
            <p>Download the collection as a file.</p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>

        <div className="bulk-import-content">
          <div className="openapi-export-formats" role="radiogroup" aria-label="Export format">
            <label className={format === 'openapi' ? 'selected' : ''}>
              <input type="radio" name="export-format" checked={format === 'openapi'} onChange={() => setFormat('openapi')} />
              <span><strong>OpenAPI document</strong><small>Requests become operations. Play Next settings are kept in x-play-next-* extensions for a later import or sync.</small></span>
            </label>
            <label className={format === 'postman' ? 'selected' : ''}>
              <input type="radio" name="export-format" checked={format === 'postman'} onChange={() => setFormat('postman')} />
              <span><strong>Postman v2.1 collection</strong><small>A best-effort .postman_collection.json file.</small></span>
            </label>
          </div>

          {format === 'openapi' && (
            <>
              <label className="field-label" htmlFor="openapi-export-version">OpenAPI version</label>
              <select id="openapi-export-version" className="text-field" value={version} disabled={busy} onChange={(event) => setVersion(event.target.value as OpenApiExportOptions['version'])}>
                <option value="3.1">3.1 (default)</option>
                <option value="3.0">3.0</option>
              </select>
              <label className="field-label" htmlFor="openapi-export-format">File format</label>
              <select id="openapi-export-format" className="text-field" value={fileFormat} disabled={busy} onChange={(event) => setFileFormat(event.target.value as OpenApiExportOptions['format'])}>
                <option value="json">JSON (default)</option>
                <option value="yaml">YAML</option>
              </select>
              <p className="bulk-import-dry-run">
                Credentials and sensitive values are replaced with placeholders. Requests using {'{{baseUrl}}'} get
                https://example.com as their server, and the placeholder is kept for re-import. Two requests with the
                same method and path cannot be exported together.
              </p>
            </>
          )}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </div>

        <footer className="modal-actions">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={busy} onClick={() => void run()}>{busy ? 'Exporting…' : 'Download'}</Button>
        </footer>
      </section>
    </div>
  )
}
