# Variables menu: adding variables — backend requirements

Each group in the Variables menu (**Only me**, **Environment**, **Everyone**) now has a **+**
button in its header. It opens an inline row with key and value inputs: ✓ or Enter adds the
variable, ✕ or Esc cancels. Empty groups stay visible so you can add to them. The Environment
group's **+** is disabled while no environment is selected.

The web client works with the **current API**. This document lists what the backend must
guarantee, and the changes needed to make "add" safe when several users act at once.

Code: `addScopedVariable` (`src/lib/scoped-variables.ts`), `addEnvironmentVariable`
(`src/lib/variable-editing.ts`), `mutateSelectedEnvironmentVariables` (`src/App.tsx`), UI in
`src/components/VariablesMenu.tsx`.

---

## 1. How the client adds today

| Scope | Calls | Duplicate check |
|---|---|---|
| Only me (`user`) | `PUT /variables/user/:key` `{ value }` | Client only, against its local copy |
| Everyone (`global`) | `PUT /variables/global/:key` `{ value }` | Client only, against its local copy |
| Environment | `GET /environments/:id` then `PUT /environments/:id` with the row appended | Client checks the freshly fetched copy |

The client validates the key before sending (trimmed, non-empty, no `{` `}`, no whitespace). The
value may be empty.

### The gap

`PUT /variables/:scope/:key` is an **upsert**. If two people add the same global name at about the
same time, or a user adds a name that another tab created a moment ago, the second write
**silently overwrites** the first. The client-side check cannot catch this, because its copy may
be stale.

For environments, the same read-modify-write race described in
`docs/variables-edit-delete-backend.md` §2 applies.

---

## 2. Required: create-only semantics for scoped variables

Pick **one**. Both let the client tell "add" apart from "edit".

### Option A (recommended): `POST` for create

```
POST /variables/:scope
Body: { "key": string, "value": string }

201 → ScopedVariable   { scope, key, value, updatedAt, updatedBy }
409 → { "error": { "code": "VARIABLE_KEY_EXISTS", "message": "\"token\" already exists in Everyone." } }
400 → invalid key or value
403 → not allowed to create in this scope (see §4)
```

### Option B: conditional `PUT`

Support `If-None-Match: *` on `PUT /variables/:scope/:key`. If the key exists, return
`412 Precondition Failed` (or `409`) with the error body above. Without the header, keep today's
upsert behaviour.

The check and the insert must be **atomic**, for example a unique constraint on
`(scope, owner_id_or_null, key)` plus `INSERT … ON CONFLICT DO NOTHING`, rather than "select, then
insert".

**Client change once deployed:** a single call in `addScopedVariable`. The client already shows
`409`/`412` messages as is.

---

## 3. Recommended: environment variable create endpoint

```
POST /environments/:id/variables
Body: { "key": string, "value": string, "enabled"?: boolean }   // enabled defaults to true

201 → EnvironmentResource (the full updated document)
409 → VARIABLE_KEY_EXISTS (an enabled row already has this key)
404 → environment not found or in trash
```

Rules, matching the client today:

- Append to the end of the list.
- Only an **enabled** row with the same key is a conflict. A disabled row with the same key is
  allowed, as the environment editor already allows it.
- Emit the usual environment change event, so open editor tabs and other users are updated.

Until this endpoint exists, an optimistic-concurrency check on `PUT /environments/:id`
(`If-Match` → `412`, or version → `409`; see the edit/delete doc) is enough to stop lost updates.

---

## 4. Validation and limits (server must enforce)

| Field | Rule | Error |
|---|---|---|
| `key` | trimmed, 1–256 chars, no `{` `}`, no whitespace | `400 VARIABLE_KEY_INVALID` |
| `value` | string, may be empty, at most 64 KB | `400 VARIABLE_VALUE_INVALID` / `413` |
| per-scope count | for example at most 500 variables per user, 1,000 global, 1,000 rows per environment | `422 VARIABLE_LIMIT_REACHED` |

Keys are case-sensitive: `Token` and `token` are different keys, and the client treats them that
way.

### Authorization

- `user`: always the session user. The owner is never taken from the request.
- `global`: **decision needed** (also open in the edit/delete doc). Can every signed-in user
  create globals, or only some roles? Return `403 FORBIDDEN` with a readable `message`; the UI
  shows it.
- Environment: same permission as editing that environment.

Values are stored in plain text, like environment values today. Do not log them.

---

## 5. Change events

So other tabs and users see new variables without reloading:

- `global` create → the existing `{ kind: "variable" }` event to everyone. The client already
  reloads scoped variables on it.
- `user` create → the same event, **only to that user's sessions** (for their other tabs).
- Environment create → the existing environment change event.

---

## 6. Status codes the UI handles on add

| Code | UI behaviour |
|---|---|
| 201 / 200 | Row added; add row closes. In manual order the new row goes to the bottom of its group |
| 400 | Message shown; add row stays open with the input kept |
| 403 | Message shown; optimistic row rolled back |
| 409 / 412 | "already exists" message shown; input kept so the user can rename |
| 422 / 413 | Message shown |
| 5xx / network | Message shown; rolled back |

If a new variable is hidden by a narrower definition (for example, a global added while the user
has a personal variable with the same name), the UI says so. This needs nothing from the backend.

---

## 7. Checklist

- [ ] Create-only for scoped variables: `POST /variables/:scope` → `201` / `409` (or `If-None-Match: *` on `PUT`)
- [ ] Atomic uniqueness on `(scope, owner, key)`
- [ ] Key and value validation, size and count limits on the server
- [ ] Authorization decision and enforcement for creating `global` variables
- [ ] `POST /environments/:id/variables` (or concurrency check on `PUT /environments/:id`)
- [ ] Change events for every create (user events only to the owner)
- [ ] Values never written to logs
