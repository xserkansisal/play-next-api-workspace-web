import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { describeApiError, workspaceApi } from '@/lib/api'
import { removeScopedVariable, saveScopedVariable } from '@/lib/scoped-variables'
import { describeOrigin, shadowedNames, validateVariableName, type VariableOrigin, type VariableResolution } from '@/lib/variable-scopes'
import { mergeVariableOrder, moveVariable, moveVariableBefore, replaceVisibleVariableOrder, type VariableMove } from '@/lib/variable-order'

export function VariablesMenu({ resolved, hasEnvironment }: {
  resolved: Record<string, VariableResolution>
  hasEnvironment: boolean
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
    if (origin === 'environment') return
    setError(null)
    void removeScopedVariable(origin, name).catch((removeError: unknown) => setError(describeApiError(removeError)))
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
      setValues((current) => ({ ...current, [validation.name]: newValue }))
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
                  const label = entry.origin === 'user' ? 'Only me' : entry.origin === 'global' ? 'Everyone' : 'Environment'
                  return (
                    <tr key={name} draggable={orderLoaded} onDragStart={(event) => { setDraggedName(name); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', name) }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        const dragged = draggedName ?? event.dataTransfer.getData('text/plain')
                        if (dragged) void saveOrder(moveVariableBefore(orderedNames, dragged, name))
                        setDraggedName(null)
                      }}
                      onDragEnd={() => setDraggedName(null)}
                      className={draggedName === name ? 'runtime-vars-dragging' : undefined}>
                      <td className="runtime-vars-name" title={name}><code>{`{{${name}}}`}</code></td>
                      <td className="runtime-vars-scope">{label}</td>
                      <td className="runtime-vars-value" title={entry.value}>
                        {entry.origin === 'user'
                          ? <div className="runtime-vars-edit"><input aria-label={`Value for ${name}`} value={values[name] ?? entry.value} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))} /><button type="button" disabled={saving || (values[name] ?? entry.value) === entry.value} onClick={() => void saveValue(name)}>Save</button></div>
                          : <span>{entry.value}</span>}
                      </td>
                      <td className="runtime-vars-actions">
                        <span className="runtime-vars-moves">
                          <button type="button" className="runtime-vars-drag-handle" draggable={orderLoaded} disabled={!orderLoaded} aria-label={`Drag ${name} to reorder`} title="Drag to reorder"
                            onDragStart={(event) => { setDraggedName(name); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', name) }}
                            onDragEnd={() => setDraggedName(null)}>⠿</button>
                          <button type="button" aria-label={`Move ${name} to top`} title="Move to top" disabled={!orderLoaded || index === 0} onClick={() => reorder(name, 'top')}>⇈</button>
                          <button type="button" aria-label={`Move ${name} up`} title="Move up" disabled={!orderLoaded || index === 0} onClick={() => reorder(name, 'up')}>↑</button>
                          <button type="button" aria-label={`Move ${name} down`} title="Move down" disabled={!orderLoaded || index === orderedNames.length - 1} onClick={() => reorder(name, 'down')}>↓</button>
                          <button type="button" aria-label={`Move ${name} to bottom`} title="Move to bottom" disabled={!orderLoaded || index === orderedNames.length - 1} onClick={() => reorder(name, 'bottom')}>⇊</button>
                        </span>
                        {entry.shadowed.length > 0 && <span className="runtime-vars-shadow" title={`Also defined in ${entry.shadowed.map(describeOrigin).join(' and ')}, which this overrides.`}>overrides {entry.shadowed.map(describeOrigin).join(' and ')}</span>}
                        {entry.origin === 'environment'
                          ? <span className="runtime-vars-note-inline">edit in the environment</span>
                          : <button className="link-button" aria-label={`Remove ${name}`} onClick={() => forget(name, entry.origin)}>Remove</button>}
                        <span className="sr-only">Drag rows to reorder; move buttons also work with a keyboard.</span>
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
