import { useEffect, useId, useRef } from 'react'

import { Button } from '@/components/ui/button'
import type { WorkspaceItem } from '@/lib/workspace-types'
import { methodLabel, sortTreeItems } from '@/lib/workspace-ui'

interface RunConfirmDialogProps {
  kind: 'collection' | 'folder'
  name: string
  items: WorkspaceItem[]
  onConfirm: () => void
  onCancel: () => void
}

export function countRequests(items: WorkspaceItem[]): number {
  return items.reduce((total, item) => total + (item.type === 'request' ? 1 : countRequests(item.items)), 0)
}

function RunTree({ items }: { items: WorkspaceItem[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, paddingLeft: 16 }}>
      {sortTreeItems(items).map((item) => (
        <li key={item.id} style={{ margin: '3px 0' }}>
          {item.type === 'folder' ? (
            <>
              <strong>📁 {item.name}</strong>
              {item.items.length > 0 && <RunTree items={item.items} />}
            </>
          ) : (
            <span>
              <span className={`tree-method method-${item.method.toLowerCase()}`}>{methodLabel(item.method)}</span> {item.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function RunConfirmDialog({ kind, name, items, onConfirm, onCancel }: RunConfirmDialogProps) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const total = countRequests(items)

  useEffect(() => {
    cancelRef.current?.focus()
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', cancelOnEscape)
    return () => document.removeEventListener('keydown', cancelOnEscape)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="restore-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-heading">
          <div>
            <h2 id={titleId}>{kind === 'collection' ? 'Run collection?' : 'Run folder?'}</h2>
            <p>
              {total === 1 ? '1 request' : `${total} requests`} in “{name}” will be run in this order. Do you want to continue?
            </p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>
        <div style={{ maxHeight: '45vh', overflow: 'auto', margin: '12px 0' }} data-testid="run-confirm-tree">
          {total === 0 ? <p>There are no requests to run.</p> : <RunTree items={items} />}
        </div>
        <footer className="modal-actions">
          <Button ref={cancelRef} variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} disabled={total === 0}>Run</Button>
        </footer>
      </section>
    </div>
  )
}
