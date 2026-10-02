import { describe, expect, it } from 'vitest'

import { DISCARD_SHORTCUT, matchesShortcut, SAVE_SHORTCUT, shortcutLabel } from '@/lib/shortcuts'

function key(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', init)
}

describe('platform shortcuts', () => {
  it('uses ⌘ on Apple devices and ignores Ctrl there', () => {
    expect(matchesShortcut(key({ key: 's', metaKey: true }), SAVE_SHORTCUT, true)).toBe(true)
    expect(matchesShortcut(key({ key: 's', ctrlKey: true }), SAVE_SHORTCUT, true)).toBe(false)
  })

  it('uses Ctrl elsewhere and ignores the Windows/Meta key', () => {
    expect(matchesShortcut(key({ key: 's', ctrlKey: true }), SAVE_SHORTCUT, false)).toBe(true)
    expect(matchesShortcut(key({ key: 's', metaKey: true }), SAVE_SHORTCUT, false)).toBe(false)
  })

  it('requires Shift exactly when the shortcut asks for it', () => {
    expect(matchesShortcut(key({ key: 'Backspace', ctrlKey: true, shiftKey: true }), DISCARD_SHORTCUT, false)).toBe(true)
    expect(matchesShortcut(key({ key: 'Backspace', ctrlKey: true }), DISCARD_SHORTCUT, false)).toBe(false)
    expect(matchesShortcut(key({ key: 'S', ctrlKey: true, shiftKey: true }), SAVE_SHORTCUT, false)).toBe(false)
    expect(matchesShortcut(key({ key: 's', ctrlKey: true, altKey: true }), SAVE_SHORTCUT, false)).toBe(false)
  })

  it('labels shortcuts in each platform’s own notation', () => {
    expect(shortcutLabel(SAVE_SHORTCUT, true)).toBe('⌘S')
    expect(shortcutLabel(DISCARD_SHORTCUT, true)).toBe('⇧⌘⌫')
    expect(shortcutLabel(SAVE_SHORTCUT, false)).toBe('Ctrl+S')
    expect(shortcutLabel(DISCARD_SHORTCUT, false)).toBe('Ctrl+Shift+Backspace')
  })
})
