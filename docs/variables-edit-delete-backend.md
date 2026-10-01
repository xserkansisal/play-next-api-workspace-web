# Variables menu: edit and delete — backend requirements

The Variables menu in the top bar now has **Edit** (key and value, inline) and **Delete** (with a
confirmation) for every variable, in all three scopes. This document lists what the API must
provide for that to work, what already exists, and what is recommended to make it safe.

## Summary

| Scope | Edit value | Rename key | Delete | Status |
|---|---|---|---|---|
| Only me (`user`) | `PUT /variables/user/:key` | `PUT` new key + `DELETE` old key | `DELETE /variables/user/:key` | Works with the current endpoints |
| Everyone (`global`) | `PUT /variables/global/:key` | `PUT` new key + `DELETE` old key | `DELETE /variables/global/:key` | Works with the current endpoints, **needs an authorization decision** |
| Environment | `GET /environments/:id` + `PUT /environments/:id` (whole document) | same | same | Works with the current endpoints, **at risk of lost updates** |

---

## 1. Scoped variables (`user`, `global`) — existing endpoints

The frontend uses these as they are (`src/lib/api.ts`).

### `PUT /variables/:scope/:key`

- `scope`: `user` | `global`
- `key`: URL-encoded (the client calls `encodeURIComponent`). The server must decode it and must
  not treat `/` or other reserved characters in the key as route separators.
- Body: `{ "value": string }`
- Response `200`: `{ "scope", "key", "value", "updatedAt"?, "updatedBy"? }`
- Must create the variable if it does not exist (upsert). A rename depends on this, because it
  writes the new key.

### `DELETE /variables/:scope/:key`

- Response `204` (any 2xx is accepted).
- For a missing key, return either `404` or an idempotent `204`. On `404` the UI puts the row back
  and shows the error.

### Key validation (server must enforce)

Use the same rule the client checks in `validateVariableName`:

- trimmed, non-empty
- no `{` or `}`
- no whitespace

On violation, return `400` with the standard error body (see §4).

### Authorization

- `user` scope: only the signed-in user's own variables. A user can never read, edit or delete
  another user's `user`-scope variables.
- `global` scope: today anyone signed in can edit and delete. **Decision needed:** should this be
  restricted, for example to admins or to the variable's creator? If so, return `403` with a clear
  `message`. The UI already shows it, so no UI change is needed.

### Rename (recommended, optional)

Today a rename is two calls: `PUT` the new key, then `DELETE` the old key. If the second call
fails, both names exist, and the UI tells the user so. To make the rename atomic, add:

```
PATCH /variables/:scope/:key
Body: { "key"?: string, "value"?: string }
200 → ScopedVariable
409 → the new key already exists in that scope
404 → the old key was not found
```

If you add it, only one client function changes: `updateScopedVariable` in
`src/lib/scoped-variables.ts`.

### Change events

If other tabs and other users should see variable changes live, emit an event on the SSE change
stream for every variable `PUT`/`DELETE`, especially for `global`. Otherwise others only see the
change after a reload.

---

## 2. Environment variables — current approach and its risk

The API has no endpoint for a single environment variable. For now the client does this
(`mutateSelectedEnvironmentVariables` in `src/App.tsx`, helpers in `src/lib/variable-editing.ts`):

1. Refuse if the environment is open in an editor tab with unsaved changes.
2. `GET /environments/:id` to get the latest copy.
3. Apply the edit to the effective row: the **last enabled** row with that key. Other enabled rows
   with the same key are removed, because they were already shadowed. Disabled rows are not
   changed.
4. `PUT /environments/:id` with `{ name, variables }` (the whole list).

**Risk:** this reads, changes and writes the whole document with no concurrency check. If a
teammate saves the same environment between steps 2 and 4, their change is overwritten without
any warning.

### Recommended: optimistic concurrency on `PUT /environments/:id`

Pick one:

- **ETag / `If-Match`:** return an `ETag` on `GET /environments/:id` and accept `If-Match` on
  `PUT`. Return `412 Precondition Failed` when they do not match.
- **Version field:** send `updatedAt` (already in the model) or a `version` in the `PUT` body.
  Return `409 Conflict` when it does not match the stored value.

This also protects the existing environment editor tab, which has the same problem.

### Recommended: per-variable endpoints (better long term)

```
PUT    /environments/:id/variables/:key   Body: { "value": string, "enabled"?: boolean, "newKey"?: string }
DELETE /environments/:id/variables/:key
```

Semantics, matching what the UI shows:

- Act on the **effective** row: the last enabled row with that key.
- On rename, return `409` if another enabled row already has `newKey`.
- On delete, remove every enabled row with that key and leave disabled rows alone.
- Return `404` if no enabled row has that key.
- Return the updated `EnvironmentResource`, so the client can replace its copy.
- Emit the usual environment change event, so open tabs and other users are updated.

With these endpoints in place, only `mutateSelectedEnvironmentVariables` in `src/App.tsx` would
change.

### Authorization

Environments are shared team documents. Anyone who may `PUT /environments/:id` today may also edit
or delete their variables from the menu. If that should be narrower, enforce it on the server with
`403`.

---

## 3. Status codes the UI handles

| Code | When | UI behaviour |
|---|---|---|
| 2xx | success | Row updates; edit mode closes |
| 400 | invalid key or value | Message shown in the menu; edit mode stays open |
| 403 | not allowed (for example editing globals) | Message shown; change rolled back |
| 404 | key or environment no longer exists | Message shown; change rolled back |
| 409 / 412 | conflict (rename target exists, stale environment) | Message shown; user can retry |
| 5xx / network | — | Message shown; change rolled back |

## 4. Error body

Same shape as today. `describeApiError` reads it:

```json
{ "error": { "code": "VARIABLE_KEY_EXISTS", "message": "\"authToken\" already exists in this scope." } }
```

The UI shows `message (code)` exactly as sent, so write `message` for end users.

Suggested codes: `VARIABLE_NOT_FOUND`, `VARIABLE_KEY_EXISTS`, `VARIABLE_KEY_INVALID`,
`FORBIDDEN`, `ENVIRONMENT_CONFLICT`.

## 5. Checklist

- [ ] `PUT /variables/:scope/:key` upserts and decodes URL-encoded keys
- [ ] `DELETE /variables/:scope/:key` exists (`404` or idempotent `204`)
- [ ] Key validation on the server (non-empty, no braces, no whitespace)
- [ ] `user` scope is isolated per account
- [ ] Decision and enforcement for who may edit and delete `global` variables
- [ ] Concurrency check on `PUT /environments/:id` (`If-Match` → `412`, or version → `409`)
- [ ] (Optional) `PATCH /variables/:scope/:key` for atomic rename
- [ ] (Optional) `PUT`/`DELETE /environments/:id/variables/:key`
- [ ] Change events for variable and environment writes
