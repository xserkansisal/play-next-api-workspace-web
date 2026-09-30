import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { JsonTree } from '@/components/JsonTree'

const body = {
  gameData: { version: '1.0', roundOver: false, totalWin: 0 },
  items: [1, 2],
}

const rowText = () =>
  screen.getAllByRole('button', { name: /^(Expand|Collapse) / }).map((button) => button.getAttribute('aria-label'))

describe('JsonTree', () => {
  it('shows the whole body expanded by default, so nothing the pretty-printed view gave is lost', () => {
    render(<JsonTree value={body} />)
    expect(screen.getByText('version')).toBeInTheDocument()
    expect(screen.getByText('"1.0"')).toBeInTheDocument()
    expect(screen.getByText('roundOver')).toBeInTheDocument()
  })

  it('hides a branch when it is collapsed, and brings it back when reopened', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Collapse gameData' }))
    expect(screen.queryByText('version')).not.toBeInTheDocument()
    // The collapsed row still says what is inside, rather than being an opaque brace.
    expect(screen.getByText('3 keys')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand gameData' }))
    expect(screen.getByText('version')).toBeInTheDocument()
  })

  it('collapses and expands everything from the bar', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('version')).not.toBeInTheDocument()
    expect(screen.queryByText('gameData')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('version')).toBeInTheDocument()
    expect(rowText()).toContain('Collapse gameData')
  })

  it('refuses expand-all on a body too large to open at once, instead of freezing', () => {
    const huge = Array.from({ length: 4000 }, (_, index) => ({ index, nested: { a: 1, b: 2, c: 3 } }))
    render(<JsonTree value={huge} />)
    const expandAll = screen.getByRole('button', { name: 'Expand all' })
    expect(expandAll).toBeDisabled()
    expect(expandAll).toHaveAttribute('title', expect.stringContaining('too large'))
  })

  it('opens only the root on such a body, so it is browsable rather than blank', () => {
    const huge = Array.from({ length: 4000 }, (_, index) => ({ index, nested: { a: 1, b: 2, c: 3 } }))
    render(<JsonTree value={huge} />)
    // Top level visible and drillable; nothing below it rendered yet.
    expect(screen.getAllByRole('button', { name: /^Expand \[\d+\]$/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText('nested')).not.toBeInTheDocument()
  })

  it('copies the path of a row, in the form the capture form expects', async () => {
    const user = userEvent.setup()
    // Spied after setup: userEvent installs its own clipboard stub, and it is getter-only.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Copy path gameData.totalWin' }))
    expect(writeText).toHaveBeenCalledWith('gameData.totalWin')
    expect(await screen.findByText('Copied gameData.totalWin')).toBeInTheDocument()
  })

  it('reports a refused clipboard instead of leaving a button that appears to do nothing', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Document is not focused'))
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Copy path gameData.totalWin' }))
    // The path is shown so it can still be selected by hand.
    expect(await screen.findByRole('alert')).toHaveTextContent('gameData.totalWin')
    expect(screen.queryByText(/^Copied/)).not.toBeInTheDocument()
  })

  it('offers no path for a value whose key cannot be expressed, rather than one that would miss', () => {
    render(<JsonTree value={{ 'has"quote': { inner: 1 } }} />)
    expect(screen.getByText('has"quote')).toBeInTheDocument()
    expect(screen.getByText('inner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Copy path/ })).not.toBeInTheDocument()
  })

  it('caps a huge container and reveals the rest on request', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={{ items: Array.from({ length: 205 }, (_, index) => index) }} />)

    const more = screen.getByRole('button', { name: 'Show 5 more' })
    expect(screen.queryByRole('button', { name: 'Copy path items[204]' })).not.toBeInTheDocument()
    await user.click(more)
    expect(screen.getByRole('button', { name: 'Copy path items[204]' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument()
  })

  it('resets expansion when a new response arrives, since old paths may not exist in it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<JsonTree value={body} />)
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('gameData')).not.toBeInTheDocument()

    rerender(<JsonTree value={{ gameData: { version: '2.0' } }} />)
    expect(screen.getByText('"2.0"')).toBeInTheDocument()
  })

  it('renders an empty container without a toggle that would do nothing', () => {
    render(<JsonTree value={{ empty: {} }} />)
    expect(screen.queryByRole('button', { name: /^(Expand|Collapse) empty$/ })).not.toBeInTheDocument()
  })

  it('distinguishes a string from a number that looks like one', () => {
    render(<JsonTree value={{ a: '12', b: 12 }} />)
    const tree = screen.getByRole('tree')
    expect(within(tree).getByText('"12"')).toBeInTheDocument()
    expect(within(tree).getByText('12')).toBeInTheDocument()
  })
})
