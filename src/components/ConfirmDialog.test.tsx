import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from '@/components/ConfirmDialog'

function renderDialog() {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<ConfirmDialog title="Discard?" message="Edits will be lost." confirmLabel="Discard" destructive onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('is an accessible alert dialog that focuses the safe choice', () => {
    renderDialog()
    const dialog = screen.getByRole('alertdialog', { name: 'Discard?' })
    expect(dialog).toHaveAccessibleDescription('Edits will be lost.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('confirms only from the confirm button', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels with Escape, the close button or a backdrop click', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(document.querySelector('.modal-backdrop')!)
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
