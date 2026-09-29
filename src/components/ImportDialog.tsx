import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { parsePostmanCollection, type ImportPlan } from '@/lib/postman-import'
import type { CollectionResource, TreeNodeInput } from '@/lib/workspace-types'
import { nameKey } from '@/lib/workspace-ui'

interface ImportDialogProps {
  collections: CollectionResource[]
  onCancel: () => void
  onImport: (payload: { name: string; description: string; items: TreeNodeInput[] }) => Promise<string | void>
}

function countRequests(items: TreeNodeInput[]): number {
  return items.reduce((total, item) => total + (item.type === 'request' ? 1 : countRequests(item.items)), 0)
}

function countFolders(items: TreeNodeInput[]): number {
  return items.reduce((total, item) => total + (item.type === 'folder' ? 1 + countFolders(item.items) : 0), 0)
}

export function ImportDialog({ collections, onCancel, onImport }: ImportDialogProps) {
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [name, setName] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleFile(file: File) {
    setFileName(file.name)
    setSubmitError(null)
    let parsed: unknown
    try {
      const text = await file.text()
      parsed = JSON.parse(text)
    } catch {
      setPlan({ name: '', description: '', items: [], errors: ['This file is not valid JSON and could not be read.'], warnings: [], stats: { folders: 0, requests: 0, requestsSkippedUnsupportedMethod: 0, bodiesDropped: 0, authDropped: 0, scriptsDropped: 0, foldersRenamedForCaseConflict: 0 }, approxPayloadBytes: 0 })
      setName('')
      return
    }
    const result = parsePostmanCollection(parsed)
    setPlan(result)
    setName(result.name)
  }

  const conflict = plan && plan.errors.length === 0
    ? collections.find((collection) => nameKey(collection.name) === nameKey(name.trim()))
    : undefined
  const canConfirm = !!plan && plan.errors.length === 0 && name.trim().length > 0 && !conflict && !submitting

  async function confirm() {
    if (!plan || !canConfirm) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await onImport({ name: name.trim(), description: plan.description, items: plan.items })
    setSubmitting(false)
    if (result) setSubmitError(result)
  }

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="modal-heading">
          <div>
            <h2 id="import-title">Import Postman collection</h2>
            <p>Choose a Postman Collection v2.1 (.json) export. Nothing is saved until you review this summary and confirm.</p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>

        <input
          type="file"
          accept="application/json,.json,.postman_collection"
          aria-label="Postman collection file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />

        {plan && (
          <div className="import-preview">
            {fileName && <p className="no-conflicts">Selected file: {fileName}</p>}

            {plan.errors.length > 0 ? (
              <div className="conflict-list">
                <h3>This file can't be imported</h3>
                {plan.errors.map((error, index) => <p className="inline-error" role="alert" key={index}>{error}</p>)}
              </div>
            ) : (
              <>
                <label className="field-label">Collection name
                  <input className="text-field" value={name} onChange={(event) => setName(event.target.value)} />
                  {conflict && <small className="inline-error">An active collection named "{conflict.name}" already exists. Choose a different name or cancel.</small>}
                </label>

                <div className="conflict-list">
                  <h3>Will import</h3>
                  <p>
                    {countFolders(plan.items)} folder(s) and {countRequests(plan.items)} request(s).
                    {' '}Sibling order is not preserved (this app always shows siblings alphabetically).
                  </p>
                </div>

                {plan.warnings.length > 0 && (
                  <div className="conflict-list">
                    <h3>Unsupported or lossy features ({plan.warnings.length})</h3>
                    <p>These parts of the file will be omitted or altered. Review before continuing.</p>
                    <ul className="import-warning-list">
                      {plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                    </ul>
                  </div>
                )}

                {plan.warnings.length === 0 && <p className="no-conflicts">No unsupported features were found in this file.</p>}
              </>
            )}

            {submitError && <p className="inline-error" role="alert">{submitError}</p>}
          </div>
        )}

        <footer className="modal-actions">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => void confirm()} disabled={!canConfirm}>{submitting ? 'Importing…' : 'Import'}</Button>
        </footer>
      </section>
    </div>
  )
}
