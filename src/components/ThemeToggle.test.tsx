import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ThemeToggle } from '@/components/ThemeToggle'
import { setTheme } from '@/lib/theme-storage'

describe('ThemeToggle', () => {
  beforeEach(() => {
    setTheme('light')
    window.localStorage.clear()
  })

  afterEach(() => {
    setTheme('light')
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('switches themes and remembers the selection', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const toggle = screen.getByRole('button', { name: 'Switch to dark mode' })
    await user.click(toggle)

    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('play-next-api-workspace.theme.v1')).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }))

    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toHaveAttribute('aria-pressed', 'false')
    expect(window.localStorage.getItem('play-next-api-workspace.theme.v1')).toBe('light')
  })
})
