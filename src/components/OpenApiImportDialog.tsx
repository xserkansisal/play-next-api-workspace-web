import { useState } from 'react'

import { folderOptions } from '@/components/BulkImportDialog'
import { OpenApiFilePicker, OpenApiWarningList } from '@/components/OpenApiShared'
import { Button } from '@/components/ui/button'
import { apiErrorCode, describeOpenApiError, type ImportConflictPolicy } from '@/lib/api'
import type { OpenApiImportInput, OpenApiImportResult, OpenApiSpecFile } from '@/lib/openapi'
import type { CollectionResource } from '@/lib/workspace-types'

interface OpenApiImportDialogProps {
  collections: CollectionResource[]
  initialCollectionId?: string
  initialParentId?: string
  onCancel: () => void
  onPreview: (collectionId: string, input: OpenApiImportInput) => Promise<OpenApiImportResult>
  onImport: (collectionId: string, input: OpenApiImportInput) => Promise<{ result: OpenApiImportResult; refreshError?: string }>
  onComplete: (collectionId: string, parentId: string | null) => void
}

type Stage = 'select' | 'review' | 'success'

export function OpenApiImportDialog({ collections, initialCollectionId, initialParentId, onCancel, onPreview, onImport, onComplete }: OpenApiImportDialogProps) {
  const [collectionId, setCollectionId] = useState(
    collections.find((entry) => entry.id === initialCollectionId)?.id ?? collections[0]?.id ?? '',
  )
  const [parentId, setParentId] = useState(initialParentId ?? '')
  const [file, setFile] = useState<OpenApiSpecFile | null>(null)
  const [onConflict, setOnConflict] = useState<ImportConflictPolicy>('rename')
  const [stage, setStage] = useState<Stage>('select')
  const [preview, setPreview] = useState<OpenApiImportResult | null>(null)
  const [result, setResult] = useState<OpenApiImportResult | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<string>()
  const [busy, setBusy] = useState(false)

  const collection = collections.find((entry) => entry.id === collectionId)
  const folders = collection ? folderOptions(collection.items) : []
  const selectedFolder = folders.find((folder) => folder.id === parentId)
  const destination = selectedFolder ? `${collection?.name} / ${selectedFolder.label}` : `${collection?.name ?? ''} (root)`
  const folderConflict = errorCode === 'FOLDER_NAME_CONFLICT'

  function input(dryRun: boolean, policy = onConflict): OpenApiImportInput {
    return { spec: file!.text, parentId: parentId || null, onConflict: policy, dryRun }
  }

  async function runPreview(policy = onConflict) {
    if (!collection || !file || busy) return
    setBusy(true)
    setError('')
    setErrorCode(undefined)
    setPreview(null)
    setStage('review')
    try {
      setPreview(await onPreview(collection.id, input(true, policy)))
      setOnConflict(policy)
    } catch (cause) {
      setError(describeOpenApiError(cause))
      setErrorCode(apiErrorCode(cause))
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    if (!collection || !file || busy) return
    setBusy(true)
    setError('')
    setErrorCode(undefined)
    try {
      const response = await onImport(collection.id, input(false))
      setResult(response.result)
      setRefreshError(response.refreshError ?? '')
      setStage('success')
    } catch (cause) {
      setError(describeOpenApiError(cause))
      setErrorCode(apiErrorCode(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog bulk-import-dialog openapi-dialog" role="dialog" aria-modal="true" aria-labelledby="openapi-import-title">
        <header className="modal-heading">
          <div>
            <h2 id="openapi-import-title">
              {stage === 'select' ? 'Import OpenAPI into a collection' : stage === 'review' ? 'Review OpenAPI import' : 'Import complete'}
            </h2>
            <p>
              A one-time import adds requests for the document's operations. It is not linked to the document; later
              changes to the file are not tracked. Use OpenAPI sync to keep a collection up to date.
            </p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>

        {stage !== 'success' && (
          <div className="bulk-import-steps" aria-label="Import steps">
            <span className={stage === 'select' ? 'active' : 'done'}>1&nbsp; Destination and file</span>
            <span className={stage === 'review' ? 'active' : ''}>2&nbsp; Review</span>
          </div>
        )}

        <div className="bulk-import-content">
          {stage === 'select' && (
            <>
              <label className="field-label" htmlFor="openapi-import-collection">Destination collection</label>
              <select
                id="openapi-import-collection"
                className="text-field"
                value={collectionId}
                disabled={busy || collections.length === 0}
                onChange={(event) => { setCollectionId(event.target.value); setParentId('') }}
              >
                {collections.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
              </select>

              <label className="field-label" htmlFor="openapi-import-folder">Import location</label>
              <select id="openapi-import-folder" className="text-field" value={parentId} disabled={!collection || busy} onChange={(event) => setParentId(event.target.value)}>
                <option value="">Collection root</option>
                {folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.label}</option>)}
              </select>

              <OpenApiFilePicker file={file} disabled={busy} onFile={(next) => { setFile(next); setError('') }} onError={(message) => { setFile(null); setError(message) }} />

              <label className="field-label" htmlFor="openapi-import-policy">Folder name conflicts</label>
              <select id="openapi-import-policy" className="text-field" value={onConflict} onChange={(event) => setOnConflict(event.target.value as ImportConflictPolicy)}>
                <option value="rename">Rename imported folders (default)</option>
                <option value="fail">Fail without importing</option>
              </select>

              {!collection && <p className="inline-error" role="alert">Create a collection before importing items.</p>}
              {error && <p className="inline-error" role="alert">{error}</p>}
            </>
          )}

          {stage === 'review' && (
            <>
              {file && <p className="bulk-import-file-name">{file.fileName} · {destination}</p>}
              {busy && <p role="status">Checking the import with the API…</p>}
              {error && (
                <div className={folderConflict ? 'bulk-import-api-error conflict' : 'bulk-import-api-error'} role="alert">
                  <strong>{folderConflict ? 'Folder name conflict' : 'Import preview failed'}</strong>
                  <p>{error}</p>
                  {folderConflict && <Button variant="outline" disabled={busy} onClick={() => void runPreview('rename')}>Preview with Rename</Button>}
                </div>
              )}
              {preview && (
                <>
                  <div className="bulk-import-stats">
                    <div><strong>{preview.created.folders}</strong><span>folders to create</span></div>
                    <div><strong>{preview.created.requests}</strong><span>requests to create</span></div>
                    <div><strong>{preview.renamed.length}</strong><span>folders to rename</span></div>
                  </div>
                  {preview.renamed.length > 0 && (
                    <div className="bulk-import-result-list">
                      <h3>Folders that will be renamed</h3>
                      {preview.renamed.map((entry, index) => (
                        <div className="bulk-import-result-row" key={`${entry.path.join('/')}-${index}`}>
                          <span>{entry.path.join(' / ')}</span><strong>{entry.from} → {entry.to}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <OpenApiWarningList warnings={preview.warnings} />
                  <p className="bulk-import-dry-run">This is a dry-run preview. Nothing has been saved yet.</p>
                </>
              )}
            </>
          )}

          {stage === 'success' && result && (
            <>
              <div className="bulk-import-success-mark">✓</div>
              <div className="bulk-import-success-heading">
                <h3>Requests imported</h3>
                <p>{result.created.requests} request(s) in {result.created.folders} new folder(s) were added to {destination}.</p>
              </div>
              {result.renamed.length > 0 && (
                <div className="bulk-import-result-list">
                  <h3>Renamed folders</h3>
                  {result.renamed.map((entry, index) => (
                    <div className="bulk-import-result-row" key={`${entry.path.join('/')}-${index}`}>
                      <span>{entry.path.join(' / ')}</span><strong>{entry.from} → {entry.to}</strong>
                    </div>
                  ))}
                </div>
              )}
              {result.warnings.length > 0 && <OpenApiWarningList warnings={result.warnings} title="Review before sending" />}
              {refreshError
                ? <p className="bulk-import-refresh-error" role="alert">{refreshError}</p>
                : <p className="bulk-import-dry-run">The collection has been refreshed with the imported items.</p>}
            </>
          )}
        </div>

        <footer className="modal-actions">
          {stage === 'select' && (
            <>
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
              <Button disabled={!collection || !file || busy} onClick={() => void runPreview()}>Preview import</Button>
            </>
          )}
          {stage === 'review' && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => { setStage('select'); setError(''); setErrorCode(undefined) }}>Back</Button>
              {preview && (
                <Button disabled={busy} onClick={() => void confirmImport()}>
                  {busy ? 'Importing…' : `Import ${preview.created.folders + preview.created.requests} items`}
                </Button>
              )}
            </>
          )}
          {stage === 'success' && <Button onClick={() => onComplete(collectionId, parentId || null)}>View collection</Button>}
        </footer>
      </section>
    </div>
  )
}
