import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { fitSidebarWidth } from '@/lib/sidebar-width-storage'
import { loadCollapsedIds, pruneCollapsedIds, saveCollapsedIds } from '@/lib/tree-expansion-storage'
import { checkMove, type MoveSource, type MoveTarget } from '@/lib/tree-move'
import { methodLabel, sortByName, sortTreeItems } from '@/lib/workspace-ui'
import { resourceKey, type CollectionResource, type EnvironmentResource, type OpenResource, type WorkspaceItem } from '@/lib/workspace-types'
import { PresenceAvatars } from '@/components/PresenceAvatars'
import type { PresenceUser } from '@/lib/presence'

/**
 * The two sidebar sections fold like any other node, so their state rides along in the same stored
 * collapsed set. The ids are namespaced to keep them from ever colliding with a resource id.
 */
export const COLLECTIONS_SECTION = 'section:collections'
export const ENVIRONMENTS_SECTION = 'section:environments'

interface WorkspaceTreeProps {
  collections: CollectionResource[]
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onCreateCollection: () => void
  onCreateFolder: () => void
  onCreateRequest: () => void
  onDelete: (resource: OpenResource) => void
  onClone: (resource: OpenResource) => void
  /** Id of the resource whose copy is still being written, so its button cannot be pressed twice. */
  cloningId: string | null
  onShowTrash: () => void
  onShowHistory: () => void
  collapsed: boolean
  environments: EnvironmentResource[]
  /**
   * The environment currently applied to requests, chosen in the topbar picker. This is distinct
   * from `selected`, which is merely the row open in the editor - an environment can be open for
   * editing without being the one whose variables actually resolve.
   */
  activeEnvironmentId: string
  onCreateEnvironment: () => void
  /** Width in pixels; owned by the caller so it can be persisted and applied to the layout. */
  width: number
  onResize: (width: number) => void
  /**
   * Reparents a node and everything under it. Omit to render a tree that cannot be dragged, which
   * is what the read-only surfaces want.
   */
  onMove?: (source: MoveSource, target: MoveTarget) => void
  presenceByResource?: Record<string, PresenceUser[]>
}

/** Stable identity for a drop destination, so one hovered row can be highlighted at a time. */
function targetKey(target: MoveTarget): string {
  return target.kind === 'collection' ? `collection:${target.collectionId}` : `folder:${target.itemId}`
}

/**
 * Drag state is threaded down the recursive tree the same way expansion is, rather than held in a
 * context, because the tree is small and this keeps the data flow visible at each call site.
 */
type DragState = {
  draggingId: string | null
  overKey: string | null
  allows: (target: MoveTarget) => boolean
  begin: (source: MoveSource) => void
  over: (key: string | null) => void
  drop: (target: MoveTarget) => void
  end: () => void
}

/**
 * Expansion is tracked as the set of *collapsed* node ids rather than expanded ones, so a node
 * that appears later (a new folder, or one arriving over SSE) defaults to expanded without
 * needing to be registered anywhere first.
 */
type ExpansionState = {
  isCollapsed: (id: string) => boolean
  toggle: (id: string) => void
}

/** Ids of every collection and folder currently in the tree - the nodes that can collapse. */
function collectExpandableIds(collections: CollectionResource[]): string[] {
  const ids: string[] = []
  const walk = (items: WorkspaceItem[]) => {
    for (const item of items) {
      if (item.type === 'folder') {
        ids.push(item.id)
        walk(item.items)
      }
    }
  }
  for (const collection of collections) {
    ids.push(collection.id)
    walk(collection.items)
  }
  return ids
}

/**
 * Folders get a folder glyph rather than a bare chevron: the open/closed state reads as "this is a
 * container and it is open", which a triangle alone does not convey. Inline SVG rather than an
 * emoji folder, which would render in colour and differently on every platform.
 */
function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg className="tree-folder-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {open ? (
        <>
          <path d="M1.5 4.25A1.75 1.75 0 0 1 3.25 2.5h2.4c.46 0 .9.18 1.23.51l.8.8c.1.1.23.15.36.15h4.71c.97 0 1.75.78 1.75 1.75v.54H5.1a2 2 0 0 0-1.9 1.37L1.5 12.2z" />
          <path d="M4.15 8.1a1 1 0 0 1 .95-.68h9.4a1 1 0 0 1 .95 1.32l-1.4 4.2a1 1 0 0 1-.95.68H2.7a1 1 0 0 1-.95-1.32z" />
        </>
      ) : (
        <path d="M1.5 4.25A1.75 1.75 0 0 1 3.25 2.5h2.4c.46 0 .9.18 1.23.51l.8.8c.1.1.23.15.36.15h4.71c.97 0 1.75.78 1.75 1.75v6.04c0 .97-.78 1.75-1.75 1.75H3.25A1.75 1.75 0 0 1 1.5 11.75z" />
      )}
    </svg>
  )
}

/**
 * Collections are the tier above folders, so they get an archive box rather than a second folder
 * glyph, which would make the two levels look interchangeable. Closed is a lidded box; open lifts
 * the lid clear of the body, which reads at 15px where a subtler difference would not.
 */
function CollectionIcon({ open }: { open: boolean }) {
  return (
    <svg className="tree-collection-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {open ? (
        <>
          {/* Lid, detached and tilted above the body. */}
          <path d="M2.4 3.3a.9.9 0 0 1 .64-.78l9.1-1.3a.9.9 0 0 1 1.02.72l.26 1.5-10.8 1.54z" />
          <path d="M2.5 6h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1m3.6 2.1a.75.75 0 0 0 0 1.5h3.8a.75.75 0 0 0 0-1.5z" />
        </>
      ) : (
        <>
          {/* Lid seated flat on the body. */}
          <path d="M1.5 3.2a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1.3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
          <path d="M2.4 6.8h11.2v6.1a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1zm3.7 1.9a.75.75 0 0 0 0 1.5h3.8a.75.75 0 0 0 0-1.5z" />
        </>
      )}
    </svg>
  )
}

/**
 * The three "new X" buttons sit side by side, so they are built from one template: the object's own
 * shape scaled into the top-left, plus a badge in the bottom-right. Without the badge they read as
 * three unrelated shapes rather than three create actions. The badge punches its cross out with
 * evenodd instead of painting it white, so the button's hover background shows through correctly.
 */
function PlusBadge() {
  return (
    <path
      fillRule="evenodd"
      d="M12.6 9.2a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 1 0 0-6.8M12.05 10.5h1.1v1.55h1.55v1.1h-1.55v1.55h-1.1v-1.55H10.5v-1.1h1.55z"
    />
  )
}

/** Wraps a 16x16 shape so it clears the badge. 0.7 keeps the two from touching at any corner. */
function CreateIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g transform="scale(0.7)">{children}</g>
      <PlusBadge />
    </svg>
  )
}

const NewRequestIcon = () => (
  <CreateIcon>
    {/* A portrait page with its text lines punched out; requests have no icon in the tree itself. */}
    <path
      fillRule="evenodd"
      d="M4 1.5h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1M5 4.8h5v1.5H5zM5 8h5v1.5H5zM5 11.2h3v1.5H5z"
    />
  </CreateIcon>
)

const NewFolderIcon = () => (
  <CreateIcon>
    <path d="M1.5 4.25A1.75 1.75 0 0 1 3.25 2.5h2.4c.46 0 .9.18 1.23.51l.8.8c.1.1.23.15.36.15h4.71c.97 0 1.75.78 1.75 1.75v6.04c0 .97-.78 1.75-1.75 1.75H3.25A1.75 1.75 0 0 1 1.5 11.75z" />
  </CreateIcon>
)

const NewCollectionIcon = () => (
  <CreateIcon>
    <path d="M1.5 3.2a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1.3a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    <path d="M2.4 6.8h11.2v6.1a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1zm3.7 1.9a.75.75 0 0 0 0 1.5h3.8a.75.75 0 0 0 0-1.5z" />
  </CreateIcon>
)

/**
 * Arrows moving apart from / together toward a centre line. The previous diagonal glyphs read as
 * "enter fullscreen", which is a different action entirely.
 */
function FoldIcon({ expand }: { expand: boolean }) {
  return (
    <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2" y="7.1" width="12" height="1.8" rx=".9" />
      {expand ? (
        <>
          <path d="M8 1.2l3 3.2H5z" />
          <path d="M8 14.8l3-3.2H5z" />
        </>
      ) : (
        <>
          <path d="M5 2.4h6L8 5.6z" />
          <path d="M5 13.6h6L8 10.4z" />
        </>
      )}
    </svg>
  )
}

/** Environments have one create action, so a plain plus is unambiguous; as SVG it matches the
 *  weight and alignment of the icons beside it, which the fullwidth glyph did not. */
const PlusIcon = () => (
  <svg className="tool-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M7.1 2.6h1.8v4.5h4.5v1.8H8.9v4.5H7.1V8.9H2.6V7.1h4.5z" />
  </svg>
)

const SearchIcon = () => (
  <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      fillRule="evenodd"
      d="M7.2 1.6a5.6 5.6 0 1 0 3.33 10.1l3.09 3.08a.9.9 0 0 0 1.27-1.27l-3.08-3.09A5.6 5.6 0 0 0 7.2 1.6m0 1.8a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6"
    />
  </svg>
)

function TreeItem({
  collectionId,
  item,
  depth,
  selected,
  onSelect,
  onDelete,
  onClone,
  cloningId,
  filter,
  expansion,
  drag,
  presenceByResource,
}: {
  collectionId: string
  item: WorkspaceItem
  depth: number
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  onClone: (resource: OpenResource) => void
  cloningId: string | null
  filter: string
  expansion: ExpansionState
  drag: DragState
  presenceByResource?: Record<string, PresenceUser[]>
}) {
  const expanded = !expansion.isCollapsed(item.id)
  const childMatch = item.type === 'folder' && item.items.some((child) => containsMatch(child, filter))
  if (filter && !item.name.toLowerCase().includes(filter) && !childMatch) return null
  const active = selected?.kind === item.type &&
    selected.collectionId === collectionId && selected.itemId === item.id
  const resource: OpenResource = {
    kind: item.type,
    collectionId,
    itemId: item.id,
  }

  const dropTarget: MoveTarget | null = item.type === 'folder'
    ? { kind: 'folder', collectionId, itemId: item.id }
    : null
  const isDropTarget = !!dropTarget && drag.allows(dropTarget)
  const isOver = !!dropTarget && isDropTarget && drag.overKey === targetKey(dropTarget)

  return (
    <>
      <div
        className={[
          'tree-row',
          item.type,
          active ? 'selected' : '',
          drag.draggingId === item.id ? 'dragging' : '',
          isOver ? 'drop-into' : '',
        ].filter(Boolean).join(' ')}
        style={{ '--indent': depth } as CSSProperties}
        draggable
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          // Firefox starts no drag at all unless some data is set.
          event.dataTransfer.setData('text/plain', item.id)
          drag.begin({ collectionId, itemId: item.id })
        }}
        onDragEnd={drag.end}
        onDragOver={(event) => {
          if (!dropTarget || !isDropTarget) return
          // Only preventDefault on a legal target: that is what makes this a drop zone, so an
          // illegal one keeps the "no drop" cursor instead of silently accepting.
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          drag.over(targetKey(dropTarget))
        }}
        onDrop={(event) => {
          if (!dropTarget || !isDropTarget) return
          event.preventDefault()
          event.stopPropagation()
          drag.drop(dropTarget)
        }}
      >
        {item.type === 'folder' ? (
          <button className="tree-chevron tree-folder-toggle" onClick={() => expansion.toggle(item.id)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}>
            <FolderIcon open={expanded} />
          </button>
        ) : (
          <span className={`tree-method method-${item.method.toLowerCase()}`} title={item.method}>
            {methodLabel(item.method)}
          </span>
        )}
        <button className="tree-name" onClick={() => onSelect(resource)} title={item.name}>{item.name}</button>
        <PresenceAvatars users={presenceByResource?.[resourceKey(resource)] ?? []} compact />
        <button className="tree-clone" title={`Duplicate ${item.name}`} aria-label={`Duplicate ${item.name}`} disabled={cloningId === item.id} onClick={() => onClone(resource)}>⧉</button>
        <button className="tree-delete" title={`Move ${item.name} to Trash`} aria-label={`Move ${item.name} to Trash`} onClick={() => onDelete(resource)}>×</button>
      </div>
      {item.type === 'folder' && (expanded || !!filter) && sortTreeItems(item.items).map((child) => (
        <TreeItem
          key={child.id}
          collectionId={collectionId}
          item={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          onClone={onClone}
          cloningId={cloningId}
          filter={filter}
          expansion={expansion}
          drag={drag}
          presenceByResource={presenceByResource}
        />
      ))}
    </>
  )
}

function containsMatch(item: WorkspaceItem, filter: string): boolean {
  return item.name.toLowerCase().includes(filter) ||
    (item.type === 'folder' && item.items.some((child) => containsMatch(child, filter)))
}

/** A foldable sidebar section header, so Collections and Environments behave the same way. */
function SectionHeader({ label, count, expanded, onToggle, children }: {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <div className="sidebar-heading">
      <button
        className="sidebar-section-toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        onClick={onToggle}
      >
        <span className="tree-chevron-mark" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span>{label}</span>
        <span className="sidebar-section-count">{count}</span>
      </button>
      <div className="sidebar-tools">{children}</div>
    </div>
  )
}

export function WorkspaceTree({
  collections,
  selected,
  onSelect,
  onCreateCollection,
  onCreateFolder,
  onCreateRequest,
  onDelete,
  onClone,
  cloningId,
  onShowTrash,
  onShowHistory,
  collapsed,
  environments,
  activeEnvironmentId,
  onCreateEnvironment,
  width,
  onResize,
  onMove,
  presenceByResource,
}: WorkspaceTreeProps) {
  const [search, setSearch] = useState('')
  // Restored from storage on first render so the tree opens the way the user left it, rather
  // than fully expanded every time.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(loadCollapsedIds)
  const filter = search.trim().toLowerCase()
  const sorted = useMemo(() => sortByName(collections), [collections])

  const expandableIds = useMemo(() => collectExpandableIds(sorted), [sorted])
  const toggle = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])
  const expansion = useMemo<ExpansionState>(() => ({
    isCollapsed: (id: string) => collapsedIds.has(id),
    toggle,
  }), [collapsedIds, toggle])

  const [dragSource, setDragSource] = useState<MoveSource | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const drag = useMemo<DragState>(() => ({
    draggingId: dragSource?.itemId ?? null,
    overKey,
    // Validating during the drag is what lets an illegal destination show the "no drop" cursor
    // instead of accepting the drop and failing afterwards.
    allows: (target: MoveTarget) => !!onMove && !!dragSource && checkMove(collections, dragSource, target).ok,
    begin: (source: MoveSource) => setDragSource(source),
    over: setOverKey,
    drop: (target: MoveTarget) => {
      if (onMove && dragSource && checkMove(collections, dragSource, target).ok) onMove(dragSource, target)
      setDragSource(null)
      setOverKey(null)
    },
    end: () => {
      setDragSource(null)
      setOverKey(null)
    },
  }), [collections, dragSource, onMove, overKey])

  // Forget nodes that no longer exist, so deleting and recreating folders cannot grow the stored
  // set forever. Skipped while the tree is empty, which is also how a not-yet-loaded tree looks.
  //
  // The section ids are listed as known even though they belong to no resource: pruning would
  // otherwise drop them on the next load and quietly reopen a section the user had folded.
  //
  // An empty tree stays empty here, because `pruneCollapsedIds` reads that as "not loaded yet" and
  // skips pruning. Appending the sections unconditionally would defeat that guard and wipe the
  // user's collapsed folders during the first render, before the collections arrive.
  const knownIds = useMemo(
    () => expandableIds.length === 0 ? expandableIds : [...expandableIds, COLLECTIONS_SECTION, ENVIRONMENTS_SECTION],
    [expandableIds],
  )
  useEffect(() => {
    setCollapsedIds((current) => pruneCollapsedIds(current, knownIds))
  }, [knownIds])

  useEffect(() => {
    saveCollapsedIds(collapsedIds)
  }, [collapsedIds])

  // A search shows matching descendants regardless of collapsed state, so while filtering the
  // buttons would not visibly do anything; disable them rather than appear broken.
  const bulkDisabled = !!filter || expandableIds.length === 0
  const allCollapsed = expandableIds.length > 0 && expandableIds.every((id) => collapsedIds.has(id))
  const allExpanded = collapsedIds.size === 0

  const selectedCollectionId = selected && selected.kind !== 'environment' ? selected.collectionId :
    sorted[0]?.id

  const sortedEnvironments = useMemo(() => sortByName(environments), [environments])
  const visibleEnvironments = filter
    ? sortedEnvironments.filter((entry) => entry.name.toLowerCase().includes(filter))
    : sortedEnvironments

  // Kept in state rather than read during render, so a window resize actually repaints the sidebar.
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const appliedWidth = fitSidebarWidth(width, viewportWidth)

  const collectionsOpen = !collapsedIds.has(COLLECTIONS_SECTION)
  const environmentsOpen = !collapsedIds.has(ENVIRONMENTS_SECTION)

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => onResize(moveEvent.clientX)
    const stop = () => window.removeEventListener('pointermove', move)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  const visibleCollections = sorted.filter((collection) => !filter ||
    collection.name.toLowerCase().includes(filter) ||
    collection.items.some((item) => containsMatch(item, filter)))

  return (
    <>
      {/*
        The width is omitted while collapsed: an inline style outranks the stylesheet, so applying
        it would override the collapsed rail's own width and leave the sidebar wide open.
      */}
      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''}`}
        style={collapsed ? undefined : { flexBasis: `${appliedWidth}px`, width: `${appliedWidth}px`, minWidth: `${appliedWidth}px` }}
      >
        <SectionHeader label="Collections" count={sorted.length} expanded={collectionsOpen} onToggle={() => toggle(COLLECTIONS_SECTION)}>
          <button
            title={bulkDisabled ? 'Clear the search to expand all' : 'Expand all folders'}
            aria-label="Expand all"
            disabled={bulkDisabled || allExpanded}
            onClick={() => setCollapsedIds(new Set())}
          ><FoldIcon expand /></button>
          <button
            title={bulkDisabled ? 'Clear the search to collapse all' : 'Collapse all folders'}
            aria-label="Collapse all"
            disabled={bulkDisabled || allCollapsed}
            onClick={() => setCollapsedIds(new Set(expandableIds))}
          ><FoldIcon expand={false} /></button>
          <span className="sidebar-tools-divider" aria-hidden="true" />
          <button title="New request" aria-label="New request" onClick={onCreateRequest}><NewRequestIcon /></button>
          <button title="New folder" aria-label="New folder" onClick={onCreateFolder}><NewFolderIcon /></button>
          <button title="New collection" aria-label="New collection" onClick={onCreateCollection}><NewCollectionIcon /></button>
        </SectionHeader>
        <label className="search">
          <SearchIcon />
          <input aria-label="Search collections" placeholder="Search collections and environments" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {collectionsOpen && (
          <nav
            className="tree"
            aria-label="Collections"
            onDragLeave={(event) => {
              // Leaving the tree entirely clears the highlight. Checked against relatedTarget
              // because this also fires when the pointer crosses between two rows inside it.
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) drag.over(null)
            }}
          >
            {visibleCollections.map((collection) => (
              <CollectionTree
                key={collection.id}
                collection={collection}
                selected={selected}
                onSelect={onSelect}
                onDelete={onDelete}
                onClone={onClone}
                cloningId={cloningId}
                filter={filter}
                selectedCollectionId={selectedCollectionId}
                expansion={expansion}
                drag={drag}
                presenceByResource={presenceByResource}
              />
            ))}
            {sorted.length === 0 && <p className="empty-tree">No collections yet.</p>}
            {sorted.length > 0 && visibleCollections.length === 0 && <p className="empty-tree">No matching collections.</p>}
          </nav>
        )}
        <div className="sidebar-section environments-section">
          <SectionHeader label="Environments" count={environments.length} expanded={environmentsOpen} onToggle={() => toggle(ENVIRONMENTS_SECTION)}>
            <button title="New environment" aria-label="New environment" onClick={onCreateEnvironment}><PlusIcon /></button>
          </SectionHeader>
          {environmentsOpen && (
            <nav className="tree environments-tree" aria-label="Environments">
              {visibleEnvironments.map((environment) => {
                const isSelected = selected?.kind === 'environment' && selected.environmentId === environment.id
                const isActive = environment.id === activeEnvironmentId
                return (
                  <div key={environment.id} className={`tree-row environment ${isSelected ? 'selected' : ''} ${isActive ? 'active-environment' : ''}`}>
                    <span className="tree-environment-mark" aria-hidden="true">◉</span>
                    <button className="tree-name" title={isActive ? `${environment.name} (active)` : environment.name} onClick={() => onSelect({ kind: 'environment', environmentId: environment.id })}>
                      {environment.name}
                    </button>
                    {isActive && <span className="environment-active-tag">Active</span>}
                    <button
                      className="tree-clone"
                      title={`Duplicate ${environment.name}`}
                      aria-label={`Duplicate ${environment.name}`}
                      disabled={cloningId === environment.id}
                      onClick={() => onClone({ kind: 'environment', environmentId: environment.id })}
                    >⧉</button>
                    <button
                      className="tree-delete"
                      title={`Move ${environment.name} to Trash`}
                      aria-label={`Move ${environment.name} to Trash`}
                      onClick={() => onDelete({ kind: 'environment', environmentId: environment.id })}
                    >×</button>
                  </div>
                )
              })}
              {environments.length === 0 && <p className="empty-tree">No environments yet.</p>}
              {environments.length > 0 && visibleEnvironments.length === 0 && <p className="empty-tree">No matching environments.</p>}
            </nav>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-link" onClick={onShowHistory}>▥ &nbsp; History</button>
          <button className="sidebar-link" onClick={onShowTrash}>▱ &nbsp; Trash</button>
        </div>
      </aside>
      {!collapsed && <div
        className="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={startResize}
      />}
    </>
  )
}

function CollectionTree({
  collection,
  selected,
  onSelect,
  onDelete,
  onClone,
  cloningId,
  filter,
  selectedCollectionId,
  expansion,
  drag,
  presenceByResource,
}: {
  collection: CollectionResource
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  onClone: (resource: OpenResource) => void
  cloningId: string | null
  filter: string
  selectedCollectionId?: string
  expansion: ExpansionState
  drag: DragState
  presenceByResource?: Record<string, PresenceUser[]>
}) {
  const expanded = !expansion.isCollapsed(collection.id)
  const isSelected = selected?.kind === 'collection' && selected.collectionId === collection.id
  const children = collection.items.filter((item) => !filter || containsMatch(item, filter))
  // Dropping on a collection row moves the node to that collection's root.
  const dropTarget: MoveTarget = { kind: 'collection', collectionId: collection.id }
  const isDropTarget = drag.allows(dropTarget)
  const isOver = isDropTarget && drag.overKey === targetKey(dropTarget)
  return (
    <>
      <div
        className={`tree-row collection ${isSelected ? 'selected' : ''} ${isOver ? 'drop-into' : ''}`}
        onDragOver={(event) => {
          if (!isDropTarget) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          drag.over(targetKey(dropTarget))
        }}
        onDrop={(event) => {
          if (!isDropTarget) return
          event.preventDefault()
          event.stopPropagation()
          drag.drop(dropTarget)
        }}
      >
        <button className="tree-chevron tree-collection-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${collection.name}`} onClick={() => expansion.toggle(collection.id)}>
          <CollectionIcon open={expanded} />
        </button>
        <button className="tree-name" onClick={() => onSelect({ kind: 'collection', collectionId: collection.id })} title={collection.name}>
          {collection.name}
        </button>
        <PresenceAvatars users={presenceByResource?.[resourceKey({ kind: 'collection', collectionId: collection.id })] ?? []} compact />
        <button className="tree-clone" title={`Duplicate ${collection.name}`} aria-label={`Duplicate ${collection.name}`} disabled={cloningId === collection.id} onClick={() => onClone({ kind: 'collection', collectionId: collection.id })}>⧉</button>
        <button className="tree-delete" title={`Move ${collection.name} to Trash`} aria-label={`Move ${collection.name} to Trash`} onClick={() => onDelete({ kind: 'collection', collectionId: collection.id })}>×</button>
      </div>
      {(expanded || !!filter) && sortTreeItems(children).map((item) => (
        <TreeItem key={item.id} collectionId={collection.id} item={item} depth={1} selected={selected} onSelect={onSelect} onDelete={onDelete} onClone={onClone} cloningId={cloningId} filter={filter} expansion={expansion} drag={drag} presenceByResource={presenceByResource} />
      ))}
      {collection.id === selectedCollectionId && expanded && !filter && collection.items.length === 0 && (
        <p className="empty-tree nested">No requests yet.</p>
      )}
    </>
  )
}
