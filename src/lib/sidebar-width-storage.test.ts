import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  fitSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
} from '@/lib/sidebar-width-storage'

const KEY = 'play-next-api-workspace.sidebar-width.v1'

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('clampSidebarWidth', () => {
  it('keeps a width that is already in range', () => {
    expect(clampSidebarWidth(320)).toBe(320)
  })

  it('pulls a too-narrow width up to the minimum', () => {
    expect(clampSidebarWidth(40)).toBe(MIN_SIDEBAR_WIDTH)
  })

  it('pulls a too-wide width down to the maximum, so the editor keeps room', () => {
    expect(clampSidebarWidth(2000)).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('rounds, because a fractional pixel width serves nobody', () => {
    expect(clampSidebarWidth(320.6)).toBe(321)
  })

  it('falls back to the default for a value that is not a number', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})

describe('loadSidebarWidth', () => {
  it('uses the default when nothing has been stored', () => {
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('reads back a stored width', () => {
    saveSidebarWidth(340)
    expect(loadSidebarWidth()).toBe(340)
  })

  it('clamps on read too, since a stored width can outlive the window it was set in', () => {
    // Written by hand, or dragged on a much wider monitor.
    window.localStorage.setItem(KEY, '1800')
    expect(loadSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('ignores a corrupt value rather than rendering a broken sidebar', () => {
    window.localStorage.setItem(KEY, 'wide please')
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('survives a storage that refuses to be read', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})

describe('saveSidebarWidth', () => {
  it('stores the clamped width, not the raw one', () => {
    saveSidebarWidth(10)
    expect(window.localStorage.getItem(KEY)).toBe(String(MIN_SIDEBAR_WIDTH))
  })

  it('survives a storage that refuses to be written', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveSidebarWidth(300)).not.toThrow()
  })
})

describe('fitSidebarWidth', () => {
  it('leaves a width alone when the window has room for it', () => {
    expect(fitSidebarWidth(380, 1400)).toBe(380)
  })

  it('caps the width on a narrow window, where the stored one would cover the editor', () => {
    // 640 was dragged on a wide monitor; 500px of window must not hand it 640.
    expect(fitSidebarWidth(640, 500)).toBe(300)
  })

  it('never caps below the minimum, since an unusable tree helps nobody', () => {
    expect(fitSidebarWidth(400, 120)).toBe(MIN_SIDEBAR_WIDTH)
  })

  it('does not alter what is stored, so widening the window restores the chosen width', () => {
    saveSidebarWidth(600)
    expect(fitSidebarWidth(loadSidebarWidth(), 500)).toBe(300)
    expect(loadSidebarWidth()).toBe(600)
  })

  it('falls back to the plain clamp when the viewport is unknown', () => {
    expect(fitSidebarWidth(380, 0)).toBe(380)
  })
})
