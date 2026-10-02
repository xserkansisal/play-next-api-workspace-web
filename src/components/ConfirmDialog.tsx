import { useEffect, useId, useRef, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Styles the confirm action as irreversible, e.g. discarding or deleting. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** An in-app replacement for `window.confirm`, matching the workspace's other modal dialogs. */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', destructive = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus the safe choice, so a stray Enter cannot confirm an irreversible action.
    cancelRef.current?.focus()
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', cancelOnEscape)
    return () => document.removeEventListener('keydown', cancelOnEscape)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="restore-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
        <header className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={messageId}>{message}</p>
          </div>
          <button aria-label="Close" onClick={onCancel}>×</button>
        </header>
        <footer className="modal-actions">
          <Button ref={cancelRef} variant="outline" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>{confirmLabel}</Button>
        </footer>
      </section>
    </div>
  )
}
