import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { parsePostmanCollection, type ImportPlan } from '@/lib/postman-import'
import {
  detectPostmanFileKind,
  parsePostmanEnvironment,
  type EnvironmentImportPlan,
} from '@/lib/postman-environment'
import type { CollectionResource, EnvironmentResource, TreeNodeInput } from '@/lib/workspace-types'
import { nameKey } from '@/lib/workspace-ui'

interface ImportDialogProps {
  collections: CollectionResource[]
  environments: EnvironmentResource[]
  onCancel: () => void
  onImport: (payload: {
    name: string
    description: string
    items: TreeNodeInput[]
    environment?: { name: string; variables: EnvironmentImportPlan['variables'] }
  }) => Promise<string | void>
  onImportEnvironment: (payload: { name: string; variables: EnvironmentImportPlan['variables'] }) => Promise<string | void>
}

function countRequests(items: TreeNodeInput[]): number {
  return items.reduce((total, item) => total + (item.type === 'request' ? 1 : countRequests(item.items)), 0)
}

function countFolders(items: TreeNodeInput[]): number {
  return items.reduce((total, item) => total + (item.type === 'folder' ? 1 + countFolders(item.items) : 0), 0)
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return <p className="no-conflicts">No unsupported features were found in this file.</p>
  return (
    <div className="conflict-list">
      <h3>Unsupported or lossy features ({warnings.length})</h3>
      <p>These parts of the file will be omitted or altered. Review before continuing.</p>
      <ul className="import-warning-list">
        {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
      </ul>
    </div>
  )
}

export function ImportDialog({ collections, environments, onCancel, onImport, onImportEnvironment }: ImportDialogProps) {
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [envPlan, setEnvPlan] = useState<EnvironmentImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [name, setName] = useState('')
  const [envName, setEnvName] = useState('')
  const [keepVariables, setKeepVariables] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleFile(file: File) {
    setPlan(null)
    setEnvPlan(null)
    setName('')
    setEnvName('')
    setKeepVariables(true)
    setSubmitError(null)
    setFileName(file.name)

    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setPlan({
        name: '', description: '', items: [],
        errors: ['This file is not valid JSON and could not be read.'],
        warnings: [],
        stats: { folders: 0, requests: 0, requestsSkippedUnsupportedMethod: 0, bodiesDropped: 0, authDropped: 0, scriptsDropped: 0, foldersRenamedForCaseConflict: 0 },
        approxPayloadBytes: 0,
        variablesEnvironment: null,
      })
      return
    }

    // The two Postman export shapes are distinguishable, so route the file automatically rather
    // than making the user pick the right importer first and then get a confusing error.
    if (detectPostmanFileKind(parsed) === 'environment') {
      const result = parsePostmanEnvironment(parsed)
      setEnvPlan(result)
      setEnvName(result.name)
      return
    }
    const result = parsePostmanCollection(parsed)
    setPlan(result)
    setName(result.name)
    if (result.variablesEnvironment) setEnvName(result.variablesEnvironment.name)
  }

  const envConflict = envName.trim()
    ? environments.find((environment) => nameKey(environment.name) === nameKey(envName.trim()))
    : undefined

  if (envPlan) {
    const blocked = envPlan.errors.length > 0
    const canConfirmEnv = !blocked && envName.trim().length > 0 && !envConflict && !submitting
    const confirmEnvironment = async () => {
      if (!canConfirmEnv) return
      setSubmitting(true)
      setSubmitError(null)
      const result = await onImportEnvironment({ name: envName.trim(), variables: envPlan.variables })
      setSubmitting(false)
      if (result) setSubmitError(result)
    }
    return (
      <Shell
        title="Import Postman environment"
        onCancel={onCancel}
        onFile={handleFile}
        fileName={fileName}
        footer={
          <>
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={() => void confirmEnvironment()} disabled={!canConfirmEnv}>{submitting ? 'Importing…' : 'Import environment'}</Button>
          </>
        }
      >
        {blocked ? (
          <div className="conflict-list">
            <h3>This file can't be imported</h3>
            {envPlan.errors.map((error, index) => <p className="inline-error" role="alert" key={index}>{error}</p>)}
          </div>
        ) : (
          <>
            <label className="field-label">Environment name
              <input className="text-field" value={envName} onChange={(event) => setEnvName(event.target.value)} />
              {envConflict && <small className="inline-error">An active environment named "{envConflict.name}" already exists. Choose a different name or cancel.</small>}
            </label>
            <div className="conflict-list">
              <h3>Will import</h3>
              <p>{envPlan.variables.length} variable(s) out of {envPlan.sourceCount} in the file.</p>
            </div>
            <WarningList warnings={envPlan.warnings} />
          </>
        )}
        {submitError && <p className="inline-error" role="alert">{submitError}</p>}
      </Shell>
    )
  }

  const conflict = plan && plan.errors.length === 0
    ? collections.find((collection) => nameKey(collection.name) === nameKey(name.trim()))
    : undefined
  const variablesEnv = plan?.variablesEnvironment ?? null
  const envNameBlocks = !!variablesEnv && keepVariables && (envName.trim().length === 0 || !!envConflict)
  const canConfirm = !!plan && plan.errors.length === 0 && name.trim().length > 0 && !conflict && !envNameBlocks && !submitting

  async function confirm() {
    if (!plan || !canConfirm) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await onImport({
      name: name.trim(),
      description: plan.description,
      items: plan.items,
      ...(variablesEnv && keepVariables ? { environment: { name: envName.trim(), variables: variablesEnv.variables } } : {}),
    })
    setSubmitting(false)
    if (result) setSubmitError(result)
  }

  return (
    <Shell
      title="Import from Postman"
      onCancel={onCancel}
      onFile={handleFile}
      fileName={fileName}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => void confirm()} disabled={!canConfirm}>{submitting ? 'Importing…' : 'Import'}</Button>
        </>
      }
    >
      {plan && (plan.errors.length > 0 ? (
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

          {variablesEnv && (
            <div className="conflict-list">
              <h3>Collection variables</h3>
              <label className="checkbox-row">
                <input type="checkbox" checked={keepVariables} onChange={(event) => setKeepVariables(event.target.checked)} />
                <span>Also create an Environment with the {variablesEnv.variables.length} usable variable(s)</span>
              </label>
              {keepVariables && (
                <>
                  <label className="field-label">Environment name
                    <input className="text-field" value={envName} onChange={(event) => setEnvName(event.target.value)} />
                    {envConflict && <small className="inline-error">An active environment named "{envConflict.name}" already exists. Choose a different name or clear the checkbox.</small>}
                    {!envConflict && envName.trim().length === 0 && <small className="inline-error">Enter a name, or clear the checkbox to skip the environment.</small>}
                  </label>
                  <p className="no-conflicts">
                    The collection and the environment are created by two separate requests. The collection is saved
                    first; if the environment then fails, the collection is still imported and the error is reported here.
                  </p>
                </>
              )}
              {variablesEnv.warnings.length > 0 && (
                <ul className="import-warning-list">
                  {variablesEnv.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              )}
            </div>
          )}

          <WarningList warnings={plan.warnings} />
        </>
      ))}
      {submitError && <p className="inline-error" role="alert">{submitError}</p>}
    </Shell>
  )
}

function Shell({
  title, onCancel, onFile, fileName, children, footer,
}: {
  title: string
  onCancel: () => void
  onFile: (file: File) => void | Promise<void>
  fileName: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  const [isDragging, setIsDragging] = useState(false)

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="modal-heading">
          <div>
            <h2 id="import-title">{title}</h2>
            <p>Choose a Postman Collection or Environment (.json) export. The file type is detected automatically, and nothing is saved until you review the summary and confirm.</p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>

        <label
          className={`postman-import-dropzone${isDragging ? ' dragging' : ''}${fileName ? ' has-file' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) void onFile(file)
          }}
        >
          <input
            type="file"
            accept="application/json,.json,.postman_collection,.postman_environment"
            aria-label="Postman file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onFile(file)
              event.currentTarget.value = ''
            }}
          />
          <span className="postman-import-upload-icon" aria-hidden="true">↑</span>
          {fileName ? (
            <>
              <strong>{fileName}</strong>
              <span>File selected · click to choose a different file</span>
            </>
          ) : (
            <>
              <strong>Drop your Postman export here</strong>
              <span>or click to browse · JSON collection or environment</span>
            </>
          )}
        </label>

        <div className="import-preview">
          {children}
        </div>

        <footer className="modal-actions">{footer}</footer>
      </section>
    </div>
  )
}
