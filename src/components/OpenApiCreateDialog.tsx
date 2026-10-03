import { useState } from 'react'

import { OpenApiFilePicker, OpenApiWarningList } from '@/components/OpenApiShared'
import { Button } from '@/components/ui/button'
import { describeOpenApiError } from '@/lib/api'
import type { OpenApiCreateInput, OpenApiCreateResult, OpenApiSpecFile } from '@/lib/openapi'

interface OpenApiCreateDialogProps {
  onCancel: () => void
  /** Creates the collection and adds it to the workspace. Throws on API errors. */
  onCreate: (input: OpenApiCreateInput) => Promise<OpenApiCreateResult>
  onOpen: (collectionId: string) => void
}

export function OpenApiCreateDialog({ onCancel, onCreate, onOpen }: OpenApiCreateDialogProps) {
  const [file, setFile] = useState<OpenApiSpecFile | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<OpenApiCreateResult | null>(null)

  async function create() {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await onCreate({
        spec: file.text,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      })
      if (created.warnings.length === 0) onOpen(created.collection.id)
      else setResult(created)
    } catch (cause) {
      setError(describeOpenApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog bulk-import-dialog openapi-dialog" role="dialog" aria-modal="true" aria-labelledby="openapi-create-title">
        <header className="modal-heading">
          <div>
            <h2 id="openapi-create-title">{result ? 'Collection created' : 'New collection from OpenAPI'}</h2>
            <p>
              {result
                ? `"${result.collection.name}" was created. Review the conversion warnings below.`
                : 'Creates a new collection with a request for every supported operation. This happens immediately; there is no preview step.'}
            </p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>

        <div className="bulk-import-content">
          {result ? (
            <>
              <div className="bulk-import-success-mark">✓</div>
              <OpenApiWarningList warnings={result.warnings} />
              <p className="bulk-import-dry-run">
                This collection is a one-time copy of the document. To keep it updated, use OpenAPI sync from the Import menu.
              </p>
            </>
          ) : (
            <>
              <OpenApiFilePicker file={file} disabled={busy} onFile={(next) => { setFile(next); setError('') }} onError={(message) => { setFile(null); setError(message) }} />
              <label className="field-label">Collection name (optional)
                <input className="text-field" value={name} disabled={busy} placeholder="Uses the document's info.title" onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="field-label">Description (optional)
                <input className="text-field" value={description} disabled={busy} placeholder="Uses the document's info.description" onChange={(event) => setDescription(event.target.value)} />
              </label>
              {error && <p className="inline-error" role="alert">{error}</p>}
            </>
          )}
        </div>

        <footer className="modal-actions">
          {result ? (
            <Button onClick={() => onOpen(result.collection.id)}>Open collection</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
              <Button disabled={!file || busy} onClick={() => void create()}>{busy ? 'Creating…' : 'Create collection'}</Button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
