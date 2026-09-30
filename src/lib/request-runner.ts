// Request-execution abstraction.
//
// Two runners exist. The browser runner sends the request with `fetch` from the page, which is
// what you want by default. The server runner asks the API to send it instead, because a page can
// never reach a server that does not send CORS headers - that is a restriction the browser places
// on the page, not a property of the request, which is why the same call works from curl.
//
// The server runner is not a better default. It is off unless an operator allow-lists the target
// host on the API, it cannot reach anything only the browser can see, and it makes the request
// come from the API's network position rather than the user's.

import { isAxiosError } from 'axios'

import { apiClient, type ProxySettings } from '@/lib/api'
import type { SyncOutcome } from '@/lib/sync-rules'

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
  /**
   * Set only when a no-cors probe *confirmed* the host answered, so the UI may offer sending from
   * the server as a recovery. An unconfirmed failure deliberately leaves this unset: suggesting a
   * fix for a diagnosis that was never established is how a user ends up chasing the wrong cause.
   */
  corsBlocked?: boolean
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure

export interface RecordedResponse {
  result: ExecutionResult
  sentAt: string
  /** The fully-resolved URL that was actually sent, so a failure can be reasoned about without re-deriving it from a draft the user may since have edited. */
  url?: string
  /** What each sync rule bound to this request did with this response. Carried here so a failed sync is visible next to the response that caused it. */
  syncOutcomes?: SyncOutcome[]
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
      const reachability = await probeReachability(request)
      return {
        kind: 'failure',
        durationMs,
        corsBlocked: reachability === 'reachable',
        message: describeFetchFailure(error, reachability, request.url),
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
      'are not bound by CORS. Either enable CORS on that server for this origin, or switch "Send from" to ' +
      'Server so the API sends the request instead, which needs that host to be allow-listed on the API. ' +
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

/**
 * Runs the request from the API instead of the page, for targets the browser cannot reach.
 *
 * The API returns the target's status inside its own 200 response, so an upstream 404 arrives here
 * as a completed execution rather than an error. Only a failure of the proxy itself - it being
 * disabled, the host not being allow-listed, the target being unreachable - surfaces as a failure.
 */
export const serverProxyRunner: RequestRunner = {
  id: 'server',
  async run(request) {
    const started = performance.now()
    try {
      const { data } = await apiClient.post<ProxyResponse>('/proxy', {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
      }, { timeout: PROXY_CLIENT_TIMEOUT_MS })
      return {
        kind: 'success',
        status: data.status,
        statusText: data.statusText,
        ok: data.status >= 200 && data.status < 300,
        // Prefer the API's measurement: it timed the actual upstream call, without the round trip
        // to the API itself.
        durationMs: data.durationMs ?? performance.now() - started,
        sizeBytes: data.sizeBytes ?? null,
        headers: data.headers ?? {},
        bodyText: data.truncated
          ? `${data.bodyText}\n\n[Truncated: the response exceeded the API's PROXY_MAX_RESPONSE_BYTES limit, so this body is incomplete.]`
          : data.bodyText,
      }
    } catch (error) {
      return {
        kind: 'failure',
        durationMs: performance.now() - started,
        message: describeProxyFailure(error),
      }
    }
  },
}

interface ProxyResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
  durationMs: number
  sizeBytes: number
  truncated: boolean
}

/** Longer than the default API timeout, because the proxy waits on a third-party server. */
const PROXY_CLIENT_TIMEOUT_MS = 65_000

export function describeProxyFailure(error: unknown): string {
  if (isAxiosError<{ error?: { code?: string; message?: string } }>(error)) {
    const apiError = error.response?.data?.error
    if (apiError?.code === 'PROXY_DISABLED') {
      return 'Sending from the server is switched off on the API. An operator has to list the hosts it may ' +
        'reach in PROXY_ALLOWED_HOSTS and restart it. Until then, only targets that send CORS headers are reachable.'
    }
    if (apiError?.code === 'PROXY_HOST_NOT_ALLOWED') {
      return `${apiError.message} Sending from the browser will not work either if that server does not send CORS headers.`
    }
    if (apiError?.message) return `${apiError.message}${apiError.code ? ` (${apiError.code})` : ''}`
    if (error.response) return `The API responded with ${error.response.status} while running this request.`
    return `The API could not be reached to run this request (${error.message}).`
  }
  return error instanceof Error ? error.message : 'Unknown error'
}

export const runners = { browser: browserFetchRunner, server: serverProxyRunner } as const
export type RunnerId = keyof typeof runners

/** Where a request is sent from by default. The browser is the honest default: it needs no operator setup. */
export const defaultRunnerId: RunnerId = 'browser'

export function runnerFor(id: RunnerId): RequestRunner {
  return runners[id]
}

export function isRunnerId(value: string): value is RunnerId {
  return Object.hasOwn(runners, value)
}

/**
 * Whether sending this request from the server would actually be allowed, so the UI can offer that
 * as a recovery only when it is certain to be available. Matching mirrors the API's allow-list
 * rules exactly - an entry is either `host` (any port) or `host:port`, compared literally - because
 * offering a retry the API will refuse is worse than offering nothing.
 */
export function canProxy(url: string, proxy: ProxySettings | null): boolean {
  if (!proxy?.enabled) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const hostname = parsed.hostname.toLowerCase()
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  return proxy.allowedHosts.some((entry) => entry === hostname || entry === `${hostname}:${port}`)
}
