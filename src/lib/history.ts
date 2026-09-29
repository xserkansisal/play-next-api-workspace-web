// Per-browser history of sent requests, kept in `localStorage` — separate
// from team-shared collections (which live on the API). Nothing here is
// synced to the server.
//
// Decisions (reported to the user):
// - Capped at the most recent 50 entries (oldest evicted first) to bound
//   storage growth; this is a local debugging aid, not an audit log.
// - Request/response bodies are stored only as previews truncated to 1000
//   characters each, never in full, since a user could type or receive an
//   arbitrarily large payload.
// - Headers are NOT stored, since a header could carry a credential/token a
//   user pasted in manually, and there is little debugging value in
//   persisting that indefinitely in localStorage.

const STORAGE_KEY = 'play-next-api-workspace.history.v1'
const MAX_ENTRIES = 50
const PREVIEW_LIMIT = 1000

export interface HistoryEntry {
  id: string
  sentAt: string
  method: string
  url: string
  requestName?: string
  requestBodyPreview?: string
  status?: number
  statusText?: string
  durationMs?: number
  sizeBytes?: number | null
  failure?: string
  responseBodyPreview?: string
}

function truncate(text: string | null | undefined): string | undefined {
  if (!text) return undefined
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupt or inaccessible storage (private browsing, quota, etc.) — history is best-effort.
    return []
  }
}

export function appendHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'requestBodyPreview' | 'responseBodyPreview'> & {
  requestBody?: string | null
  responseBody?: string | null
}): HistoryEntry[] {
  const { requestBody, responseBody, ...rest } = entry
  const full: HistoryEntry = {
    ...rest,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    requestBodyPreview: truncate(requestBody),
    responseBodyPreview: truncate(responseBody),
  }
  const next = [full, ...loadHistory()].slice(0, MAX_ENTRIES)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // If storage is full/unavailable, keep the in-memory result but don't crash the send flow.
  }
  return next
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
