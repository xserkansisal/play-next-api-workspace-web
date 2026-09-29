// Request-execution abstraction.
//
// Only a browser (fetch-based) runner is implemented today. A server-side
// runner (executing the request from the API instead of the browser, useful
// for requests the browser cannot reach directly, e.g. servers without CORS
// headers) is a deliberately deferred future addition. Keep this interface
// as the only thing callers depend on so a server runner can be added later
// without reworking `App.tsx` or `ResourceEditor`.

export interface PreparedRequest {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
}

export interface ExecutionSuccess {
  kind: 'success'
  status: number
  statusText: string
  ok: boolean
  durationMs: number
  sizeBytes: number | null
  headers: Record<string, string>
  bodyText: string
}

export interface ExecutionFailure {
  kind: 'failure'
  message: string
  durationMs: number
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure

export interface RecordedResponse {
  result: ExecutionResult
  sentAt: string
}


export interface RequestRunner {
  id: string
  run(request: PreparedRequest): Promise<ExecutionResult>
}

/**
 * Runs a request directly from the browser via `fetch`. Requests to origins
 * that do not send permissive CORS headers will fail with an opaque
 * `TypeError` — the Fetch API deliberately does not expose *why* a request
 * failed (CORS denial and network/DNS/reachability failures are
 * indistinguishable from JavaScript), so failure messages here must not
 * claim a specific cause.
 */
export const browserFetchRunner: RequestRunner = {
  id: 'browser',
  async run(request) {
    const started = performance.now()
    let response: Response
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })
    } catch (error) {
      const durationMs = performance.now() - started
      return {
        kind: 'failure',
        durationMs,
        message: describeFetchFailure(error),
      }
    }
    const durationMs = performance.now() - started
    const bodyText = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    const contentLength = response.headers.get('content-length')
    const sizeBytes = contentLength ? Number(contentLength) : new TextEncoder().encode(bodyText).length
    return {
      kind: 'success',
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      durationMs,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      headers,
      bodyText,
    }
  },
}

function describeFetchFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `The browser could not complete this request (${detail}). This usually means the server did not send ` +
    'CORS headers allowing this origin, or the server is unreachable (down, wrong URL/port, DNS failure, offline) — ' +
    'the browser does not tell scripts which of these it is, so this is not a confirmed diagnosis.'
}

// Only the browser runner is currently registered. A future server runner
// would be added here (e.g. `runners.server = serverRunner`) alongside a way
// for the caller to pick one; until then this is the only implementation and
// the only one enabled.
export const runners = { browser: browserFetchRunner } as const
export type RunnerId = keyof typeof runners
export const activeRunner: RequestRunner = runners.browser
