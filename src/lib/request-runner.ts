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
 * Runs a request directly from the browser via `fetch`. A request to an origin that does not send
 * permissive CORS headers fails with an opaque `TypeError` that is identical to the one a dead
 * host produces — the Fetch API deliberately does not expose *why*.
 *
 * The two can still be told apart, by retrying once with `mode: 'no-cors'`. That mode skips the
 * CORS check and resolves with an unreadable "opaque" response whenever the server actually
 * answered, so a resolved probe means the host is up and CORS is the blocker, while a rejected
 * probe means the host could not be reached at all. The probe result is only ever used to explain
 * the failure; the opaque response itself is unreadable and is never shown as the response.
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
        message: describeFetchFailure(error, await probeReachability(request), request.url),
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

export type Reachability = 'reachable' | 'unreachable' | 'unknown'

/**
 * Asks whether the host answered at all, using `mode: 'no-cors'` so the CORS check is skipped.
 *
 * This deliberately sends a bodyless GET to the origin *root* rather than replaying the user's
 * request: replaying it would run a side-effecting POST a second time, and the answer would be no
 * better, because any HTTP reply at all — even 404 or 405 — already proves the host is up, which
 * is the only thing being measured. Only a genuine connection failure rejects.
 */
async function probeReachability(request: PreparedRequest): Promise<Reachability> {
  let origin: string
  try {
    origin = new URL(request.url).origin
  } catch {
    return 'unknown'
  }
  try {
    // `no-cors` permits only simple headers, so none are forwarded; a rejected non-simple header
    // would look like unreachability and produce a confidently wrong diagnosis.
    await fetch(origin, { method: 'GET', mode: 'no-cors', redirect: 'follow' })
    return 'reachable'
  } catch {
    return 'unreachable'
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'that origin'
  }
}

export function describeFetchFailure(error: unknown, reachability: Reachability, url = ''): string {
  const detail = error instanceof Error ? error.message : String(error)
  const origin = originOf(url)

  if (reachability === 'reachable') {
    return `The server answered, but the browser blocked the response: ${origin} did not send an ` +
      '"Access-Control-Allow-Origin" header permitting this app\'s origin. This is a CORS restriction in the ' +
      'browser, not a failure of the request itself — the same request succeeds from curl or Postman, which ' +
      'are not bound by CORS. Enable CORS on that server for this origin. ' +
      `(Confirmed by a no-cors probe that reached the server; raw error: ${detail}.)`
  }
  if (reachability === 'unreachable') {
    return `The browser could not reach ${origin} at all — nothing answered (server down, wrong host or port, ` +
      `DNS failure, or offline). This is not a CORS problem: a no-cors probe, which ignores CORS entirely, also ` +
      `failed to connect. (Raw error: ${detail}.)`
  }
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
