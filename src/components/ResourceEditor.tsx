import { lazy, Suspense, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ResponsePanel } from '@/components/ResponsePanel'
import { PresenceAvatars } from '@/components/PresenceAvatars'
import { VariableInput, type VariableLookup } from '@/components/VariableInput'
import { AuthEditor } from '@/components/AuthEditor'
import type { ProxySettings } from '@/lib/api'
import { copyVariableKey } from '@/lib/copy-key'
import type { AuthSource } from '@/lib/auth-resolution'
import type { RecordedResponse, RunnerId } from '@/lib/request-runner'
import { parseMultipartFields, parseUrlEncodedFields, serializeUrlEncodedFields, type MultipartField } from '@/lib/request-body'
import { MAX_REQUEST_BODY_LENGTH, type AuthCredentials, type EnvironmentResource, type EnvironmentVariable, type KeyValueEntry, type RequestAuth, type RequestBody, type RequestMethod, type ResourceAuth, type ResourceDraft } from '@/lib/workspace-types'
import type { PresenceUser } from '@/lib/presence'
import { DISCARD_SHORTCUT, matchesShortcut, SAVE_SHORTCUT, shortcutLabel } from '@/lib/shortcuts'

const NO_VARIABLES: VariableLookup = {}

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
  /** Reverts the draft to its last saved copy; offered only while there are unsaved changes. */
  onDiscard?: () => void
  onShowVersionHistory?: () => void
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
  /** Resolved variables, used to colour `{{name}}` references as defined or undefined. */
  variables?: VariableLookup
  viewers?: PresenceUser[]
  /** What the open item's "Inherit" auth setting currently resolves to, for a live preview. */
  effectiveAuth?: { auth: AuthCredentials; source: AuthSource }
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
  const reach = proxy.anyHost ? 'Any host is allowed.' : `Allowed hosts: ${proxy.allowedHosts.join(', ')}.`
  return `${browser}\nServer: the API sends it instead, so CORS does not apply. ${reach}`
}

const requestTabs: RequestTab[] = ['Params', 'Headers', 'Body', 'Auth']
const methods: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const bodyTypes: RequestBody['type'][] = ['json', 'form-urlencoded', 'multipart', 'raw', 'graphql']

function suggestedContentType(type: RequestBody['type']): string {
  switch (type) {
    case 'json':
    case 'graphql': return 'application/json'
    case 'form-urlencoded': return 'application/x-www-form-urlencoded'
    case 'multipart': return 'multipart/form-data'
    case 'raw': return 'text/plain'
  }
}

export function ResourceEditor({ draft, collectionName: parentCollectionName, dirty, saving, error, onChange, onSave, onDiscard, onShowVersionHistory, onDelete, onSend, sending, sendError, response, runnerId, onRunnerChange, proxy, onRetryFromServer, requestKey = null, variables = NO_VARIABLES, viewers = [], effectiveAuth }: ResourceEditorProps) {
  const [tab, setTab] = useState<RequestTab>('Params')
  const [requestHeight, setRequestHeight] = useState(56)
  const isRequest = draft.kind === 'request'
  const bodyTooLong = draft.kind === 'request' && (draft.resource.body?.content.length ?? 0) > MAX_REQUEST_BODY_LENGTH
  const name = draft.resource.name
  const collectionId = draft.kind === 'collection' ? draft.resource.id : draft.kind === 'environment' ? '' : draft.collectionId
  const collectionName = draft.kind === 'collection' ? draft.resource.name : parentCollectionName ?? collectionId

  useEffect(() => {
    setTab('Params')
  }, [draft.kind, draft.resource.id])

  const canSave = dirty && !saving && !bodyTooLong
  const canDiscard = dirty && !saving && !!onDiscard
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      // A dialog already open owns the keyboard; don't act on the editor underneath it.
      if (document.querySelector('[aria-modal="true"]')) return
      if (matchesShortcut(event, SAVE_SHORTCUT)) {
        // Always suppress the browser's "Save page" dialog while an editor is open.
        event.preventDefault()
        if (canSave) onSave()
      } else if (matchesShortcut(event, DISCARD_SHORTCUT) && canDiscard) {
        event.preventDefault()
        onDiscard?.()
      }
    }
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [canSave, canDiscard, onSave, onDiscard])

  function updateName(value: string) {
    onChange({ ...draft, resource: { ...draft.resource, name: value } } as ResourceDraft)
  }

  function updateBodyType(type: RequestBody['type'] | null) {
    if (draft.kind !== 'request') return
    const body = type === null
      ? null
      : { type, content: draft.resource.body?.content ?? '' } satisfies RequestBody
    if (type === null) {
      onChange({ ...draft, resource: { ...draft.resource, body } })
      return
    }

    const contentType = suggestedContentType(type)
    const existing = draft.resource.headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => header.key.trim().toLowerCase() === 'content-type')
    const headers = existing.length === 0
      ? [...draft.resource.headers, { key: 'Content-Type', value: contentType, description: '', enabled: true }]
      : draft.resource.headers.map((header, index) => {
          if (header.key.trim().toLowerCase() !== 'content-type') return header
          return {
            ...header,
            value: contentType,
            enabled: index === existing[0].index ? true : header.enabled,
          }
        })
    onChange({ ...draft, resource: { ...draft.resource, body, headers } })
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
        {/*
          A response belongs to a request. A collection or folder has none to show and never will,
          so the split is dropped entirely for them and the form gets the full height, rather than
          leaving an empty panel that looks like a response failed to arrive.
        */}
        <section className="request-panel" style={isRequest ? { flex: `0 0 ${requestHeight}%` } : undefined}>
          <header className="resource-heading">
            <div className="resource-heading-copy">
              {draft.kind === 'request'
                ? <input className="resource-title-input" aria-label="Request name" value={draft.resource.name} onChange={(event) => updateName(event.target.value)} placeholder="Request name" />
                : <h1>{draft.kind === 'environment' ? 'Environment' : draft.kind === 'collection' ? 'Collection' : 'Folder'}</h1>}
              <p>{draft.kind === 'environment' ? 'Shared variables for request URLs and ports' : draft.kind === 'collection' ? 'Collection metadata' : draft.kind === 'request' ? 'Changes are saved only to this request.' : 'Folder settings'}</p>
              <AttributionLine createdBy={draft.resource.createdBy} updatedBy={draft.resource.updatedBy} />
            </div>
            <div className="resource-actions">
              {viewers.length > 0 && (
                <div className="resource-viewers">
                  <PresenceAvatars users={viewers} />
                  <span>{viewers.length} viewing</span>
                </div>
              )}
              <SaveState dirty={dirty} />
              {onShowVersionHistory && <Button variant="outline" size="sm" onClick={onShowVersionHistory}>Version history</Button>}
              {!(draft.kind === 'environment' && draft.isNew) && <Button variant="outline" size="sm" onClick={onDelete}>Move to Trash</Button>}
              {dirty && onDiscard && <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving} title={`Discard changes (${shortcutLabel(DISCARD_SHORTCUT)})`}>Discard changes</Button>}
              <Button size="sm" onClick={onSave} disabled={!canSave} title={`Save (${shortcutLabel(SAVE_SHORTCUT)})`}>{saving ? 'Saving…' : 'Save'}</Button>
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
                <VariableInput className="url-input" variables={variables} aria-label="Request URL" value={draft.resource.url} placeholder="{{baseUrl}}:{{port}}/path" onChange={(event) => onChange({ ...draft, resource: { ...draft.resource, url: event.target.value } })} />
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
              {bodyTooLong && <p className="inline-error" role="alert">Request body content exceeds the {MAX_REQUEST_BODY_LENGTH.toLocaleString()} character limit.</p>}
              <div className="editor-tabs" role="tablist" aria-label="Request editor">
                {requestTabs.map((entry) => (
                  <button key={entry} role="tab" aria-selected={tab === entry} className={tab === entry ? 'editor-tab active' : 'editor-tab'} onClick={() => setTab(entry)}>{entry}</button>
                ))}
              </div>
              <div className="editor-body">
                {tab === 'Params' && <KeyValueEditor label="Query parameters" entries={draft.resource.queryParams} variables={variables} onChange={(entries) => onChange({ ...draft, resource: { ...draft.resource, queryParams: entries } })} />}
                {tab === 'Headers' && <KeyValueEditor label="Headers" entries={draft.resource.headers} variables={variables} onChange={(entries) => onChange({ ...draft, resource: { ...draft.resource, headers: entries } })} />}
                {tab === 'Body' && (
                  <RequestBodyEditor
                    body={draft.resource.body}
                    variables={variables}
                    onBodyTypeChange={updateBodyType}
                    onBodyChange={(body) => onChange({ ...draft, resource: { ...draft.resource, body } })}
                  />
                )}
                {tab === 'Auth' && (
                  <AuthEditor
                    mode="request"
                    auth={draft.resource.auth}
                    variables={variables}
                    effective={effectiveAuth}
                    onChange={(auth) => onChange({ ...draft, resource: { ...draft.resource, auth: auth as RequestAuth } })}
                  />
                )}
              </div>
            </>
          ) : draft.kind === 'environment' ? (
            <EnvironmentEditor draft={draft.resource} onChange={(resource) => onChange({ ...draft, resource })} />
          ) : (
            <div className="resource-form">
              <label className="field-label">Name<input className="text-field" value={name} onChange={(event) => updateName(event.target.value)} /></label>
              {draft.kind === 'collection' && (
                <>
                  <label className="field-label">Description<textarea className="text-field description-field" value={draft.resource.description} onChange={(event) => onChange({ kind: 'collection', resource: { ...draft.resource, description: event.target.value } })} /></label>
                  <h2 className="auth-section-heading">Authentication</h2>
                  <AuthEditor
                    mode="resource"
                    auth={draft.resource.auth ?? null}
                    variables={variables}
                    onChange={(auth) => onChange({ kind: 'collection', resource: { ...draft.resource, auth: auth as ResourceAuth } })}
                  />
                </>
              )}
              {draft.kind === 'folder' && (
                <>
                  <label className="field-label">Description<textarea className="text-field description-field" value={draft.resource.description} onChange={(event) => onChange({ kind: 'folder', collectionId: draft.collectionId, resource: { ...draft.resource, description: event.target.value } })} /></label>
                  <h2 className="auth-section-heading">Authentication</h2>
                  <AuthEditor
                    mode="resource"
                    auth={draft.resource.auth ?? null}
                    variables={variables}
                    effective={effectiveAuth}
                    onChange={(auth) => onChange({ kind: 'folder', collectionId: draft.collectionId, resource: { ...draft.resource, auth: auth as ResourceAuth } })}
                  />
                </>
              )}
            </div>
          )}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </section>
        {isRequest && (
          <>
            <div className="resize-handle" role="separator" aria-label="Resize request and response panels" onPointerDown={resize} />
            <ResponsePanel sending={sending} response={response} onRetryFromServer={onRetryFromServer} requestKey={requestKey} />
          </>
        )}
      </div>
    </section>
  )
}

function RequestBodyEditor({
  body,
  variables,
  onBodyTypeChange,
  onBodyChange,
}: {
  body: RequestBody | null
  variables: VariableLookup
  onBodyTypeChange: (type: RequestBody['type'] | null) => void
  onBodyChange: (body: RequestBody) => void
}) {
  const multipart = body?.type === 'multipart' ? parseMultipartFields(body.content) : null
  const multipartFields = multipart?.ok ? multipart.fields : []

  function updateMultipart(fields: MultipartField[]) {
    if (body?.type === 'multipart') onBodyChange({ ...body, content: JSON.stringify(fields) })
  }

  const typeDescription = body?.type === 'json' || body?.type === 'graphql'
    ? 'JSON text; template variables are allowed.'
    : body?.type === 'form-urlencoded'
      ? 'Fields are URL-encoded in row order; repeated keys are supported.'
      : body?.type === 'multipart'
        ? 'Text fields only. File and browser FormData uploads are not supported.'
        : 'Uninterpreted text. Set or adjust Content-Type in Headers.'

  return (
    <div className="body-editor">
      <label className="body-type-control">
        <span>Body type</span>
        <select
          aria-label="Body type"
          value={body?.type ?? ''}
          onChange={(event) => onBodyTypeChange(event.target.value ? event.target.value as RequestBody['type'] : null)}
        >
          <option value="">No body</option>
          {bodyTypes.map((type) => <option key={type} value={type}>{type === 'form-urlencoded' ? 'URL-encoded' : type === 'json' ? 'JSON' : type === 'graphql' ? 'GraphQL' : type === 'raw' ? 'Raw' : 'Multipart'}</option>)}
        </select>
      </label>
      {body && (
        <>
          <div className="body-toolbar">
            <span>{body.type === 'form-urlencoded' ? 'URL-encoded' : body.type[0].toUpperCase() + body.type.slice(1)}</span>
            <span>{typeDescription}</span>
          </div>
          {(body.type === 'json' || body.type === 'graphql') && (
            <Suspense fallback={<div className="editor-loading">Loading JSON editor…</div>}>
              <JsonEditor
                value={body.content}
                variables={variables}
                onChange={(content) => onBodyChange({ ...body, content })}
              />
            </Suspense>
          )}
          {body.type === 'raw' && (
            <textarea
              className="body-textarea"
              aria-label="Raw request body"
              value={body.content}
              onChange={(event) => onBodyChange({ ...body, content: event.target.value })}
              spellCheck={false}
            />
          )}
          {body.type === 'form-urlencoded' && (
            <FormUrlEncodedEditor content={body.content} variables={variables} onChange={(content) => onBodyChange({ ...body, content })} />
          )}
          {body.type === 'multipart' && (
            multipart?.ok
              ? <MultipartEditor fields={multipartFields} variables={variables} onChange={updateMultipart} />
              : <div className="multipart-invalid">
                  <p className="inline-error" role="alert">{multipart?.message}</p>
                  <label className="field-label">
                    Multipart fields JSON
                    <textarea
                      className="body-textarea"
                      aria-label="Multipart fields JSON"
                      value={body.content}
                      onChange={(event) => onBodyChange({ ...body, content: event.target.value })}
                      spellCheck={false}
                    />
                  </label>
                </div>
          )}
        </>
      )}
    </div>
  )
}

function FormUrlEncodedEditor({
  content,
  variables,
  onChange,
}: {
  content: string
  variables: VariableLookup
  onChange: (content: string) => void
}) {
  const rows = parseUrlEncodedFields(content)
  const update = (index: number, patch: Partial<(typeof rows)[number]>) => {
    const changed = rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)
    onChange(serializeUrlEncodedFields(changed))
  }
  const add = () => onChange(serializeUrlEncodedFields([...rows, { key: '', value: '' }]))
  const remove = (index: number) => onChange(serializeUrlEncodedFields(rows.filter((_, rowIndex) => rowIndex !== index)))
  return (
    <div>
      <div className="param-head body-rows-head"><span>KEY</span><span>VALUE</span><span></span></div>
      {rows.map((row, index) => (
        <div className="body-param-row" key={`${index}-${row.key}`}>
          <VariableInput className="cell-input" variables={variables} aria-label={`URL-encoded key ${index + 1}`} value={row.key} placeholder="Key" onChange={(event) => update(index, { key: event.target.value })} />
          <VariableInput className="cell-input" variables={variables} aria-label={`URL-encoded value ${index + 1}`} value={row.value} placeholder="Value" onChange={(event) => update(index, { value: event.target.value })} />
          <button className="row-remove" aria-label={`Remove URL-encoded field ${index + 1}`} onClick={() => remove(index)}>×</button>
        </div>
      ))}
      <button className="add-param" onClick={add}>＋ Add field</button>
    </div>
  )
}

function MultipartEditor({
  fields,
  variables,
  onChange,
}: {
  fields: MultipartField[]
  variables: VariableLookup
  onChange: (fields: MultipartField[]) => void
}) {
  const update = (index: number, patch: Partial<MultipartField>) => onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field))
  const add = () => onChange([...fields, { key: '', value: '', enabled: true }])
  return (
    <div>
      <div className="param-head body-rows-head body-multipart-head"><span></span><span>FIELD</span><span>VALUE</span><span></span></div>
      {fields.map((field, index) => (
        <div className="body-param-row body-multipart-row" key={`${index}-${field.key}`}>
          <input className="check" type="checkbox" aria-label={`Enable multipart field ${field.key || index + 1}`} checked={field.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />
          <VariableInput className="cell-input" variables={variables} aria-label={`Multipart field name ${index + 1}`} value={field.key} placeholder="Field name" onChange={(event) => update(index, { key: event.target.value })} />
          <VariableInput className="cell-input" variables={variables} aria-label={`Multipart field value ${index + 1}`} value={field.value} placeholder="Value" onChange={(event) => update(index, { value: event.target.value })} />
          <button className="row-remove" aria-label={`Remove multipart field ${index + 1}`} onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>×</button>
        </div>
      ))}
      <button className="add-param" onClick={add}>＋ Add text field</button>
    </div>
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

function KeyValueEditor({ label, entries, variables, onChange }: { label: string; entries: KeyValueEntry[]; variables: VariableLookup; onChange: (entries: KeyValueEntry[]) => void }) {
  const change = (index: number, patch: Partial<KeyValueEntry>) => onChange(entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry))
  const add = () => onChange([...entries, { key: '', value: '', enabled: true, description: '' }])
  return (
    <div>
      <div className="param-head"><span></span><span>KEY</span><span>VALUE</span><span>DESCRIPTION</span><span></span></div>
      {entries.map((entry, index) => (
        <div className="param-row" key={`${label}-${index}`}>
          <input className="check" type="checkbox" aria-label={`Enable ${label} ${entry.key || index + 1}`} checked={entry.enabled} onChange={(event) => change(index, { enabled: event.target.checked })} />
          <VariableInput className="cell-input" variables={variables} aria-label={`${label} key ${index + 1}`} value={entry.key} placeholder="Key" onChange={(event) => change(index, { key: event.target.value })} />
          <VariableInput className="cell-input" variables={variables} aria-label={`${label} value ${index + 1}`} value={entry.value} placeholder="Value" onChange={(event) => change(index, { value: event.target.value })} />
          <input className="cell-input description" aria-label={`${label} description ${index + 1}`} value={entry.description} placeholder="Description" onChange={(event) => change(index, { description: event.target.value })} />
          <button className="row-remove" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(entries.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      <button className="add-param" onClick={add}>＋ Add {label === 'Headers' ? 'header' : 'parameter'}</button>
    </div>
  )
}

type MoveTarget = 'top' | 'up' | 'down' | 'bottom'
const ENV_MOVE_OPTIONS: { target: MoveTarget; label: string }[] = [
  { target: 'top', label: 'Move to top' },
  { target: 'up', label: 'Move up' },
  { target: 'down', label: 'Move down' },
  { target: 'bottom', label: 'Move to bottom' },
]

function EnvironmentEditor({ draft, onChange }: { draft: EnvironmentResource; onChange: (resource: EnvironmentResource) => void }) {
  const add = () => onChange({ ...draft, variables: [...draft.variables, { key: '', value: '', enabled: true }] })
  const change = (index: number, patch: Partial<EnvironmentVariable>) => onChange({
    ...draft,
    variables: draft.variables.map((variable, i) => i === index ? { ...variable, ...patch } : variable),
  })
  // The copy is inserted directly below the original rather than at the end of the list, so a
  // long environment does not send the user looking for what they just duplicated.
  const duplicate = (index: number) => {
    const source = draft.variables[index]
    const taken = new Set(draft.variables.map((variable) => variable.key))
    const copy = { ...source, key: copyVariableKey(source.key, (candidate) => taken.has(candidate)) }
    onChange({ ...draft, variables: [...draft.variables.slice(0, index + 1), copy, ...draft.variables.slice(index + 1)] })
  }
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropHint, setDropHint] = useState<{ index: number; position: 'before' | 'after' } | null>(null)
  const [menuIndex, setMenuIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const last = draft.variables.length - 1

  useEffect(() => {
    if (menuIndex === null) return
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.runtime-vars-move')) setMenuIndex(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuIndex])

  const moveTo = (from: number, to: number) => {
    const target = Math.max(0, Math.min(last, to))
    if (from === target) return
    const next = [...draft.variables]
    const [moved] = next.splice(from, 1)
    next.splice(target, 0, moved)
    onChange({ ...draft, variables: next })
    return target
  }
  const moveBy = (index: number, target: MoveTarget) =>
    moveTo(index, target === 'top' ? 0 : target === 'bottom' ? last : target === 'up' ? index - 1 : index + 1)

  const handleKeyboardMove = (event: ReactKeyboardEvent, index: number) => {
    const target = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : event.key === 'Home' ? 'top' : event.key === 'End' ? 'bottom' : null
    if (!target) return
    event.preventDefault()
    const next = moveBy(index, target)
    // Keep focus on the moved row's handle so repeated presses keep moving it.
    if (next !== undefined) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-handle="${next}"]`)?.focus())
  }
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>, index: number) => {
    if (dragIndex === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const box = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
    if (dropHint?.index !== index || dropHint.position !== position) setDropHint({ index, position })
  }
  const endDrag = () => { setDragIndex(null); setDropHint(null) }
  const handleDrop = (event: ReactDragEvent) => {
    event.preventDefault()
    if (dragIndex !== null && dropHint && dropHint.index !== dragIndex) {
      const insertAt = dropHint.index + (dropHint.position === 'after' ? 1 : 0)
      moveTo(dragIndex, insertAt > dragIndex ? insertAt - 1 : insertAt)
    }
    endDrag()
  }

  return (
    <div className="resource-form environment-form">
      <label className="field-label">Environment name<input className="text-field" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
      <div className="environment-list-heading"><div><h2>Variables</h2><p>Keys are case-sensitive and cannot contain spaces or braces.</p></div></div>
      <div ref={listRef}>
      <div className="param-head environment-head"><span></span><span></span><span>KEY</span><span>VALUE</span><span></span><span></span><span></span></div>
      {draft.variables.map((variable, index) => {
        const name = variable.key || `variable ${index + 1}`
        const hint = dropHint?.index === index && dragIndex !== index ? dropHint.position : null
        const menuOpen = menuIndex === index
        return (
        <div
          className={['param-row environment-row', dragIndex === index && 'is-dragging', hint && `drop-${hint}`].filter(Boolean).join(' ')}
          key={`variable-${index}`}
          onDragOver={(event) => handleDragOver(event, index)}
          onDrop={handleDrop}
        >
          <button
            type="button"
            className="runtime-vars-handle"
            draggable
            data-handle={index}
            aria-label={`Reorder ${name}`}
            title="Drag to reorder (or focus and use ↑ ↓ Home End)"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', variable.key)
              const row = event.currentTarget.parentElement
              if (row) event.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2)
              setDragIndex(index)
              setMenuIndex(null)
            }}
            onDragEnd={endDrag}
            onKeyDown={(event) => handleKeyboardMove(event, index)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
          </button>
          <input className="check" type="checkbox" aria-label={`Enable variable ${variable.key || index + 1}`} checked={variable.enabled} onChange={(event) => change(index, { enabled: event.target.checked })} />
          <input className="cell-input" aria-label={`Variable key ${index + 1}`} value={variable.key} placeholder="baseUrl" onChange={(event) => change(index, { key: event.target.value })} />
          <input className="cell-input" aria-label={`Variable value ${index + 1}`} value={variable.value} placeholder="https://api.example.com" onChange={(event) => change(index, { value: event.target.value })} />
          <button className="row-clone" aria-label={`Duplicate variable ${index + 1}`} title={`Duplicate ${variable.key || 'this variable'}`} onClick={() => duplicate(index)}>⧉</button>
          <button className="row-remove" aria-label={`Remove variable ${index + 1}`} onClick={() => onChange({ ...draft, variables: draft.variables.filter((_, i) => i !== index) })}>×</button>
          <span className="runtime-vars-move">
            <button type="button" className="row-clone" aria-label={`Move ${name}`} title="Move" aria-haspopup="menu" aria-expanded={menuOpen}
              onClick={() => setMenuIndex(menuOpen ? null : index)}>⋮</button>
            {menuOpen && (
              <span className="runtime-vars-move-menu" role="menu" aria-label={`Move ${name}`} onKeyDown={(event) => { if (event.key === 'Escape') setMenuIndex(null) }}>
                {ENV_MOVE_OPTIONS.map(({ target, label }) => (
                  <button type="button" role="menuitem" key={target}
                    disabled={((target === 'top' || target === 'up') && index === 0) || ((target === 'bottom' || target === 'down') && index === last)}
                    onClick={() => { moveBy(index, target); setMenuIndex(null) }}>
                    {label}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
        )
      })}
      </div>
      <button className="add-param" onClick={add}>＋ Add variable</button>
    </div>
  )
}
