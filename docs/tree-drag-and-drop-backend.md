# Sidebar drag and drop: moving items — backend requirements

The sidebar supports dragging a folder or request onto another folder, or onto a collection row,
to **reparent** it together with its whole subtree. The API endpoint is implemented and covered by
integration tests in
[`play-next-api-workspace-api`](https://github.com/xserkansisal/play-next-api-workspace-api):
`POST /api/v1/collections/:collectionId/items/:itemId/move`.

The implementation moves the subtree transactionally, including cross-collection moves; checks
that the destination exists and is a folder, prevents moving an item into itself or its subtree,
and rejects case-insensitive sibling-folder name conflicts. It publishes change events for the
destination and, for cross-collection moves, the source. The frontend optimistically updates its
tree and restores the prior state if the API rejects the move.

Code: `src/lib/tree-move.ts` (validation and the optimistic update), `moveItem`
(`src/lib/api.ts`), `moveItem` (`src/App.tsx`), the drag handlers in
`src/components/WorkspaceTree.tsx`.

---

## 1. Why this is a reparent and never a reorder

The tree is rendered in a **derived** order: folders first, then requests, each group alphabetical
(`sortTreeItems` in `src/lib/workspace-ui.ts`). The model stores no sibling index, and neither does
the API. Dropping *between* two rows would therefore have nothing to persist — the list would snap
straight back to alphabetical order.

So every drop resolves to one of two destinations:

| Drop on | Meaning |
|---|---|
| A folder row | The node becomes a child of that folder |
| A collection row | The node becomes a top-level child of that collection |

If you want true manual ordering later, that is a **separate** change: it needs a persisted
`position` on every item, ordering guarantees on every read, and a different endpoint shape. It is
deliberately not part of this work.

---

## 2. Implemented: the move endpoint

```
POST /api/v1/collections/:collectionId/items/:itemId/move
Body: { "targetCollectionId": string, "parentId": string | null }
200 → WorkspaceItem   (the moved item, with its subtree, in its new position)
```

- `:collectionId` / `:itemId` identify the item **as it is now**.
- `targetCollectionId` is the collection the item should end up in. It may equal `:collectionId`
  (a move within one collection) or differ (a move across collections).
- `parentId` is the destination folder id, or `null` for the collection root.

`POST .../move` follows the existing `POST .../clone` shape, so routing and auth match what is
already there. The client allows 120s, as it does for clone, because a large subtree may be slow.

### It must move the whole subtree, in one transaction

Dragging a folder moves everything beneath it. The server must reparent the subtree **atomically**:
a partial move that leaves some descendants behind would detach them from the tree with no UI able
to reach them.

Every descendant's `collectionId` must be rewritten when the move crosses collections. The client
already does exactly this locally (`reassign` in `src/lib/tree-move.ts`) and expects the server to
agree.

### Required rejections

The client blocks all of these during the drag, so a correct client never sends them. The server
must still enforce them — a stale tab can send a move that was legal when its copy was loaded.

| Condition | Status | Code |
|---|---|---|
| `:itemId` does not exist | `404` | `ITEM_NOT_FOUND` |
| `targetCollectionId` or `parentId` does not exist | `404` | `TARGET_NOT_FOUND` |
| `parentId` is the item itself | `409` | `INVALID_MOVE` |
| `parentId` is a descendant of the item | `409` | `INVALID_MOVE` |
| `parentId` refers to a request, not a folder | `409` | `INVALID_MOVE` |
| A sibling **folder** in the destination already has that name (case-insensitively) | `409` | `NAME_CONFLICT` |

The cycle check (`parentId` inside the moved subtree) is the important one: without it a folder can
be made its own ancestor, which detaches that whole branch from the collection permanently.

**Name conflicts apply to folders only.** Sibling requests may share a name — this matches
`RestoreConflict`, which reports conflicts for `collection | folder | environment` and never for a
request, and `dedupeSiblingFolderName` in `src/lib/postman-import.ts`.

Use the standard error body so `describeApiError` can show it:

```json
{ "error": { "code": "NAME_CONFLICT", "message": "A folder named \"Auth\" already exists here." } }
```

### Authentication and active resources

The route requires a signed-in user and records that user as the mover. The service verifies that
the source item, destination collection, and destination folder (when supplied) are active and
belong to the collections named in the request. Workspace collections are shared with the signed-in
team; this project does not use per-role or per-collection authorization.

---

## 3. Change events

Emit an event on the SSE change stream for the moved item, as the other item mutations do, so a
second tab does not keep showing the item under its old parent until a reload.

A move changes the item's `parentId` and possibly its `collectionId`. The existing `ChangeEvent`
carries `kind`, `id`, `collectionId` and `operation`
(`src/lib/workspace-types.ts`), so `operation: "move"` with the **new** `collectionId` fits the
current shape. Clients that only know how to refetch will do the right thing with it.

---

## 4. What the client already guarantees

So the backend work can be scoped accurately, the UI already:

- Validates every drop **during** the drag (`checkMove`), so an illegal destination shows the
  "no drop" cursor and never highlights.
- Blocks drops into self, into a descendant, and onto the parent the node already has.
- Blocks a folder whose name is already taken by a sibling folder in the destination, using the
  same `nameKey` normalisation (`NFC` + plain `toLowerCase`) the API uses.
- Updates the tree optimistically and **restores the previous tree** if the API rejects the move.
- Never attempts to reorder siblings, and never drags a collection — collections are roots and are
  drop targets only.

## 5. Remaining frontend gap

Drag and drop is pointer-only. There is no keyboard equivalent for moving an item, so this is not
reachable for keyboard or screen-reader users. A "Move to…" command would close that gap and needs
no further backend work beyond the endpoint above.
