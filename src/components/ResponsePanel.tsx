import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'

import { describeApiError } from '@/lib/api'
import { extractFromResponse, suggestPaths } from '@/lib/response-extraction'
import { getScopedVariables, saveScopedVariable, subscribeScopedVariables } from '@/lib/scoped-variables'
import { findSyncRule, getSyncRules, removeSyncRule, ruleScope, setSyncRule, subscribeSyncRules } from '@/lib/sync-rules'
import { validateVariableName, VARIABLE_SCOPES, type VariableScope } from '@/lib/variable-scopes'
import type { ExecutionSuccess, RecordedResponse } from '@/lib/request-runner'
import { JsonTree } from '@/components/JsonTree'

type ResponseTab = 'Body' | 'Headers' | 'Cookies'
type BodyView = 'Tree' | 'Raw'

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatBody(text: string, contentType: string | undefined): { pretty: string; isJson: boolean; parsed?: unknown } {
  const looksJson = (contentType ?? '').includes('json') || /^[\s]*[[{]/.test(text)
  if (looksJson) {
    try {
      const parsed: unknown = JSON.parse(text)
      return { pretty: JSON.stringify(parsed, null, 2), isJson: true, parsed }
    } catch {
      // Not actually valid JSON despite appearances — fall through to plain text.
    }
  }
  return { pretty: text, isJson: false }
}

function ExtractToVariable({ response, requestKey }: { response: ExecutionSuccess; requestKey: string | null }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Personal by default: a value captured from a response is almost always tied to this person's
  // session, and writing one to the shared scope would change what every teammate sends.
  const [scope, setScope] = useState<VariableScope>('user')
  const [saving, setSaving] = useState(false)
  const listId = useId()
  const syncId = useId()
  const scopeId = useId()

  const rules = useSyncExternalStore(subscribeSyncRules, getSyncRules)
  const existing = useSyncExternalStore(subscribeScopedVariables, getScopedVariables)
  const nameListId = useId()
  const existingNames = useMemo(() => [...new Set(existing.map((entry) => entry.key))], [existing])
  const matching = existing.filter((entry) => entry.key === name.trim())
  // The rule shown is the one for the variable just saved: sync is offered as a follow-up to a
  // successful save, so there is always a concrete variable to talk about.
  const activeRule = saved && requestKey ? rules.find((rule) => rule.requestKey === requestKey && rule.name === saved) ?? null : null

  const toggleSync = useCallback((enabled: boolean) => {
    if (!saved || !requestKey) return
    if (enabled) setSyncRule({ requestKey, name: saved, path: path.trim(), scope })
    else removeSyncRule(requestKey, saved)
  }, [saved, requestKey, path, scope])

  useEffect(() => {
    setError(null)
    // A one-off capture is finished once the next response arrives, so its confirmation is cleared.
    // A synced variable is not: it was just written again, and hiding its control after every send
    // would make sync impossible to turn back off.
    setSaved((current) => (current && requestKey && findSyncRule(requestKey, current) ? current : null))
  }, [response, requestKey])

  const suggestions = useMemo(() => (open ? suggestPaths(response) : []), [open, response])
  const preview = useMemo(() => (path.trim() ? extractFromResponse(path, response) : null), [path, response])

  async function save() {
    const validated = validateVariableName(name)
    if (!validated.ok) {
      setError(validated.error)
      setSaved(null)
      return
    }
    const extracted = extractFromResponse(path, response)
    if (!extracted.ok) {
      setError(extracted.error)
      setSaved(null)
      return
    }
    setSaving(true)
    try {
      await saveScopedVariable(scope, validated.name, extracted.value)
    } catch (saveError) {
      // Confirmed rather than assumed: the value lives on the server now, so reporting a save
      // that never happened would leave the next request quietly sending the previous value.
      setError(describeApiError(saveError))
      setSaved(null)
      return
    } finally {
      setSaving(false)
    }
    // An existing rule for this name must follow the path and scope just saved, or sync would keep
    // writing the old ones while the confirmation shows the new.
    if (requestKey && findSyncRule(requestKey, validated.name)) {
      setSyncRule({ requestKey, name: validated.name, path: path.trim(), scope })
    }
    setError(null)
    setSaved(validated.name)
  }

  const syncedHere = requestKey ? rules.filter((rule) => rule.requestKey === requestKey) : []

  // Rendered from the stored rules rather than from local state, so it survives this component
  // being remounted on every send - which it is, because a send swaps the whole response panel for
  // its "Sending..." branch. Without this, sync could be switched on but never off.
  const syncList = requestKey && syncedHere.length > 0 ? (
    <div className="extract-sync-list">
      <span className="extract-synced" role="status">Syncing after every response:</span>
      {syncedHere.map((rule) => (
        <span key={rule.name} className="extract-sync-chip">
          <code>{`{{${rule.name}}}`}</code>
          <span className="extract-sync-path">{rule.path}</span>
          <span className="extract-sync-scope">{ruleScope(rule) === 'user' ? 'only me' : 'everyone'}</span>
          <button
            className="link-button"
            onClick={() => removeSyncRule(requestKey, rule.name)}
            aria-label={`Stop syncing ${rule.name}`}
          >
            Stop
          </button>
        </span>
      ))}
    </div>
  ) : null

  if (!open) {
    return (
      <div className="extract-bar">
        <div className="extract-bar-row">
          <button className="link-button" onClick={() => setOpen(true)}>Save a value as a variable</button>
          {saved && <span className="extract-saved" role="status">{`Saved as {{${saved}}}`}</span>}
        </div>
        {syncList}
      </div>
    )
  }

  return (
    <div className="extract-bar extract-open">
      <form
        className="extract-fields"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label>
          <span>Variable name</span>
          <input
            value={name}
            onChange={(event) => {
              const value = event.target.value
              setName(value)
              // Picking an existing name from the list keeps its scope, so the save overwrites it.
              const match = existing.filter((entry) => entry.key === value.trim())
              if (match.length > 0 && !match.some((entry) => entry.scope === scope)) setScope(match[0].scope)
            }}
            placeholder="token"
            aria-label="Variable name"
            autoComplete="off"
            list={nameListId}
          />
          <datalist id={nameListId}>
            {existingNames.map((entry) => <option key={entry} value={entry} />)}
          </datalist>
        </label>
        <label>
          <span>Value path</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="data.token"
            aria-label="Value path"
            list={listId}
            aria-describedby="extract-path-hint"
            autoComplete="off"
          />
          <datalist id={listId}>
            {suggestions.map((entry) => <option key={entry} value={entry} />)}
          </datalist>
        </label>
        <label>
          <span>Save to</span>
          <select
            id={scopeId}
            aria-label="Variable scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as VariableScope)}
            aria-describedby="extract-scope-hint"
          >
            {VARIABLE_SCOPES.map((entry) => (
              <option key={entry} value={entry}>{entry === 'user' ? 'Only me' : 'Team'}</option>
            ))}
          </select>
        </label>
        <div className="extract-actions">
          <button className="extract-save" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save variable'}</button>
          <button type="button" className="extract-close" onClick={() => { setOpen(false); setError(null) }}>Close</button>
        </div>
      </form>
      <p className="extract-hint" id="extract-path-hint">
        Read a field from the JSON body (<code>data.token</code>, <code>items[0].id</code>), a header
        (<code>header:location</code>) or <code>status</code>. A whole object or array is stored as JSON, so use it
        unquoted: <code>{'{"state": {{name}}}'}</code>.
      </p>
      <p className="extract-hint" id="extract-scope-hint">
        {scope === 'user'
          ? 'Saved to your account: it follows you to other tabs and machines, and no teammate can see it. It wins over an environment variable of the same name.'
          : 'Saved for everyone in this team. An environment variable of the same name still wins over it, matching how Postman resolves globals.'}
      </p>
      {matching.some((entry) => entry.scope === scope) && (
        <p className="extract-hint">{`{{${name.trim()}}} already exists and will be overwritten.`}</p>
      )}
      {preview && preview.ok && <p className="extract-preview">Current value: <code>{preview.value}</code></p>}
      {preview && !preview.ok && <p className="extract-error" role="alert">{preview.error}</p>}
      {error && <p className="extract-error" role="alert">{error}</p>}
      {saved && (
        <div className="extract-saved-group">
          <p className="extract-saved" role="status">{`Saved as {{${saved}}}. Use it in any request.`}</p>
          {requestKey && (
            <label className="extract-sync" htmlFor={syncId}>
              <input
                id={syncId}
                type="checkbox"
                checked={activeRule !== null}
                onChange={(event) => toggleSync(event.target.checked)}
              />
              <span>{`Sync {{${saved}}} after every response from this request`}</span>
            </label>
          )}
          {activeRule && (
            <p className="extract-hint">
              {`Re-read from "${activeRule.path}" into ${ruleScope(activeRule) === 'user' ? 'your' : 'team'} variables each time this request is sent, so a value the server advances stays current. Only this request's responses update it.`}
            </p>
          )}
        </div>
      )}
      {syncList}
    </div>
  )
}

export function ResponsePanel({ sending, response, onRetryFromServer, requestKey = null }: {
  sending: boolean
  response: RecordedResponse | null
  onRetryFromServer?: () => void
  /** Identifies the request, so a sync rule can be bound to it rather than applied to every response. */
  requestKey?: string | null
}) {
  const [tab, setTab] = useState<ResponseTab>('Body')
  // Raw stays available for reading the body as it was actually sent - the tree normalises key
  // order and whitespace away, and a malformed-looking body is sometimes the thing being diagnosed.
  const [view, setView] = useState<BodyView>('Tree')
  // The tree carries its own copy button, which follows the filter. This one covers the views the
  // tree does not reach at all: the raw text, and a body that is not JSON to begin with.
  const [copiedRaw, setCopiedRaw] = useState<string | null>(null)

  useEffect(() => {
    setTab('Body')
    // Otherwise "Copied" lingers over a response that was never copied.
    setCopiedRaw(null)
  }, [response])

  if (sending) {
    return (
      <section className="response-panel">
        <div className="response-heading"><strong>Response</strong><span className="response-meta">Sending…</span></div>
        <div className="response-empty"><span className="loading-spinner" /><strong>Waiting for a response…</strong></div>
      </section>
    )
  }

  if (!response) {
    return (
      <section className="response-panel">
        <div className="response-heading"><strong>Response</strong><span className="response-meta">Not sent yet</span></div>
        <div className="response-empty">
          <span className="response-symbol">↗</span>
          <strong>Your response will appear here</strong>
          <span>Configure a request, then send it to inspect the result.</span>
        </div>
      </section>
    )
  }

  const { result } = response

  if (result.kind === 'failure') {
    return (
      <section className="response-panel">
        <div className="response-heading"><strong>Response</strong><span className="response-meta">{Math.round(result.durationMs)} ms</span></div>
        <div className="response-empty response-failure">
          <span className="response-symbol">⚠</span>
          <strong>Request failed</strong>
          <span role="alert">{result.message}</span>
          {onRetryFromServer && (
            <button type="button" className="response-retry" onClick={onRetryFromServer}>
              Send from the server instead
            </button>
          )}
        </div>
      </section>
    )
  }

  const contentType = result.headers['content-type']
  const { pretty, isJson, parsed } = formatBody(result.bodyText, contentType)
  const cookieHeader = result.headers['set-cookie']
  const tabs: ResponseTab[] = cookieHeader ? ['Body', 'Headers', 'Cookies'] : ['Body', 'Headers']

  return (
    <section className="response-panel">
      <div className="response-heading">
        <div className="response-status-group">
          <span className={`response-status ${result.ok ? 'ok' : 'error'}`}>{result.status} {result.statusText}</span>
          <span className="response-meta">{Math.round(result.durationMs)} ms</span>
          <span className="response-meta">{formatSize(result.sizeBytes)}</span>
        </div>
      </div>
      <div className="editor-tabs response-tabs" role="tablist" aria-label="Response">
        {tabs.map((entry) => (
          <button key={entry} role="tab" aria-selected={tab === entry} className={tab === entry ? 'editor-tab active' : 'editor-tab'} onClick={() => setTab(entry)}>{entry}</button>
        ))}
        {tab === 'Body' && pretty && (!isJson || view === 'Raw') && (
          <button
            type="button"
            className="response-copy-raw"
            onClick={() => {
              void (navigator.clipboard?.writeText(pretty) ?? Promise.reject(new Error('Clipboard unavailable'))).then(
                () => setCopiedRaw('Copied the response body'),
                () => setCopiedRaw('Could not reach the clipboard, so nothing was copied.'),
              )
            }}
          >
            Copy
          </button>
        )}
        {tab === 'Body' && copiedRaw && <span className="response-copy-note" role="status">{copiedRaw}</span>}
        {tab === 'Body' && isJson && (
          <div className="response-view-toggle" role="group" aria-label="Body view">
            {(['Tree', 'Raw'] as BodyView[]).map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={view === entry}
                className={view === entry ? 'view-toggle active' : 'view-toggle'}
                onClick={() => setView(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
        )}
      </div>
      {response.sentFromServerAfterCorsBlock && (
        <p className="sent-via-server" role="status">
          The browser was blocked by this host's CORS policy, so the request was sent from the API instead
          and this is its answer. It left the API's machine, not yours — a different source address, and
          without any cookies your browser holds for that host.
        </p>
      )}
      {response.syncOutcomes?.filter((outcome) => !outcome.ok).map((outcome) => (
        <p key={outcome.name} className="extract-error" role="alert">
          {`Sync failed for {{${outcome.name}}}: ${outcome.error} The previous value was kept, so it may now be stale.`}
        </p>
      ))}
      {response.syncOutcomes && response.syncOutcomes.some((outcome) => outcome.ok) && (
        <p className="extract-synced" role="status">
          {`Synced ${response.syncOutcomes.filter((o) => o.ok).map((o) => `{{${o.name}}}`).join(', ')} from this response.`}
        </p>
      )}
      <ExtractToVariable response={result} requestKey={requestKey} />
      <div className="response-body">
        {tab === 'Body' && (
          pretty
            ? isJson && view === 'Tree'
              ? <JsonTree value={parsed} />
              : <pre className={isJson ? 'response-json' : 'response-text'}>{pretty}</pre>
            : <div className="response-empty"><span>Empty response body.</span></div>
        )}
        {tab === 'Headers' && (
          <table className="response-headers">
            <tbody>
              {Object.entries(result.headers).map(([key, value]) => (
                <tr key={key}><td>{key}</td><td>{value}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'Cookies' && <pre className="response-text">{cookieHeader}</pre>}
      </div>
    </section>
  )
}
