import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'

import { extractFromResponse, suggestPaths } from '@/lib/response-extraction'
import { setRuntimeVariable, validateVariableName } from '@/lib/runtime-variables'
import { findSyncRule, getSyncRules, removeSyncRule, setSyncRule, subscribeSyncRules } from '@/lib/sync-rules'
import type { ExecutionSuccess, RecordedResponse } from '@/lib/request-runner'

type ResponseTab = 'Body' | 'Headers' | 'Cookies'

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatBody(text: string, contentType: string | undefined): { pretty: string; isJson: boolean } {
  const looksJson = (contentType ?? '').includes('json') || /^[\s]*[[{]/.test(text)
  if (looksJson) {
    try {
      return { pretty: JSON.stringify(JSON.parse(text), null, 2), isJson: true }
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
  const listId = useId()
  const syncId = useId()

  const rules = useSyncExternalStore(subscribeSyncRules, getSyncRules)
  // The rule shown is the one for the variable just saved: sync is offered as a follow-up to a
  // successful save, so there is always a concrete variable to talk about.
  const activeRule = saved && requestKey ? rules.find((rule) => rule.requestKey === requestKey && rule.name === saved) ?? null : null

  const toggleSync = useCallback((enabled: boolean) => {
    if (!saved || !requestKey) return
    if (enabled) setSyncRule({ requestKey, name: saved, path: path.trim() })
    else removeSyncRule(requestKey, saved)
  }, [saved, requestKey, path])

  useEffect(() => {
    setError(null)
    // A one-off capture is finished once the next response arrives, so its confirmation is cleared.
    // A synced variable is not: it was just written again, and hiding its control after every send
    // would make sync impossible to turn back off.
    setSaved((current) => (current && requestKey && findSyncRule(requestKey, current) ? current : null))
  }, [response, requestKey])

  const suggestions = useMemo(() => (open ? suggestPaths(response) : []), [open, response])
  const preview = useMemo(() => (path.trim() ? extractFromResponse(path, response) : null), [path, response])

  function save() {
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
    setRuntimeVariable(validated.name, extracted.value)
    // An existing rule for this name must follow the path just saved, or sync would keep writing
    // the old path while the confirmation shows the new one.
    if (requestKey && findSyncRule(requestKey, validated.name)) {
      setSyncRule({ requestKey, name: validated.name, path: path.trim() })
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
      <div className="extract-fields">
        <label>
          <span>Variable name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="token" aria-label="Variable name" />
        </label>
        <label>
          <span>Value path</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="data.token"
            aria-label="Value path"
            list={listId}
          />
          <datalist id={listId}>
            {suggestions.map((entry) => <option key={entry} value={entry} />)}
          </datalist>
        </label>
        <button onClick={save}>Save variable</button>
        <button className="link-button" onClick={() => { setOpen(false); setError(null) }}>Close</button>
      </div>
      <p className="extract-hint">
        Read a field from the JSON body (<code>data.token</code>, <code>items[0].id</code>), a header
        (<code>header:location</code>) or <code>status</code>. A whole object or array is stored as JSON, so use it
        unquoted: <code>{'{"state": {{name}}}'}</code>. Saved variables stay in this browser tab only, and are never
        saved to the server.
      </p>
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
              {`Re-read from "${activeRule.path}" each time this request is sent, so a value the server advances stays current. Only this request's responses update it.`}
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

  useEffect(() => {
    setTab('Body')
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
  const { pretty, isJson } = formatBody(result.bodyText, contentType)
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
      </div>
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
            ? <pre className={isJson ? 'response-json' : 'response-text'}>{pretty}</pre>
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
