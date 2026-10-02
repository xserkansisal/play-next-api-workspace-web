import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent } from 'react'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { describeApiError } from '@/lib/api'
import { addScopedVariable, removeScopedVariable, updateScopedVariable } from '@/lib/scoped-variables'
import {
  manualListFor,
  moveVariableName,
  nextSort,
  orderVariableNames,
  renameInOrder,
  withManualList,
  type MoveTarget,
  type VariableOrderPreferences,
  type VariableSortField,
} from '@/lib/variable-order'
import { getVariableOrder, saveVariableOrder, subscribeVariableOrder } from '@/lib/variable-order-storage'
import { describeOrigin, shadowedNames, validateVariableName, VARIABLE_PRECEDENCE, type VariableDefinition, type VariableOrigin, type VariableResolution } from '@/lib/variable-scopes'

const SCOPE_GROUPS: { origin: VariableOrigin; label: string }[] = [
  { origin: 'user', label: 'Only me' },
  { origin: 'environment', label: 'Environments' },
  { origin: 'global', label: 'Everyone' },
]

const MOVE_OPTIONS: { target: 'top' | 'up' | 'down' | 'bottom'; label: string }[] = [
  { target: 'top', label: 'Move to top' },
  { target: 'up', label: 'Move up' },
  { target: 'down', label: 'Move down' },
  { target: 'bottom', label: 'Move to bottom' },
]

type EditingVariable = { origin: VariableOrigin; name: string; key: string; value: string }
type AddingVariable = { origin: VariableOrigin; key: string; value: string }
type DragState = { origin: VariableOrigin; name: string }
type DropHint = { origin: VariableOrigin; name: string; position: 'before' | 'after' }

const icon = { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export function VariablesMenu({ resolved, variablesByScope, hasEnvironment, environmentId, filter = '', selectedOrigin, initialAddKey, onInitialAddHandled, standalone = false, onAddEnvironmentVariable, onEditEnvironmentVariable, onRemoveEnvironmentVariable }: {
  resolved: Record<string, VariableResolution>
  variablesByScope: Record<VariableOrigin, VariableDefinition[]>
  hasEnvironment: boolean
  environmentId: string | null
  filter?: string
  selectedOrigin?: VariableOrigin
  initialAddKey?: string | null
  onInitialAddHandled?: () => void
  standalone?: boolean
  onAddEnvironmentVariable: (key: string, value: string) => Promise<void>
  onEditEnvironmentVariable: (oldKey: string, newKey: string, value: string) => Promise<void>
  onRemoveEnvironmentVariable: (name: string) => Promise<void>
}) {
  const order = useSyncExternalStore(subscribeVariableOrder, getVariableOrder, getVariableOrder)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingVariable | null>(null)
  const [adding, setAdding] = useState<AddingVariable | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [moveMenu, setMoveMenu] = useState<DragState | null>(null)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<{ name: string; origin: VariableOrigin } | null>(null)
  const cancelRemoval = useCallback(() => setPendingRemoval(null), [])
  const panelRef = useRef<HTMLDivElement>(null)
  const query = filter.trim().toLowerCase()
  const filteredByGroup = Object.fromEntries(SCOPE_GROUPS.map(({ origin }) => {
    const definitions = new Map<string, VariableDefinition>()
    for (const variable of variablesByScope[origin]) {
      if (!query || variable.key.toLowerCase().includes(query) || variable.value.toLowerCase().includes(query)) {
        definitions.set(variable.key, variable)
      }
    }
    return [origin, definitions]
  })) as Record<VariableOrigin, Map<string, VariableDefinition>>
  const names = [...new Set(SCOPE_GROUPS.flatMap(({ origin }) => [...filteredByGroup[origin].keys()]))]
  const shadowed = shadowedNames(resolved)

  const visibleByGroup = Object.fromEntries(SCOPE_GROUPS.map(({ origin }) => [
    origin,
    orderVariableNames(
      [...filteredByGroup[origin].keys()],
      (name) => filteredByGroup[origin].get(name)!.value,
      order.sort,
      manualListFor(order, origin, environmentId),
    ),
  ])) as Record<VariableOrigin, string[]>
  const selectedGroup = SCOPE_GROUPS.find(({ origin }) => origin === selectedOrigin)
  const standaloneNames = selectedOrigin ? visibleByGroup[selectedOrigin] : names
  const standaloneActiveCount = selectedOrigin
    ? standaloneNames.filter((name) => resolved[name]?.origin === selectedOrigin).length
    : standaloneNames.length
  const standaloneOverriddenCount = selectedOrigin
    ? standaloneNames.filter((name) =>
        !(selectedOrigin === 'environment' && filteredByGroup.environment.get(name)?.enabled === false) &&
        resolved[name] && resolved[name]!.origin !== selectedOrigin).length
    : 0
  const standaloneDisabledCount = selectedOrigin === 'environment'
    ? standaloneNames.filter((name) => filteredByGroup.environment.get(name)?.enabled === false).length
    : 0
  const visibleNameCount = standalone ? standaloneNames.length : names.length
  const scopeDescription = selectedOrigin === 'user'
    ? 'Private values that apply only to your account and take precedence over shared values.'
    : selectedOrigin === 'environment'
      ? 'Values for the currently active environment. Select an environment to add or edit its variables.'
      : selectedOrigin === 'global'
        ? 'Shared values available to everyone in this workspace.'
        : 'Manage the values used across your workspace.'

  useEffect(() => {
    if (!moveMenu) return
    function close(event: MouseEvent) {
      if (!(event.target instanceof Element) || !event.target.closest('.runtime-vars-move-menu, .runtime-vars-move-trigger')) setMoveMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [moveMenu])

  useEffect(() => {
    if (!initialAddKey) return
    setError(null)
    setNotice(null)
    setEditing(null)
    setAdding({ origin: selectedOrigin ?? 'user', key: initialAddKey, value: '' })
    onInitialAddHandled?.()
  }, [initialAddKey, onInitialAddHandled, selectedOrigin])

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (actionError) {
      setError(describeApiError(actionError))
      return false
    } finally {
      setBusy(false)
    }
  }

  function startAdd(origin: VariableOrigin, group: HTMLDetailsElement | null) {
    setError(null)
    setNotice(null)
    setEditing(null)
    setAdding({ origin, key: '', value: '' })
    if (group) group.open = true
  }

  async function saveAdd() {
    if (!adding) return
    const validation = validateVariableName(adding.key)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    const { origin, value } = adding
    const key = validation.name
    const saved = await run(() => origin === 'environment' ? onAddEnvironmentVariable(key, value) : addScopedVariable(origin, key, value))
    if (!saved) return
    setAdding(null)
    // In manual order a new row goes to the bottom of its group, where the user just added it,
    // rather than wherever key order would slot it in.
    if (!order.sort) {
      const current = getVariableOrder()
      const list = manualListFor(current, origin, environmentId)
      saveVariableOrder(withManualList(current, origin, environmentId, [...visibleByGroup[origin], ...list.filter((entry) => !visibleByGroup[origin].includes(entry) && entry !== key), key]))
    }
    // Only the winning definition of a name is listed, so a value added beneath a narrower one
    // would otherwise seem to vanish.
    const winner = resolved[key]?.origin
    if (winner && VARIABLE_PRECEDENCE.indexOf(winner) < VARIABLE_PRECEDENCE.indexOf(origin)) {
      setNotice(`Added "${key}", but ${describeOrigin(winner)} takes precedence, so requests will use that value instead.`)
    } else {
      setNotice(null)
      setAnnouncement(`Added ${key}.`)
    }
  }

  function startEdit(name: string, origin: VariableOrigin) {
    setError(null)
    setAdding(null)
    setEditing({ origin, name, key: name, value: filteredByGroup[origin].get(name)?.value ?? '' })
  }

  async function saveEdit() {
    if (!editing) return
    const validation = validateVariableName(editing.key)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    const { origin, name, value } = editing
    const saved = await run(() => origin === 'environment'
      ? onEditEnvironmentVariable(name, validation.name, value)
      : updateScopedVariable(origin, name, validation.name, value))
    if (!saved) return
    setEditing(null)
    if (validation.name !== name) {
      const current = getVariableOrder()
      const list = manualListFor(current, origin, environmentId)
      if (list.includes(name)) saveVariableOrder(withManualList(current, origin, environmentId, renameInOrder(list, name, validation.name)))
    }
  }

  async function remove(name: string, origin: VariableOrigin) {
    setPendingRemoval(null)
    await run(() => origin === 'environment' ? onRemoveEnvironmentVariable(name) : removeScopedVariable(origin, name))
    if (editing?.name === name && editing.origin === origin) setEditing(null)
  }

  function sortBy(field: VariableSortField) {
    saveVariableOrder({ ...order, sort: nextSort(order.sort, field) })
  }

  /**
   * Leaving a column sort for manual order snapshots *every* group as currently shown, so only
   * the row the user moved changes position, not the other groups as well.
   */
  function move(origin: VariableOrigin, name: string, target: MoveTarget) {
    let next: VariableOrderPreferences = order
    if (order.sort) {
      next = { ...order, sort: null }
      for (const group of SCOPE_GROUPS) {
        if (group.origin === origin || (group.origin === 'environment' && !environmentId)) continue
        const visible = visibleByGroup[group.origin]
        const stored = manualListFor(order, group.origin, environmentId)
        next = withManualList(next, group.origin, environmentId, [...visible, ...stored.filter((entry) => !visible.includes(entry))])
      }
    }
    const visible = visibleByGroup[origin]
    const list = moveVariableName(visible, manualListFor(order, origin, environmentId), name, target)
    saveVariableOrder(withManualList(next, origin, environmentId, list))
    const position = list.filter((entry) => visible.includes(entry)).indexOf(name) + 1
    setAnnouncement(`${name} moved to position ${position} of ${visible.length}.`)
  }

  function handleKeyboardMove(event: KeyboardEvent, origin: VariableOrigin, name: string) {
    const target = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : event.key === 'Home' ? 'top' : event.key === 'End' ? 'bottom' : null
    if (!target) return
    event.preventDefault()
    move(origin, name, target)
    // The row re-renders in its new place; keep focus on its handle so repeated presses keep moving it.
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(`${origin}:${name}`)}"]`)?.focus())
  }

  function handleDragStart(event: DragEvent, origin: VariableOrigin, name: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', name)
    const row = (event.currentTarget as HTMLElement).closest('tr')
    if (row) event.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2)
    setDragging({ origin, name })
    setMoveMenu(null)
  }

  function handleDragOver(event: DragEvent<HTMLTableRowElement>, origin: VariableOrigin, name: string) {
    if (!dragging || dragging.origin !== origin) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const box = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
    if (dropHint?.name !== name || dropHint.position !== position || dropHint.origin !== origin) setDropHint({ origin, name, position })
  }

  function handleDrop(event: DragEvent, origin: VariableOrigin) {
    event.preventDefault()
    if (dragging && dropHint && dragging.origin === origin && dropHint.origin === origin && dragging.name !== dropHint.name) {
      move(origin, dragging.name, dropHint.position === 'before' ? { before: dropHint.name } : { after: dropHint.name })
    }
    endDrag()
  }

  function endDrag() {
    setDragging(null)
    setDropHint(null)
  }

  function sortHeader(field: VariableSortField, label: string) {
    const active = order.sort?.field === field ? order.sort.direction : null
    const hint = active === 'asc' ? 'descending' : active === 'desc' ? 'manual order' : 'ascending'
    return (
      <th aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}>
        <button type="button" className="runtime-vars-sort" title={`Sort by ${label.toLowerCase()} (${hint} next)`} onClick={() => sortBy(field)}>
          {label}
          <span className="runtime-vars-sort-arrow" aria-hidden="true">{active === 'asc' ? '↑' : active === 'desc' ? '↓' : '↕'}</span>
        </button>
      </th>
    )
  }

  return (
    <details className={`runtime-vars ${standalone ? 'standalone-variables' : 'sidebar-variables'}`} open={standalone || query ? true : undefined}>
      <summary aria-label={`Variables (${names.length})`}>Variables <span className="runtime-vars-count">{names.length}</span></summary>
      <div className="runtime-vars-panel" ref={panelRef}>
        {standalone && (
          <header className="variables-detail-header">
            <div className="variables-detail-title">
              <span className={`variables-scope-icon scope-${selectedOrigin ?? 'user'}`} aria-hidden="true">
                {selectedOrigin === 'environment' ? '◇' : selectedOrigin === 'global' ? '◎' : '◉'}
              </span>
              <div>
                <span className="variables-detail-eyebrow">WORKSPACE VARIABLES</span>
                <h1 className="variables-detail-heading">{selectedGroup?.label ?? 'Variables'}</h1>
                <p className="variables-detail-description">{scopeDescription}</p>
              </div>
            </div>
            <div
              className="variables-detail-stats"
              role="group"
              aria-label={`${standaloneNames.length} ${standaloneNames.length === 1 ? 'variable' : 'variables'} defined, ${standaloneActiveCount} usable in requests`}
            >
              <strong>{standaloneNames.length}</strong>
              <span>{standaloneNames.length === 1 ? 'variable defined' : 'variables defined'}</span>
              <span className="variables-detail-usable">{standaloneActiveCount} usable in requests</span>
              {standaloneOverriddenCount > 0 && <span className="variables-detail-overridden">{standaloneOverriddenCount} overridden</span>}
              {standaloneDisabledCount > 0 && <span className="variables-detail-overridden">{standaloneDisabledCount} disabled</span>}
              <button
                type="button"
                className="variables-add-button"
                disabled={busy || (selectedOrigin === 'environment' && !hasEnvironment)}
                title={selectedOrigin === 'environment' && !hasEnvironment ? 'Select an environment to add variables' : 'Add a variable to this scope'}
                onClick={() => {
                  if (!selectedOrigin) return
                  startAdd(selectedOrigin, panelRef.current?.querySelector('.runtime-vars-group') ?? null)
                }}
              >
                <svg {...icon} strokeWidth={2.5}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                Add variable
              </button>
            </div>
            <aside className="variables-guidance" aria-label="Variable usage information">
              <div className="variables-guidance-item">
                <span className="variables-info-icon" aria-hidden="true">i</span>
                <span><strong>Precedence:</strong> Only me → Environments → Everyone. Higher-priority scopes override matching keys.</span>
              </div>
              {visibleNameCount > 0 && (
                <div className="variables-guidance-item">
                  <span className="variables-info-icon" aria-hidden="true">↕</span>
                  <span>{order.sort
                    ? `Sorted by ${order.sort.field} (${order.sort.direction === 'asc' ? 'A → Z' : 'Z → A'}); reordering switches to manual order.`
                    : 'Manual order · Drag rows or use the row menu to reorder; select a column to sort.'}</span>
                </div>
              )}
            </aside>
          </header>
        )}
        {error && <p className="extract-error" role="alert">{error}</p>}
        <p className="sr-only" aria-live="polite">{announcement}</p>
        {notice && <p className="runtime-vars-notice" role="status">{notice}</p>}
        {names.length === 0 && !standalone && (
          <p className="runtime-vars-empty">{query ? 'No matching variables.' : 'No variables yet. Add one with + below, or send a request and use “Save a value as a variable” on the response.'}</p>
        )}
        {!standalone && visibleNameCount > 0 ? (
          <p className="runtime-vars-order-status">
            <span className="variables-info-icon" aria-hidden="true">↕</span>
            {order.sort
              ? `Sorted by ${order.sort.field} (${order.sort.direction === 'asc' ? 'A → Z' : 'Z → A'}). Moving a row switches to manual order.`
              : 'Manual order · Drag rows or use the row menu to reorder; select a column to sort.'}
          </p>
        ) : null}
        {SCOPE_GROUPS.filter(({ origin }) => selectedOrigin === undefined || selectedOrigin === origin).map(({ origin, label }) => {
            const groupNames = visibleByGroup[origin]
            const activeGroupCount = groupNames.filter((name) => resolved[name]?.origin === origin).length
            const isAdding = adding?.origin === origin
            const canAdd = origin !== 'environment' || !!environmentId
            const addRow = isAdding && (
              <tr className="runtime-vars-editing runtime-vars-adding">
                <td />
                <td>
                  <input className="runtime-vars-input" aria-label={`New ${label} variable key`} placeholder="key" value={adding.key} disabled={busy} autoFocus
                    onChange={(event) => setAdding({ ...adding, key: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Enter') void saveAdd(); if (event.key === 'Escape') setAdding(null) }} />
                </td>
                <td>
                  <input className="runtime-vars-input" aria-label={`New ${label} variable value`} placeholder="value" value={adding.value} disabled={busy}
                    onChange={(event) => setAdding({ ...adding, value: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Enter') void saveAdd(); if (event.key === 'Escape') setAdding(null) }} />
                </td>
                <td />
                <td className="runtime-vars-actions">
                  <button type="button" className="runtime-vars-icon" aria-label={`Add ${label} variable`} title="Add" disabled={busy} onClick={() => void saveAdd()}>
                    <svg {...icon} strokeWidth={2.5}><path d="M20 6 9 17l-5-5" /></svg>
                  </button>
                  <button type="button" className="runtime-vars-icon" aria-label={`Cancel adding ${label} variable`} title="Cancel" disabled={busy} onClick={() => setAdding(null)}>
                    <svg {...icon} strokeWidth={2.5}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </button>
                </td>
              </tr>
            )
            return (
              <div className={`runtime-vars-group${standalone ? ' runtime-vars-group-standalone' : ''}`} key={origin}>
                {!standalone && (
                  <div className="runtime-vars-group-heading">
                    <svg className="runtime-vars-chevron" {...icon} strokeWidth={2.5}><path d="m9 6 6 6-6 6" /></svg>
                    {label}
                    <span className="runtime-vars-count" title={`${activeGroupCount} usable in requests`}>
                      {groupNames.length} <span>({activeGroupCount})</span>
                    </span>
                    <button
                      type="button"
                      className="runtime-vars-icon runtime-vars-add"
                      aria-label={`New ${label} variable`}
                      title={canAdd ? `Add a variable to ${label}` : 'Select an environment to add variables to it'}
                      disabled={busy || !canAdd}
                      onClick={(event) => {
                        event.preventDefault()
                        startAdd(origin, event.currentTarget.closest('details'))
                      }}
                    >
                      <svg {...icon} strokeWidth={2.5}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                    </button>
                  </div>
                )}
                {groupNames.length === 0 && !isAdding ? (
                  <div className="variables-scope-empty">
                    {query
                      ? 'No matching variables in this scope.'
                      : canAdd
                        ? 'No variables in this scope yet. Use “Add variable” to create one.'
                        : 'Select an environment to view and add its variables.'}
                  </div>
                ) : (
                <div className="runtime-vars-table-wrap">
                <table className="runtime-vars-table">
                  <colgroup>
                    <col className="runtime-vars-col-handle" />
                    <col className="runtime-vars-col-key" />
                    <col className="runtime-vars-col-value" />
                    <col className="runtime-vars-col-status" />
                    <col className="runtime-vars-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th><span className="sr-only">Reorder</span></th>
                      {sortHeader('key', 'Key')}
                      {sortHeader('value', 'Value')}
                      <th>Status</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupNames.map((name, index) => {
                      const definition = filteredByGroup[origin].get(name)!
                      const resolution = resolved[name]
                      const disabled = origin === 'environment' && definition.enabled === false
                      const overriddenBy = !disabled && resolution && resolution.origin !== origin
                        ? SCOPE_GROUPS.find(({ origin: candidate }) => candidate === resolution.origin)?.label
                        : undefined
                      const overrides = !disabled && resolution?.origin === origin ? resolution.shadowed : []
                      const isEditing = editing?.origin === origin && editing.name === name
                      const isDragging = dragging?.origin === origin && dragging.name === name
                      const hint = dropHint?.origin === origin && dropHint.name === name && !isDragging ? dropHint.position : null
                      const handle = (
                        <td className="runtime-vars-handle-cell">
                          <button
                            type="button"
                            className="runtime-vars-handle"
                            draggable={!busy}
                            data-handle={`${origin}:${name}`}
                            aria-label={`Reorder ${name}`}
                            title="Drag to reorder (or focus and use ↑ ↓ Home End)"
                            onDragStart={(event) => handleDragStart(event, origin, name)}
                            onDragEnd={endDrag}
                            onKeyDown={(event) => handleKeyboardMove(event, origin, name)}
                          >
                            <svg {...icon} stroke="none" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                          </button>
                        </td>
                      )
                      const rowProps = {
                        className: [isEditing && 'runtime-vars-editing', isDragging && 'runtime-vars-dragging', hint && `runtime-vars-drop-${hint}`].filter(Boolean).join(' ') || undefined,
                        onDragOver: (event: DragEvent<HTMLTableRowElement>) => handleDragOver(event, origin, name),
                        onDrop: (event: DragEvent) => handleDrop(event, origin),
                      }
                      if (isEditing) {
                        return (
                          <tr key={name} {...rowProps}>
                            {handle}
                            <td>
                              <input className="runtime-vars-input" aria-label={`Key for ${name}`} value={editing.key} disabled={busy} autoFocus
                                onChange={(event) => setEditing({ ...editing, key: event.target.value })}
                                onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') setEditing(null) }} />
                            </td>
                            <td>
                              <input className="runtime-vars-input" aria-label={`Value for ${name}`} value={editing.value} disabled={busy}
                                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                                onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') setEditing(null) }} />
                            </td>
                            <td />
                            <td className="runtime-vars-actions">
                              <button type="button" className="runtime-vars-icon" aria-label={`Save ${name}`} title="Save" disabled={busy} onClick={() => void saveEdit()}>
                                <svg {...icon} strokeWidth={2.5}><path d="M20 6 9 17l-5-5" /></svg>
                              </button>
                              <button type="button" className="runtime-vars-icon" aria-label={`Cancel editing ${name}`} title="Cancel" disabled={busy} onClick={() => setEditing(null)}>
                                <svg {...icon} strokeWidth={2.5}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                              </button>
                            </td>
                          </tr>
                        )
                      }
                      const menuOpen = moveMenu?.origin === origin && moveMenu.name === name
                      return (
                        <tr key={name} {...rowProps} className={`${rowProps.className ?? ''}${overriddenBy ? ' runtime-vars-row-overridden' : ''}${disabled ? ' runtime-vars-row-disabled' : ''}`.trim()}>
                          {handle}
                          <td className="runtime-vars-key" title={name}>
                            <code>{name}</code>
                          </td>
                          <td className="runtime-vars-value" title={definition.value}>{definition.value}</td>
                          <td className="runtime-vars-status">
                            {overriddenBy ? (
                              <span className="runtime-vars-status-badge is-overridden" title={`${overriddenBy} takes precedence in requests.`}>Overridden by {overriddenBy}</span>
                            ) : disabled ? (
                              <span className="runtime-vars-status-badge is-disabled" title="This environment variable is disabled and will not be sent with requests.">Disabled</span>
                            ) : overrides.length > 0 ? (
                              <span className="runtime-vars-status-badge is-winning" title={`This value takes priority over ${overrides.map(describeOrigin).join(' and ')}.`}>Overrides {overrides.map((scope) => SCOPE_GROUPS.find(({ origin: candidate }) => candidate === scope)?.label).join(', ')}</span>
                            ) : (
                              <span className="runtime-vars-status-active">Active</span>
                            )}
                          </td>
                          <td className="runtime-vars-actions">
                            <button type="button" className="runtime-vars-icon" aria-label={`Edit ${name}`} title="Edit" disabled={busy} onClick={() => startEdit(name, origin)}>
                              <svg {...icon}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                            </button>
                            <button type="button" className="runtime-vars-icon runtime-vars-icon-danger" aria-label={`Remove ${name}`} title="Delete" disabled={busy} onClick={() => setPendingRemoval({ name, origin })}>
                              <svg {...icon}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                            </button>
                            <span className="runtime-vars-move">
                              <button type="button" className="runtime-vars-icon runtime-vars-move-trigger" aria-label={`Move ${name}`} title="Move" aria-haspopup="menu" aria-expanded={menuOpen}
                                onClick={() => setMoveMenu(menuOpen ? null : { origin, name })}>
                                <svg {...icon} stroke="none" fill="currentColor"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                              </button>
                              {menuOpen && (
                                <span className="runtime-vars-move-menu" role="menu" aria-label={`Move ${name}`} onKeyDown={(event) => { if (event.key === 'Escape') setMoveMenu(null) }}>
                                  {MOVE_OPTIONS.map(({ target, label: optionLabel }) => {
                                    const atStart = index === 0
                                    const atEnd = index === groupNames.length - 1
                                    const disabled = ((target === 'top' || target === 'up') && atStart) || ((target === 'bottom' || target === 'down') && atEnd)
                                    return (
                                      <button type="button" role="menuitem" key={target} disabled={disabled}
                                        onClick={() => { move(origin, name, target); setMoveMenu(null) }}>
                                        {optionLabel}
                                      </button>
                                    )
                                  })}
                                </span>
                              )}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                    {addRow}
                  </tbody>
                </table>
                </div>
                )}
              </div>
            )
          })}
        {!standalone && shadowed.length > 0 && (
          <p className="runtime-vars-note" role="status">
            {`${shadowed.length === 1 ? 'One name is' : `${shadowed.length} names are`} defined more than once: ${shadowed.join(', ')}. The narrower definition is used.`}
          </p>
        )}
        {!standalone && (
          <p className="runtime-vars-note">
            {`Order of preference: your own variables, then ${hasEnvironment ? 'the selected environment' : 'the selected environment (none selected)'}, then global ones. Yours are private to your account; global ones are shared with everyone signed in.`}
          </p>
        )}
      </div>
      {pendingRemoval && (
        <ConfirmDialog
          title={`Delete “${pendingRemoval.name}”?`}
          message={`It will be removed from ${pendingRemoval.origin === 'environment' ? 'the selected environment (shared with your team)' : pendingRemoval.origin === 'global' ? 'global variables (shared with everyone)' : 'your variables'}. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove(pendingRemoval.name, pendingRemoval.origin)}
          onCancel={cancelRemoval}
        />
      )}
    </details>
  )
}
