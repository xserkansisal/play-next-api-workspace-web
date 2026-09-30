import { lazy, Suspense, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ResponsePanel } from '@/components/ResponsePanel'
import type { ProxySettings } from '@/lib/api'
import type { RecordedResponse, RunnerId } from '@/lib/request-runner'
import type { EnvironmentResource, EnvironmentVariable, KeyValueEntry, RequestMethod, ResourceDraft } from '@/lib/workspace-types'

const JsonEditor = lazy(() => import('@/components/JsonEditor').then(({ JsonEditor: Editor }) => ({ default: Editor })))

type RequestTab = 'Params' | 'Headers' | 'Body' | 'Auth'

interface ResourceEditorProps {
  draft: ResourceDraft
  collectionName?: string
  dirty: boolean
  saving: boolean
  error: string | null
  onChange: (draft: ResourceDraft) => void
  onSave: () => void
  onDelete: () => void
  onSend: () => void
  sending: boolean
  sendError: string | null
  response: RecordedResponse | null
  runnerId: RunnerId
  onRunnerChange: (runnerId: RunnerId) => void
  /** Null until the API has been asked; the server option stays disabled until then. */
  proxy: ProxySettings | null
  /** Present only when sending from the server is a genuine remedy for the failure now shown. */
  onRetryFromServer?: () => void
  /** Identifies the open request, so a response-sync rule can be bound to it. */
  requestKey?: string | null
}

/**
 * Explains the choice in a tooltip rather than burying it in docs: sending from the server is the
 * only way to reach a target that sends no CORS headers, but it is not a better default - it needs
 * operator setup and the request leaves from the API's network position, not the user's.
 */
function describeRunnerChoice(proxy: ProxySettings | null): string {
  const browser = 'Browser: sent from this page. Cannot reach a server that does not send CORS headers.'
  if (proxy === null) return browser
  if (!proxy.enabled) {
    return `${browser}\nServer: unavailable - an operator must set PROXY_ALLOWED_HOSTS on the API.`
  }
  return `${browser}\nServer: the API sends it instead, so CORS does not apply. Allowed hosts: ${proxy.allowedHosts.join(', ')}.`
}

const requestTabs: RequestTab[] = ['Params', 'Headers', 'Body', 'Auth']
const methods: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export function ResourceEditor({ draft, collectionName: parentCollectionName, dirty, saving, error, onChange, onSave, onDelete, onSend, sending, sendError, response, runnerId, onRunnerChange, proxy, onRetryFromServer, requestKey = null }: ResourceEditorProps) {
  const [tab, setTab] = useState<RequestTab>('Params')
  const [requestHeight, setRequestHeight] = useState(56)
  const name = draft.resource.name
  const collectionId = draft.kind === 'collection' ? draft.resource.id : draft.kind === 'environment' ? '' : draft.collectionId
  const collectionName = draft.kind === 'collection' ? draft.resource.name : parentCollectionName ?? collectionId

  useEffect(() => {
    setTab('Params')
  }, [draft.kind, draft.resource.id])

  function updateName(value: string) {
    onChange({ ...draft, resource: { ...draft.resource, name: value } } as ResourceDraft)
  }

  function resize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const update = (moveEvent: PointerEvent) => {
      setRequestHeight(Math.max(28, Math.min(78, ((moveEvent.clientY - bounds.top) / bounds.height) * 100)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', stop, { once: true })
  }

  return (
    <section className="workspace-content">
      <div className="breadcrumbs">
        <span>{draft.kind === 'environment' ? 'Environments' : collectionName}</span>
        {draft.kind !== 'collection' && draft.kind !== 'environment' && <><span>›</span><strong>{draft.resource.name || 'Untitled'}</strong></>}
        {draft.kind === 'collection' && <><span>›</span><strong>Collection settings</strong></>}
      </div>
      <div className="editor-layout">
        <section className="request-panel" style={{ flex: `0 0 ${requestHeight}%` }}>
          <header className="resource-heading">
            <div className="resource-heading-copy">
              {draft.kind === 'request'
                ? <input className="resource-title-input" aria-label="Request name" value={draft.resource.name} onChange={(event) => updateName(event.target.value)} placeholder="Request name" />
                : <h1>{draft.kind === 'environment' ? 'Environment' : draft.kind === 'collection' ? 'Collection' : 'Folder'}</h1>}
              <p>{draft.kind === 'environment' ? 'Shared variables for request URLs and ports' : draft.kind === 'collection' ? 'Collection metadata' : draft.kind === 'request' ? 'Changes are saved only to this request.' : 'Folder settings'}</p>
              <AttributionLine createdBy={draft.resource.createdBy} updatedBy={draft.resource.updatedBy} />
            </div>
            <div className="resource-actions">
              <SaveState dirty={dirty} />
              <Button variant="outline" size="sm" onClick={onDelete}>Move to Trash</Button>
              <Button size="sm" onClick={onSave} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </header>
          {draft.kind === 'request' ? (
            <>
              <div className="url-row">
                <select
                  className="method-select"
                  aria-label="HTTP method"
                  value={draft.resource.method}
                  onChange={(event) => onChange({ ...draft, resource: { ...draft.resource, method: event.target.value as RequestMethod } })}
                >
                  {methods.map((method) => <option key={method}>{method}</option>)}
                </select>
                <input className="url-input" aria-label="Request URL" value={draft.resource.url} placeholder="{{baseUrl}}:{{port}}/path" onChange={(event) => onChange({ ...draft, resource: { ...draft.resource, url: event.target.value } })} />
                <select
                  className="runner-select"
                  aria-label="Send from"
                  value={runnerId}
                  onChange={(event) => onRunnerChange(event.target.value as RunnerId)}
                  title={describeRunnerChoice(proxy)}
                >
                  <option value="browser">Browser</option>
                  <option value="server" disabled={proxy !== null && !proxy.enabled}>
                    {proxy !== null && !proxy.enabled ? 'Server (not enabled)' : 'Server'}
                  </option>
                </select>
                <Button className="send-button" onClick={onSend} disabled={sending}>{sending ? 'Sending…' : 'Send'}</Button>
              </div>
              {sendError && <p className="inline-error send-error" role="alert">{sendError}</p>}
              <label className="request-description">
                <span>Description</span>
                <input aria-label="Request description" value={draft.resource.description} placeholder="Add a description" onChange={(event) => onChange({ ...draft, resource: { ...draft.resource, description: event.target.value } })} />
              </label>
              <div className="editor-tabs" role="tablist" aria-label="Request editor">
                {requestTabs.map((entry) => (
                  <button key={entry} role="tab" aria-selected={tab === entry} className={tab === entry ? 'editor-tab active' : 'editor-tab'} onClick={() => setTab(entry)}>{entry}</button>
                ))}
              </div>
              <div className="editor-body">
                {tab === 'Params' && <KeyValueEditor label="Query parameters" entries={draft.resource.queryParams} onChange={(entries) => onChange({ ...draft, resource: { ...draft.resource, queryParams: entries } })} />}
                {tab === 'Headers' && <KeyValueEditor label="Headers" entries={draft.resource.headers} onChange={(entries) => onChange({ ...draft, resource: { ...draft.resource, headers: entries } })} />}
                {tab === 'Body' && (
                  <div className="body-editor">
                      <div className="body-toolbar"><span>JSON</span><span>JSON is saved as text; template variables are allowed.</span></div>
                    <Suspense fallback={<div className="editor-loading">Loading JSON editor…</div>}>
                      <JsonEditor
                        value={draft.resource.body?.content ?? ''}
                        onChange={(content) => onChange({ ...draft, resource: { ...draft.resource, body: content ? { type: 'json', content } : null } })}
                      />
                    </Suspense>
                  </div>
                )}
                {tab === 'Auth' && <div className="auth-placeholder"><strong>No Auth</strong><p>Authentication is not configured for this request.</p></div>}
              </div>
            </>
          ) : draft.kind === 'environment' ? (
            <EnvironmentEditor draft={draft.resource} onChange={(resource) => onChange({ kind: 'environment', resource })} />
          ) : (
            <div className="resource-form">
              <label className="field-label">Name<input className="text-field" value={name} onChange={(event) => updateName(event.target.value)} /></label>
              {draft.kind === 'collection' && (
                <label className="field-label">Description<textarea className="text-field description-field" value={draft.resource.description} onChange={(event) => onChange({ kind: 'collection', resource: { ...draft.resource, description: event.target.value } })} /></label>
              )}
              {draft.kind === 'folder' && (
                <label className="field-label">Description<textarea className="text-field description-field" value={draft.resource.description} onChange={(event) => onChange({ kind: 'folder', collectionId: draft.collectionId, resource: { ...draft.resource, description: event.target.value } })} /></label>
              )}
            </div>
          )}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </section>
        <div className="resize-handle" role="separator" aria-label="Resize request and response panels" onPointerDown={resize} />
        <ResponsePanel sending={sending} response={response} onRetryFromServer={onRetryFromServer} requestKey={requestKey} />
      </div>
    </section>
  )
}

function SaveState({ dirty }: { dirty: boolean }) {
  return <span className={`save-state ${dirty ? 'unsaved' : ''}`} role="status">{dirty ? '● Unsaved changes' : '● Saved'}</span>
}

function AttributionLine({ createdBy, updatedBy }: { createdBy?: string | null; updatedBy?: string | null }) {
  if (createdBy === undefined && updatedBy === undefined) return null
  // Rows created before sign-in existed have no attribution recorded - that
  // is deliberate history, not a bug, so we say so plainly rather than
  // leaving it blank or guessing a name.
  const created = createdBy ?? 'unknown'
  const updated = updatedBy ?? 'unknown'
  return <p className="attribution-line">Created by {created} · Last updated by {updated}</p>
}

function KeyValueEditor({ label, entries, onChange }: { label: string; entries: KeyValueEntry[]; onChange: (entries: KeyValueEntry[]) => void }) {
  const change = (index: number, patch: Partial<KeyValueEntry>) => onChange(entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry))
  const add = () => onChange([...entries, { key: '', value: '', enabled: true, description: '' }])
  return (
    <div>
      <div className="param-head"><span></span><span>KEY</span><span>VALUE</span><span>DESCRIPTION</span><span></span></div>
      {entries.map((entry, index) => (
        <div className="param-row" key={`${label}-${index}`}>
          <input className="check" type="checkbox" aria-label={`Enable ${label} ${entry.key || index + 1}`} checked={entry.enabled} onChange={(event) => change(index, { enabled: event.target.checked })} />
          <input className="cell-input" aria-label={`${label} key ${index + 1}`} value={entry.key} placeholder="Key" onChange={(event) => change(index, { key: event.target.value })} />
          <input className="cell-input" aria-label={`${label} value ${index + 1}`} value={entry.value} placeholder="Value" onChange={(event) => change(index, { value: event.target.value })} />
          <input className="cell-input description" aria-label={`${label} description ${index + 1}`} value={entry.description} placeholder="Description" onChange={(event) => change(index, { description: event.target.value })} />
          <button className="row-remove" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(entries.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      <button className="add-param" onClick={add}>＋ Add {label === 'Headers' ? 'header' : 'parameter'}</button>
    </div>
  )
}

function EnvironmentEditor({ draft, onChange }: { draft: EnvironmentResource; onChange: (resource: EnvironmentResource) => void }) {
  const add = () => onChange({ ...draft, variables: [...draft.variables, { key: '', value: '', enabled: true }] })
  const change = (index: number, patch: Partial<EnvironmentVariable>) => onChange({
    ...draft,
    variables: draft.variables.map((variable, i) => i === index ? { ...variable, ...patch } : variable),
  })
  return (
    <div className="resource-form environment-form">
      <label className="field-label">Environment name<input className="text-field" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
      <div className="environment-list-heading"><div><h2>Variables</h2><p>Keys are case-sensitive and cannot contain spaces or braces.</p></div></div>
      <div className="param-head environment-head"><span></span><span>KEY</span><span>VALUE</span><span></span></div>
      {draft.variables.map((variable, index) => (
        <div className="param-row environment-row" key={`variable-${index}`}>
          <input className="check" type="checkbox" aria-label={`Enable variable ${variable.key || index + 1}`} checked={variable.enabled} onChange={(event) => change(index, { enabled: event.target.checked })} />
          <input className="cell-input" aria-label={`Variable key ${index + 1}`} value={variable.key} placeholder="baseUrl" onChange={(event) => change(index, { key: event.target.value })} />
          <input className="cell-input" aria-label={`Variable value ${index + 1}`} value={variable.value} placeholder="https://api.example.com" onChange={(event) => change(index, { value: event.target.value })} />
          <button className="row-remove" aria-label={`Remove variable ${index + 1}`} onClick={() => onChange({ ...draft, variables: draft.variables.filter((_, i) => i !== index) })}>×</button>
        </div>
      ))}
      <button className="add-param" onClick={add}>＋ Add variable</button>
    </div>
  )
}
