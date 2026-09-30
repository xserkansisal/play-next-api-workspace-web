import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { JsonTree } from '@/components/JsonTree'

const body = {
  gameData: { version: '1.0', roundOver: false, totalWin: 0 },
  items: [1, 2],
}

/**
 * `vi.spyOn` returns the *existing* mock when the method is already spied, and does not reset its
 * call history — so without clearing, a later test reads the previous test's clipboard writes.
 */
function spyOnClipboard(result: Promise<void> = Promise.resolve()) {
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockReturnValue(result)
  writeText.mockClear()
  return writeText
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
    const writeText = spyOnClipboard()
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Copy path gameData.totalWin' }))
    expect(writeText).toHaveBeenCalledWith('gameData.totalWin')
    // Named as a path, since a row now offers to copy its value too.
    expect(await screen.findByText('Copied path gameData.totalWin')).toBeInTheDocument()
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

describe('filtering a response', () => {
  it('shows only the path to a match', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={body} />)

    await user.type(screen.getByLabelText('Filter response'), 'totalWin')
    expect(screen.getByText('totalWin')).toBeInTheDocument()
    expect(screen.getByText('gameData')).toBeInTheDocument()
    // The branches that hold no match are gone, which is the entire point.
    expect(screen.queryByText('version')).not.toBeInTheDocument()
    expect(screen.queryByText('items')).not.toBeInTheDocument()
  })

  it('reports how many matched, so a filter that found one thing is distinguishable from a lucky guess', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={body} />)

    await user.type(screen.getByLabelText('Filter response'), 'totalWin')
    expect(screen.getByText('1 match')).toBeInTheDocument()
  })

  it('says so when nothing matched, rather than showing a blank area', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={body} />)

    await user.type(screen.getByLabelText('Filter response'), 'nowhere')
    expect(screen.getByText('No key or value matches that.')).toBeInTheDocument()
    expect(screen.getByText('0 matches')).toBeInTheDocument()
  })

  it('opens a branch the user had collapsed, or the match would be filtered to somewhere invisible', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Collapse gameData' }))
    expect(screen.queryByText('totalWin')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter response'), 'totalWin')
    expect(screen.getByText('totalWin')).toBeInTheDocument()
  })

  it('restores what the user had open when the filter is cleared', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Collapse gameData' }))
    const input = screen.getByLabelText('Filter response')
    await user.type(input, 'totalWin')
    await user.clear(input)

    // Still collapsed: the filter's expansion was layered on top, not written into the user's.
    expect(screen.queryByText('totalWin')).not.toBeInTheDocument()
    expect(screen.getByText('3 keys')).toBeInTheDocument()
  })

  it('keeps the real array index on a surviving entry, so the path still addresses the response', async () => {
    const user = userEvent.setup()
    render(<JsonTree value={{ items: [{ win: 0 }, { win: 250 }] }} />)

    await user.type(screen.getByLabelText('Filter response'), '250')
    expect(screen.getByRole('button', { name: 'Copy path items[1].win' })).toBeInTheDocument()
  })

  it('clears the filter when a new response arrives, which the old query may not describe', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<JsonTree value={body} />)
    await user.type(screen.getByLabelText('Filter response'), 'totalWin')

    rerender(<JsonTree value={{ other: 1 }} />)
    expect(screen.getByLabelText('Filter response')).toHaveValue('')
    expect(screen.getByText('other')).toBeInTheDocument()
  })
})

describe('copying a response body', () => {
  it('copies the whole body when no filter is active', async () => {
    const user = userEvent.setup()
    const writeText = spyOnClipboard()
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(JSON.parse(writeText.mock.calls[0][0] as string)).toEqual(body)
    expect(await screen.findByText('Copied the response body')).toBeInTheDocument()
  })

  it('copies only the filtered part once a filter is active', async () => {
    const user = userEvent.setup()
    const writeText = spyOnClipboard()
    render(<JsonTree value={body} />)

    await user.type(screen.getByLabelText('Filter response'), 'totalWin')
    await user.click(screen.getByRole('button', { name: 'Copy filtered' }))
    expect(JSON.parse(writeText.mock.calls[0][0] as string)).toEqual({ gameData: { totalWin: 0 } })
    expect(await screen.findByText('Copied the filtered part')).toBeInTheDocument()
  })

  it('copies the value at a row, pretty-printed', async () => {
    const user = userEvent.setup()
    const writeText = spyOnClipboard()
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Copy value gameData' }))
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(body.gameData, null, 2))
    expect(await screen.findByText('Copied the value at gameData')).toBeInTheDocument()
  })

  it('copies the value a row really holds, not the part left after filtering', async () => {
    const user = userEvent.setup()
    const writeText = spyOnClipboard()
    render(<JsonTree value={body} />)

    await user.type(screen.getByLabelText('Filter response'), 'totalWin')
    // The row still shows the path `gameData`, and that path resolves to all three keys. Handing
    // back one key under that path would be a fragment that does not match it.
    await user.click(screen.getByRole('button', { name: 'Copy value gameData' }))
    expect(JSON.parse(writeText.mock.calls[0][0] as string)).toEqual(body.gameData)
  })

  it('reports a refused clipboard for a body copy too', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Document is not focused'))
    render(<JsonTree value={body} />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the clipboard')
    expect(screen.queryByText(/^Copied/)).not.toBeInTheDocument()
  })
})
