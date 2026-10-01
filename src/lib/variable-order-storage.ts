// The signed-in user's Variables-menu order, mirrored here so React can read it synchronously.
//
// Decisions:
// - The preference belongs to the user, not the tab or the machine, so the API is the source of
//   truth. It is *also* written to `localStorage` under the user's id, because the order must not
//   flicker back to the default on every load while the request is in flight, and because the
//   API endpoint may not be deployed yet. A 404 from it switches this tab to local-only quietly.
// - Every change is stamped with `updatedAt` on the client. On load, whichever copy is newer wins
//   and a newer local copy is pushed up, so a change made while the API was unreachable (or still
//   waiting in the debounce when the tab closed) is not lost.
// - Writes are debounced: dragging a row through a list should cost one request, not one per step.
//   A failed write is not surfaced; the order is a convenience, and the local copy keeps it.

import { isAxiosError } from 'axios'

import { workspaceApi } from '@/lib/api'
import { DEFAULT_VARIABLE_ORDER, normalizeVariableOrder, type VariableOrderPreferences } from '@/lib/variable-order'

const STORAGE_PREFIX = 'play-next-api-workspace.variable-order.v1'
const SAVE_DELAY_MS = 400

let state: VariableOrderPreferences = DEFAULT_VARIABLE_ORDER
let owner = ''
let generation = 0
let serverAvailable = true
let pending: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function publish(next: VariableOrderPreferences) {
  state = next
  for (const listener of listeners) listener()
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId || 'anonymous'}`
}

function readLocal(userId: string): VariableOrderPreferences {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    return raw ? normalizeVariableOrder(JSON.parse(raw)) : DEFAULT_VARIABLE_ORDER
  } catch {
    return DEFAULT_VARIABLE_ORDER
  }
}

function writeLocal(userId: string, preferences: VariableOrderPreferences) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(preferences))
  } catch {
    // Storage full or blocked: the in-memory copy and the API still hold it.
  }
}

function isNotFound(error: unknown) {
  return isAxiosError(error) && error.response?.status === 404
}

function newer(a: VariableOrderPreferences, b: VariableOrderPreferences) {
  return !!a.updatedAt && (!b.updatedAt || a.updatedAt > b.updatedAt)
}

export function getVariableOrder(): VariableOrderPreferences {
  return state
}

export function subscribeVariableOrder(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function loadVariableOrder(userId = ''): Promise<void> {
  const current = ++generation
  if (pending) clearTimeout(pending)
  pending = null
  owner = userId
  serverAvailable = true
  const local = readLocal(userId)
  publish(local)
  try {
    const raw = await workspaceApi.variableOrderPreferences()
    if (current !== generation) return
    if (raw === null) {
      if (local.updatedAt) void pushToServer(local, current)
      return
    }
    const remote = normalizeVariableOrder(raw)
    if (newer(local, remote)) {
      void pushToServer(local, current)
      return
    }
    // Something may have been changed while the request was in flight; that change is newer.
    if (state !== local && newer(state, remote)) return
    writeLocal(userId, remote)
    publish(remote)
  } catch (error) {
    if (current === generation && isNotFound(error)) serverAvailable = false
  }
}

async function pushToServer(preferences: VariableOrderPreferences, forGeneration: number) {
  if (!serverAvailable) return
  try {
    await workspaceApi.saveVariableOrderPreferences(preferences)
  } catch (error) {
    if (forGeneration === generation && isNotFound(error)) serverAvailable = false
  }
}

export function saveVariableOrder(next: VariableOrderPreferences): void {
  const stamped: VariableOrderPreferences = { ...next, updatedAt: new Date().toISOString() }
  publish(stamped)
  writeLocal(owner, stamped)
  if (!serverAvailable) return
  if (pending) clearTimeout(pending)
  const forGeneration = generation
  pending = setTimeout(() => {
    pending = null
    void pushToServer(state, forGeneration)
  }, SAVE_DELAY_MS)
}

/** Test-only. */
export function resetVariableOrder(): void {
  if (pending) clearTimeout(pending)
  pending = null
  generation += 1
  owner = ''
  serverAvailable = true
  publish(DEFAULT_VARIABLE_ORDER)
}
