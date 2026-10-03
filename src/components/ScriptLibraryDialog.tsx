import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { apiErrorCode, apiErrorDetails, describeApiError, workspaceApi } from '@/lib/api'
import {
  MAX_SCRIPT_NAME_LENGTH,
  MAX_SCRIPT_SOURCE_LENGTH,
  type Script,
  type ScriptStage,
} from '@/lib/workspace-types'

interface ScriptLibraryDialogProps {
  scripts: Script[]
  canEdit: boolean
  onChange: (scripts: Script[]) => void
  /** Reloads the list from the API, used when the server says our copy is stale. */
  onRefresh: () => Promise<void> | void
  onClose: () => void
}

interface Form {
  id: string | null
  name: string
  description: string
  stage: ScriptStage
  source: string
}

const emptyForm: Form = { id: null, name: '', description: '', stage: 'pre-request', source: '' }
const stageLabel: Record<ScriptStage, string> = { 'pre-request': 'Pre-request', 'post-response': 'Post-response' }

function describeScriptError(error: unknown): string {
  const code = apiErrorCode(error)
  if (code === 'SCRIPT_IN_USE') {
    const details = apiErrorDetails(error)
    const current = Number(details?.referenceCount ?? 0)
    const historical = Number(details?.historicalReferenceCount ?? 0)
    return `This script is still used by ${current} current request(s) and ${historical} saved history entr${historical === 1 ? 'y' : 'ies'}. Remove those references before deleting it or changing its stage.`
  }
  if (code === 'SCRIPT_NAME_CONFLICT') return 'A script with this name already exists in this stage. Choose a different name.'
  if (code === 'TEAM_ROLE_REQUIRED') return 'Your team role does not allow editing shared scripts.'
  return describeApiError(error)
}

export function ScriptLibraryDialog({ scripts, canEdit, onChange, onRefresh, onClose }: ScriptLibraryDialogProps) {
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(describeScriptError(reason))
      if (apiErrorCode(reason) === 'NOT_FOUND') {
        setForm(null)
        void onRefresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const save = () => form && run(async () => {
    const input = { name: form.name.trim(), description: form.description, stage: form.stage, source: form.source }
    if (form.id) {
      const updated = await workspaceApi.updateScript(form.id, input)
      onChange(scripts.map((script) => (script.id === updated.id ? updated : script)))
    } else {
      onChange([...scripts, await workspaceApi.createScript(input)])
    }
    setForm(null)
  })

  const remove = (script: Script) => run(async () => {
    await workspaceApi.deleteScript(script.id)
    onChange(scripts.filter(({ id }) => id !== script.id))
  })

  const valid = !!form && form.name.trim().length > 0 && form.source.length > 0

  return (
    <div className="modal-backdrop">
      <section className="restore-dialog version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="script-library-title">
        <header className="modal-heading">
          <div>
            <h2 id="script-library-title">Script library</h2>
            <p>Shared with your team. Edits apply to every request that links the script.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
        </header>
        {error && <p className="resource-error" role="alert">{error}</p>}
        {form ? (
          <div className="script-block">
            <label>Name
              <input aria-label="Script name" value={form.name} maxLength={MAX_SCRIPT_NAME_LENGTH} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>Description
              <input aria-label="Script description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <label>Stage
              <select aria-label="Script stage" value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value as ScriptStage })}>
                <option value="pre-request">Pre-request</option>
                <option value="post-response">Post-response</option>
              </select>
            </label>
            <div className="body-toolbar">
              <span>Source</span>
              <span>{form.source.length.toLocaleString()} / {MAX_SCRIPT_SOURCE_LENGTH.toLocaleString()} characters</span>
            </div>
            <textarea className="body-textarea" aria-label="Script source" spellCheck={false} maxLength={MAX_SCRIPT_SOURCE_LENGTH} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} />
            <small>Source is visible to your whole team. Keep credentials in environment variables.</small>
            <footer className="modal-actions">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setForm(null); setError(null) }}>Cancel</Button>
              <Button type="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Saving…' : 'Save script'}</Button>
            </footer>
          </div>
        ) : (
          <>
            {scripts.length === 0 && <p className="version-history-empty">No shared scripts yet.</p>}
            <ul className="script-library-list">
              {scripts.map((script) => (
                <li key={script.id}>
                  <span><strong>{script.name}</strong> <small>{stageLabel[script.stage]}{script.description ? ` · ${script.description}` : ''}</small></span>
                  {canEdit && (
                    <span>
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setForm({ id: script.id, name: script.name, description: script.description, stage: script.stage, source: script.source })}>Edit</Button>
                      <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Delete ${script.name}`} onClick={() => void remove(script)}>Delete</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && <footer className="modal-actions"><Button type="button" onClick={() => setForm(emptyForm)}>New script</Button></footer>}
          </>
        )}
      </section>
    </div>
  )
}
