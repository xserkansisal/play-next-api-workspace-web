import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { describeApiError, workspaceApi } from '@/lib/api'
import { removeScopedVariable, saveScopedVariable, updateScopedVariable } from '@/lib/scoped-variables'
import { describeOrigin, shadowedNames, validateVariableName, type VariableOrigin, type VariableResolution } from '@/lib/variable-scopes'
import { mergeVariableOrder, moveVariable, moveVariableBefore, replaceVisibleVariableOrder, type VariableMove } from '@/lib/variable-order'

type EditingVariable = { origin: VariableOrigin; name: string; key: string; value: string }

export function VariablesMenu({ resolved, hasEnvironment, onEditEnvironmentVariable, onRemoveEnvironmentVariable }: {
  resolved: Record<string, VariableResolution>
  hasEnvironment: boolean
  onEditEnvironmentVariable?: (oldKey: string, newKey: string, value: string) => Promise<void>
  onRemoveEnvironmentVariable?: (name: string) => Promise<void>
}) {
  const names = useMemo(() => Object.keys(resolved), [resolved])
  const [order, setOrder] = useState<string[]>([])
  const [orderLoaded, setOrderLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [draggedName, setDraggedName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<EditingVariable | null>(null)
  const orderWriteQueue = useRef(Promise.resolve())
  const latestOrderWrite = useRef(0)

  useEffect(() => {
    let active = true
    void workspaceApi.variableOrder().then((savedOrder) => {
      if (active) {
        setOrder((current) => mergeVariableOrder(mergeVariableOrder(savedOrder, current), names))
        setOrderLoaded(true)
      }
    }).catch((loadError: unknown) => {
      if (active) {
        setError(describeApiError(loadError))
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    setOrder((current) => mergeVariableOrder(current, names))
    setValues((current) => {
      const next = { ...current }
      for (const [name, entry] of Object.entries(resolved)) {
        if (entry.origin === 'user' && !(name in next)) next[name] = entry.value
      }
      return next
    })
  }, [names, resolved])

  const orderedNames = useMemo(() => {
    const known = mergeVariableOrder(order, names)
    return known.filter((name) => names.includes(name))
  }, [names, order])
  const shadowed = shadowedNames(resolved)

  function saveOrder(next: string[]) {
    const fullOrder = replaceVisibleVariableOrder(order, next, names)
    const previous = order
    const writeId = ++latestOrderWrite.current
    setOrder(fullOrder)
    setError(null)
    orderWriteQueue.current = orderWriteQueue.current.then(async () => {
      try {
        const saved = await workspaceApi.setVariableOrder(fullOrder)
        if (writeId === latestOrderWrite.current) setOrder(mergeVariableOrder(saved, fullOrder))
      } catch (saveError) {
        if (writeId === latestOrderWrite.current) {
          setOrder(previous)
          setError(describeApiError(saveError))
        }
      }
    })
  }

  function reorder(name: string, move: VariableMove) {
    void saveOrder(moveVariable(orderedNames, name, move))
  }

  function forget(name: string, origin: VariableOrigin) {
    const where = origin === 'environment' ? 'the selected environment (shared with your team)' : origin === 'global' ? 'global variables (shared with everyone)' : 'your variables'
    if (!window.confirm(`Delete "${name}" from ${where}?`)) return
    setError(null)
    const action = origin === 'environment'
      ? onRemoveEnvironmentVariable?.(name) ?? Promise.reject(new Error('Environment variable removal is unavailable.'))
      : removeScopedVariable(origin, name)
    void action.catch((removeError: unknown) => setError(describeApiError(removeError)))
    if (editing?.name === name && editing.origin === origin) setEditing(null)
  }

  function startEdit(name: string, origin: VariableOrigin) {
    setError(null)
    setEditing({ origin, name, key: name, value: resolved[name]!.value })
  }

  async function saveEdit() {
    if (!editing) return
    const validation = validateVariableName(editing.key)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    setError(null)
    setSaving(true)
    try {
      if (editing.origin === 'environment') {
        if (!onEditEnvironmentVariable) throw new Error('Environment variable editing is unavailable.')
        await onEditEnvironmentVariable(editing.name, validation.name, editing.value)
      } else {
        await updateScopedVariable(editing.origin, editing.name, validation.name, editing.value)
      }
      setEditing(null)
    } catch (saveError) {
      setError(describeApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function saveValue(name: string) {
    setError(null)
    setSaving(true)
    try {
      await saveScopedVariable('user', name, values[name] ?? '')
    } catch (saveError) {
      setError(describeApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function createVariable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validation = validateVariableName(newName)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await saveScopedVariable('user', validation.name, newValue)
      setNewName('')
      setNewValue('')
      setCreateOpen(false)
    } catch (saveError) {
      setError(describeApiError(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="runtime-vars">
      <summary aria-label={`Variables (${names.length})`}>Variables <span className="runtime-vars-count">{names.length}</span></summary>
      <div className="runtime-vars-panel">
        {error && <p className="extract-error" role="alert">{error}</p>}
        <button type="button" className="link-button runtime-vars-add" onClick={() => { setCreateOpen((open) => !open); setError(null) }}>
          {createOpen ? 'Cancel' : '＋ Add personal variable'}
        </button>
        {createOpen && (
          <form className="runtime-vars-create" aria-label="Create personal variable" onSubmit={(event) => void createVariable(event)}>
            <label>Name<input aria-label="Personal variable name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="token" /></label>
            <label>Value<input aria-label="Personal variable value" value={newValue} onChange={(event) => setNewValue(event.target.value)} /></label>
            <button type="submit" disabled={saving}>Save</button>
          </form>
        )}
        {names.length === 0 ? (
          <p className="runtime-vars-empty">No variables yet. Send a request, then use “Save a value as a variable” on the response to capture one.</p>
        ) : (
          <div className="runtime-vars-table-wrap">
            <table className="runtime-vars-table">
              <thead><tr><th scope="col">Name</th><th scope="col">Scope</th><th scope="col">Value</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {orderedNames.map((name, index) => {
                  const entry = resolved[name]!
                  const origin = entry.origin
                  const label = origin === 'user' ? 'Only me' : origin === 'global' ? 'Everyone' : 'Environment'
                  const isEditing = editing?.origin === origin && editing.name === name
                  return (
                    <tr key={name} draggable={orderLoaded && !isEditing} onDragStart={(event) => { setDraggedName(name); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', name) }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        const dragged = draggedName ?? event.dataTransfer.getData('text/plain')
                        if (dragged) void saveOrder(moveVariableBefore(orderedNames, dragged, name))
                        setDraggedName(null)
                      }}
                      onDragEnd={() => setDraggedName(null)}
                      className={`${draggedName === name ? 'runtime-vars-dragging ' : ''}${isEditing ? 'runtime-vars-editing' : ''}`}>
                      <td className="runtime-vars-name" title={name}>
                        {isEditing
                          ? <input className="runtime-vars-input" aria-label={`Key for ${name}`} value={editing.key} disabled={saving} autoFocus onChange={(event) => setEditing({ ...editing, key: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') setEditing(null) }} />
                          : <code>{`{{${name}}}`}</code>}
                        {!isEditing && entry.shadowed.length > 0 && <span className="runtime-vars-shadow" title={`Also defined in ${entry.shadowed.map(describeOrigin).join(' and ')}, which this overrides.`}>overrides {entry.shadowed.map(describeOrigin).join(' and ')}</span>}
                      </td>
                      <td className="runtime-vars-scope">{label}</td>
                      <td className="runtime-vars-value" title={entry.value}>
                        {isEditing
                          ? <input className="runtime-vars-input" aria-label={`Value for ${name}`} value={editing.value} disabled={saving} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') setEditing(null) }} />
                          : origin === 'user'
                            ? <div className="runtime-vars-edit"><input aria-label={`Value for ${name}`} value={values[name] ?? entry.value} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} /><button type="button" disabled={saving || (values[name] ?? entry.value) === entry.value} onClick={() => void saveValue(name)}>Save</button></div>
                            : <span>{entry.value}</span>}
                      </td>
                      <td className="runtime-vars-actions">
                        {isEditing
                          ? <><button type="button" disabled={saving} onClick={() => void saveEdit()}>Save</button><button type="button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button></>
                          : <>
                            <span className="runtime-vars-moves">
                              <button type="button" className="runtime-vars-drag-handle" draggable={orderLoaded} disabled={!orderLoaded} aria-label={`Drag ${name} to reorder`} title="Drag to reorder" onDragStart={(event) => { setDraggedName(name); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', name) }} onDragEnd={() => setDraggedName(null)}>⠿</button>
                              <button type="button" aria-label={`Move ${name} to top`} title="Move to top" disabled={!orderLoaded || index === 0} onClick={() => reorder(name, 'top')}>⇈</button>
                              <button type="button" aria-label={`Move ${name} up`} title="Move up" disabled={!orderLoaded || index === 0} onClick={() => reorder(name, 'up')}>↑</button>
                              <button type="button" aria-label={`Move ${name} down`} title="Move down" disabled={!orderLoaded || index === orderedNames.length - 1} onClick={() => reorder(name, 'down')}>↓</button>
                              <button type="button" aria-label={`Move ${name} to bottom`} title="Move to bottom" disabled={!orderLoaded || index === orderedNames.length - 1} onClick={() => reorder(name, 'bottom')}>⇊</button>
                            </span>
                            <button type="button" className="link-button" aria-label={`Edit ${name}`} onClick={() => startEdit(name, origin)}>Edit</button>
                            <button className="link-button" aria-label={`Remove ${name}`} onClick={() => forget(name, origin)}>Remove</button>
                          </>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {shadowed.length > 0 && (
          <p className="runtime-vars-note" role="status">
            {`${shadowed.length === 1 ? 'One name is' : `${shadowed.length} names are`} defined more than once: ${shadowed.join(', ')}. The narrower definition is used.`}
          </p>
        )}
        <p className="runtime-vars-note">
          {`Order of preference: your own variables, then ${hasEnvironment ? 'the selected environment' : 'the selected environment (none selected)'}, then global ones. Yours are private to your account; global ones are shared with everyone signed in.`}
        </p>
      </div>
    </details>
  )
}
