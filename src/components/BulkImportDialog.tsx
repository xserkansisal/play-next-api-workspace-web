import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { apiErrorCode, type BulkImportInput, type BulkImportResult, type ImportConflictPolicy } from '@/lib/api'
import {
  parseBulkImportFile,
  validateBulkImportDestinationDepth,
  validateBulkImportFileSize,
  type ParsedBulkImport,
} from '@/lib/bulk-import'
import type { CollectionResource, TreeNodeInput, WorkspaceItem } from '@/lib/workspace-types'

type BulkImportOptions = Omit<BulkImportInput, 'dryRun'>

interface BulkImportDialogProps {
  collections: CollectionResource[]
  initialCollectionId?: string
  initialParentId?: string
  onCancel: () => void
  onComplete: (collectionId: string, parentId: string | null) => void
  onPreview: (collectionId: string, input: BulkImportInput) => Promise<BulkImportResult>
  onImport: (collectionId: string, input: BulkImportInput) => Promise<{ result: BulkImportResult; refreshError?: string }>
}

interface FolderOption {
  id: string
  label: string
  depth: number
}

interface PreviewRow {
  name: string
  type: 'folder' | 'request'
  depth: number
  method?: string
}

function folderOptions(items: WorkspaceItem[], prefix = '', depth = 0): FolderOption[] {
  return items.flatMap((item) => {
    if (item.type !== 'folder') return []
    const path = prefix ? `${prefix} / ${item.name}` : item.name
    return [
      { id: item.id, label: path, depth: depth + 1 },
      ...folderOptions(item.items, path, depth + 1),
    ]
  })
}

function previewRows(items: TreeNodeInput[], renamed: BulkImportResult['renamed'], depth = 0): PreviewRow[] {
  return items.flatMap((item) => {
    const name = item.type === 'folder'
      ? renamed.find((entry) => entry.path.length === 1 && entry.path[0] === item.name)?.to ?? item.name
      : item.name
    const row: PreviewRow = {
      name,
      type: item.type,
      depth,
      ...(item.type === 'request' ? { method: item.method } : {}),
    }
    return item.type === 'folder' ? [row, ...previewRows(item.items, renamed, depth + 1)] : [row]
  })
}

function countItemTypes(items: TreeNodeInput[]) {
  return items.reduce((counts, item) => {
    if (item.type === 'folder') {
      counts.folders += 1
      const nested = countItemTypes(item.items)
      counts.folders += nested.folders
      counts.requests += nested.requests
    } else {
      counts.requests += 1
    }
    return counts
  }, { folders: 0, requests: 0 })
}

function describePath(path: string[]): string {
  return path.join(' / ')
}

function conflictNameError(message: string, code: string | undefined): boolean {
  return code === 'FOLDER_NAME_CONFLICT' || message.includes('FOLDER_NAME_CONFLICT')
}

export function BulkImportDialog({ collections, initialCollectionId, initialParentId, onCancel, onComplete, onPreview, onImport }: BulkImportDialogProps) {
  const [collectionId, setCollectionId] = useState(
    collections.find((entry) => entry.id === initialCollectionId)?.id ?? collections[0]?.id ?? '',
  )
  const [parentId, setParentId] = useState(initialParentId ?? '')
  const [parsed, setParsed] = useState<ParsedBulkImport | null>(null)
  const [fileName, setFileName] = useState('')
  const [onConflict, setOnConflict] = useState<ImportConflictPolicy>('rename')
  const [preview, setPreview] = useState<BulkImportResult | null>(null)
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<string>()
  const [stage, setStage] = useState<'select' | 'review' | 'success'>('select')
  const [busy, setBusy] = useState(false)

  const collection = collections.find((entry) => entry.id === collectionId)
  const folders = collection ? folderOptions(collection.items) : []
  const selectedFolder = folders.find((folder) => folder.id === parentId)
  const counts = parsed ? countItemTypes(parsed.items) : { folders: 0, requests: 0 }
  const canPreview = !!collection && !!parsed && !busy

  async function handleFile(file: File) {
    setParsed(null)
    setPreview(null)
    setResult(null)
    setError('')
    setErrorCode(undefined)
    setRefreshError('')
    setStage('select')
    setFileName(file.name)
    try {
      validateBulkImportFileSize(file.size)
      const next = parseBulkImportFile(await file.text())
      setParsed(next)
      setOnConflict(next.onConflict)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read this bulk import file.')
    }
  }

  function requestInput(policy: ImportConflictPolicy): BulkImportOptions {
    if (!parsed) throw new Error('Choose a valid bulk import file first.')
    if (selectedFolder) validateBulkImportDestinationDepth(selectedFolder.depth, parsed.maxDepth)
    return { parentId: parentId || null, onConflict: policy, items: parsed.items }
  }

  async function runPreview(policy = onConflict) {
    if (!collection || !parsed) return
    setBusy(true)
    setError('')
    setErrorCode(undefined)
    setPreview(null)
    setStage('review')
    try {
      const input = requestInput(policy)
      const response = await onPreview(collection.id, { ...input, dryRun: true })
      setPreview(response)
      setOnConflict(policy)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to preview this import.')
      setErrorCode(apiErrorCode(cause))
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    if (!collection || !parsed) return
    setBusy(true)
    setError('')
    setErrorCode(undefined)
    try {
      const input = requestInput(onConflict)
      const response = await onImport(collection.id, { ...input, dryRun: false })
      setResult(response.result)
      setRefreshError(response.refreshError ?? '')
      setStage('success')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to import these items.')
      setErrorCode(apiErrorCode(cause))
    } finally {
      setBusy(false)
    }
  }

  const conflict = conflictNameError(error, errorCode)
  const onDone = () => onComplete(collectionId, parentId || null)

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog bulk-import-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-import-title">
        <header className="modal-heading">
          <div>
            <h2 id="bulk-import-title">
              {stage === 'select' ? 'Import into a collection' : stage === 'review' ? 'Review bulk import' : 'Import complete'}
            </h2>
            <p>
              {stage === 'select'
                ? 'Add folders and requests from a Play Next bulk import JSON file to an existing collection.'
                : stage === 'review'
                  ? `Check the preview before adding items to ${collection?.name ?? 'the collection'}.`
                  : `Items have been added to ${collection?.name ?? 'the collection'}.`}
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
              <label className="field-label" htmlFor="bulk-import-collection">Destination collection</label>
              <select
                id="bulk-import-collection"
                className="text-field"
                value={collectionId}
                disabled={busy || collections.length === 0}
                onChange={(event) => {
                  setCollectionId(event.target.value)
                  setParentId('')
                }}
              >
                {collections.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
              </select>

              <label className="field-label" htmlFor="bulk-import-folder">Import location</label>
              <select id="bulk-import-folder" className="text-field" value={parentId} disabled={!collection || busy} onChange={(event) => setParentId(event.target.value)}>
                <option value="">Collection root</option>
                {folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.label}</option>)}
              </select>

              <label className="bulk-import-dropzone">
                <span className="bulk-import-upload-icon">↑</span>
                <strong>{fileName || 'Choose a bulk import JSON file'}</strong>
                <span>Click to browse · JSON, up to 10 MB</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  aria-label="Bulk import JSON file"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handleFile(file)
                    event.currentTarget.value = ''
                  }}
                />
              </label>

              {parsed && (
                <div className="bulk-import-file-summary" role="status">
                  <span className="bulk-import-valid">✓ Valid bulk import file</span>
                  <span>{counts.folders} folder(s) · {counts.requests} request(s)</span>
                  <label className="field-label" htmlFor="bulk-import-policy">Folder name conflicts</label>
                  <select id="bulk-import-policy" className="text-field" value={onConflict} onChange={(event) => setOnConflict(event.target.value as ImportConflictPolicy)}>
                    <option value="rename">Rename imported folders (default)</option>
                    <option value="fail">Fail without importing</option>
                  </select>
                  <small>Imported folder names may be renamed when a sibling already exists. Request names are never renamed.</small>
                </div>
              )}

              {!collection && <p className="inline-error" role="alert">Create a collection before importing items.</p>}
              {error && <p className="inline-error" role="alert">{error}</p>}
            </>
          )}

          {stage === 'review' && (
            <>
              {fileName && <p className="bulk-import-file-name">{fileName} · {collection?.name}{selectedFolder ? ` / ${selectedFolder.label}` : ''}</p>}
              {busy && <p role="status">Checking the import with the API…</p>}

              {error && (
                <div className={conflict ? 'bulk-import-api-error conflict' : 'bulk-import-api-error'} role="alert">
                  <strong>{conflict ? 'Folder name conflict' : 'Import preview failed'}</strong>
                  <p>{error}</p>
                  {conflict && <p>No items were written. Choose Rename on conflict to preview the automatic folder names.</p>}
                  {conflict && <Button variant="outline" disabled={busy} onClick={() => void runPreview('rename')}>Preview with Rename</Button>}
                </div>
              )}

              {preview && (
                <>
                  <div className="bulk-import-tree-preview">
                    <h3>Items to import</h3>
                    <div>
                      {previewRows(parsed?.items ?? [], preview.renamed).slice(0, 12).map((row, index) => (
                        <div className="bulk-import-tree-row" key={`${row.depth}-${row.name}-${index}`}>
                          <span className="bulk-import-tree-indent" style={{ width: `${row.depth * 16}px` }} />
                          {row.type === 'folder'
                            ? <span className="bulk-import-tree-icon">▾</span>
                            : <span className={`bulk-import-method ${row.method?.toLowerCase()}`}>{row.method}</span>}
                          <span>{row.name}</span>
                        </div>
                      ))}
                      {(parsed?.folders ?? 0) + (parsed?.requests ?? 0) > 12 && (
                        <p>and {(parsed?.folders ?? 0) + (parsed?.requests ?? 0) - 12} more item(s)</p>
                      )}
                    </div>
                  </div>
                  <div className="bulk-import-stats">
                    <div><strong>{preview.created.folders}</strong><span>folders to create</span></div>
                    <div><strong>{preview.created.requests}</strong><span>requests to create</span></div>
                    <div><strong>{preview.renamed.length}</strong><span>folders to rename</span></div>
                  </div>
                  <p className="bulk-import-policy-summary">
                    Conflict policy: <strong>{onConflict === 'rename' ? 'Rename on conflict' : 'Fail on conflict'}</strong>
                    {parentId ? ` · Destination: ${selectedFolder?.label}` : ' · Destination: collection root'}
                  </p>

                  {preview.renamed.length > 0 && (
                    <div className="bulk-import-result-list">
                      <h3>Folders that will be renamed</h3>
                      {preview.renamed.map((entry, index) => (
                        <div className="bulk-import-result-row" key={`${describePath(entry.path)}-${index}`}>
                          <span>{describePath(entry.path)}</span><strong>{entry.from} → {entry.to}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  {preview.warnings.length > 0 ? (
                    <div className="bulk-import-warnings">
                      <h3>Review these warnings</h3>
                      {preview.warnings.map((warning, index) => (
                        <p key={`${warning.code}-${index}`}>
                          <strong>{warning.code}</strong> · {describePath(warning.path)}
                          {warning.header ? ` · ${warning.header} may contain a sensitive value` : ''}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="bulk-import-no-warnings">No sensitive-header warnings.</p>
                  )}
                  <p className="bulk-import-dry-run">This is a dry-run preview. Nothing has been saved yet.</p>
                </>
              )}
            </>
          )}

          {stage === 'success' && result && (
            <>
              <div className="bulk-import-success-mark">✓</div>
              <div className="bulk-import-success-heading">
                <h3>Your API items are ready</h3>
                <p>{result.created.folders + result.created.requests} items were imported successfully.</p>
              </div>
              <div className="bulk-import-result-list">
                <div className="bulk-import-result-row"><span>Folders imported</span><strong>{result.created.folders}</strong></div>
                <div className="bulk-import-result-row"><span>Requests imported</span><strong>{result.created.requests}</strong></div>
                <div className="bulk-import-result-row"><span>Folders renamed</span><strong>{result.renamed.length}</strong></div>
                <div className="bulk-import-result-row"><span>Import location</span><strong>{selectedFolder?.label || 'Collection root'}</strong></div>
              </div>
              {result.renamed.length > 0 && (
                <div className="bulk-import-result-list">
                  <h3>Renamed folders</h3>
                  {result.renamed.map((entry, index) => (
                    <div className="bulk-import-result-row" key={`${describePath(entry.path)}-${index}`}>
                      <span>{describePath(entry.path)}</span><strong>{entry.from} → {entry.to}</strong>
                    </div>
                  ))}
                </div>
              )}
              {result.warnings.length > 0 && (
                <div className="bulk-import-warnings">
                  <h3>Review before sending</h3>
                  {result.warnings.map((warning, index) => (
                    <p key={`${warning.code}-${index}`}>
                      <strong>{warning.code}</strong> · {describePath(warning.path)}
                      {warning.header ? ` · ${warning.header} may contain a sensitive value` : ''}
                    </p>
                  ))}
                </div>
              )}
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
              <Button disabled={!canPreview} onClick={() => void runPreview()}>{busy ? 'Checking…' : 'Preview import'}</Button>
            </>
          )}
          {stage === 'review' && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => { setStage('select'); setError(''); setErrorCode(undefined) }}>Back</Button>
              {preview && !conflict && <Button disabled={busy} onClick={() => void confirmImport()}>{busy ? 'Importing…' : `Import ${preview.created.folders + preview.created.requests} items`}</Button>}
              {!preview && <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>}
            </>
          )}
          {stage === 'success' && (
            <>
              <Button variant="outline" onClick={() => { setStage('select'); setParsed(null); setPreview(null); setResult(null); setFileName(''); setError(''); setErrorCode(undefined); setRefreshError('') }}>Import another file</Button>
              <Button onClick={onDone}>View collection</Button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
