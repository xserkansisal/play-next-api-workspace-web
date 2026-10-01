# Variables menu: per-user ordering — backend requirements

The Variables menu now supports two kinds of ordering:

- **Column sort:** click the **Key** or **Value** header. The cycle is ascending → descending →
  manual order.
- **Manual order:** drag a row by its grip handle; use the **⋮** menu (Move to top / up / down /
  to bottom); or focus the handle and press ↑ ↓ Home End.

The choice is a **per-user preference**. The web client already stores it in `localStorage`
(keyed by user id) and syncs it to the API when the endpoints below exist. Until they are
deployed, the client gets a `404`, switches to local-only quietly, and everything still works on
that browser.

Code: `src/lib/variable-order.ts` (model and ordering), `src/lib/variable-order-storage.ts`
(sync), `src/components/VariablesMenu.tsx` (UI).

---

## 1. Data model

One document per user:

```jsonc
{
  "version": 1,
  // null = manual order. Otherwise one sort applies to every group.
  "sort": { "field": "key" | "value", "direction": "asc" | "desc" } | null,
  "manual": {
    "user":   ["token", "baseUrl"],          // "Only me" group
    "global": ["tenant"],                    // "Everyone" group
    "environments": {                        // "Environment" group, per environment id
      "env-uuid-1": ["host", "port"]
    }
  },
  "updatedAt": "2026-10-01T11:20:00.000Z"    // set by the client, see §3
}
```

Notes for the backend:

- Lists hold **variable names only**, not ids. Names that no longer exist are ignored by the
  client, and names missing from a list are appended in key order. The server does **not** need
  to keep lists consistent with variables, and must not prune them. A variable that comes back
  should return to its old position.
- The server should treat the document as **opaque JSON** after validation. This lets the client
  add fields later without an API change.
- The client stores and sends `updatedAt` itself (see §3). The server should store it as given and
  return it unchanged.

### Suggested storage

```sql
CREATE TABLE user_preferences (
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text        NOT NULL,          -- 'variable-order'
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);
```

A generic `(user_id, name) → jsonb` table also covers future per-user UI preferences, such as the
runner choice and sidebar width that live in `localStorage` today.

---

## 2. Endpoints

Base path is the existing `/api/v1`. Both endpoints act on the **signed-in user only**: the user id
comes from the session, never from the request.

### `GET /preferences/variable-order`

| Case | Response |
|---|---|
| Saved | `200 { "preferences": { ...document } }` |
| Never saved | `200 { "preferences": null }` |
| Not signed in | `401` (existing behaviour) |

> **Important:** "never saved" must be `200` with `null`, **not** `404`. The client reads `404` as
> "this endpoint is not deployed" and stops syncing for the rest of the session.

### `PUT /preferences/variable-order`

Request body:

```json
{ "preferences": { "version": 1, "sort": null, "manual": { ... }, "updatedAt": "..." } }
```

Response: `200 { "preferences": { ...stored document } }`. Upsert (create on first save).

The client debounces writes (about 400 ms), so dragging a row costs a single request.

### Validation (reject with `400`, standard error body)

- `version` is `1`
- `sort` is `null`, or an object with `field ∈ {key, value}` and `direction ∈ {asc, desc}`
- `manual.user`, `manual.global`: arrays of strings
- `manual.environments`: object whose values are arrays of strings
- Limits, to protect storage:
  - at most **1,000** names per list
  - at most **200** environment entries
  - each name at most **256** characters
  - whole body at most **256 KB** (`413` above that)
- Unknown extra fields: accept and store them, for forward compatibility

Environment ids in `manual.environments` do **not** need to exist. A deleted environment's entry is
harmless. Optionally remove it when an environment is permanently purged (not when it is moved to
trash, because a restore should keep the order).

Error body (same shape as the rest of the API):

```json
{ "error": { "code": "PREFERENCES_INVALID", "message": "sort.field must be \"key\" or \"value\"." } }
```

---

## 3. Conflict handling (multiple tabs and devices)

This is last-write-wins, decided by the client's `updatedAt`:

- On load, the client compares its local copy with the server copy. The **newer** one wins. If the
  local copy is newer (for example, it was changed while offline, or the tab closed before the
  debounced write), the client `PUT`s it.
- The server needs no conflict logic for this. It must simply **store and return `updatedAt`
  exactly as sent**.

Optional hardening: reject a `PUT` whose `updatedAt` is older than the stored one with
`409 PREFERENCES_STALE`. The client already ignores write failures (the local copy keeps the
order), so this is safe to add later.

### Optional: live sync between tabs and devices

If the change stream should push order changes, emit an event on the existing SSE stream **only
to the same user's connections**:

```json
{ "kind": "preferences", "name": "variable-order" }
```

Client follow-up (not implemented yet): call `loadVariableOrder(user.id)` on that event, the same
way `kind: "variable"` triggers `loadScopedVariables()`. Without this, other tabs pick up the order
on their next load.

---

## 4. Security

- Read and write only the session user's row. There is no `userId` parameter anywhere.
- Lists contain variable **names**, never values, so no secrets are stored here.
- Apply the size limits in §2 so a client cannot use preferences as unbounded storage.
- Delete the row with the user (`ON DELETE CASCADE`).

---

## 5. Checklist

- [ ] `user_preferences` table (or equivalent) keyed by `(user_id, name)`
- [ ] `GET /preferences/variable-order` → `200 { preferences | null }` (never `404` for "not saved")
- [ ] `PUT /preferences/variable-order` → upsert, returns the stored document
- [ ] Validation and size limits (`400` / `413`), unknown fields kept
- [ ] `updatedAt` stored and returned exactly as the client sent it
- [ ] Scoped to the session user; cascade delete with the user
- [ ] (Optional) `409 PREFERENCES_STALE` for older `updatedAt`
- [ ] (Optional) SSE `{ kind: "preferences", name: "variable-order" }` to the same user's sessions
- [ ] (Optional) Drop `manual.environments[id]` when an environment is permanently purged
