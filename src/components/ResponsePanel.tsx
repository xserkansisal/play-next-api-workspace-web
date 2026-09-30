import { useEffect, useId, useMemo, useState } from 'react'

import { extractFromResponse, suggestPaths } from '@/lib/response-extraction'
import { setRuntimeVariable, validateVariableName } from '@/lib/runtime-variables'
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

function ExtractToVariable({ response }: { response: ExecutionSuccess }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const listId = useId()

  useEffect(() => {
    setError(null)
    setSaved(null)
  }, [response])

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
    setError(null)
    setSaved(validated.name)
  }

  if (!open) {
    return (
      <div className="extract-bar">
        <button className="link-button" onClick={() => setOpen(true)}>Save a value as a variable</button>
        {saved && <span className="extract-saved" role="status">{`Saved as {{${saved}}}`}</span>}
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
        (<code>header:location</code>) or <code>status</code>. Saved variables are used as <code>{'{{name}}'}</code> in
        any request, stay in this browser tab only, and are never saved to the server.
      </p>
      {preview && preview.ok && <p className="extract-preview">Current value: <code>{preview.value}</code></p>}
      {preview && !preview.ok && <p className="extract-error" role="alert">{preview.error}</p>}
      {error && <p className="extract-error" role="alert">{error}</p>}
      {saved && <p className="extract-saved" role="status">{`Saved as {{${saved}}}. Use it in any request.`}</p>}
    </div>
  )
}

export function ResponsePanel({ sending, response }: { sending: boolean; response: RecordedResponse | null }) {
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
      <ExtractToVariable response={result} />
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
