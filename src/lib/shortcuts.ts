/**
 * Keyboard shortcuts follow the platform convention: ⌘ on Apple devices, Ctrl everywhere else.
 * Only that one modifier is accepted, so e.g. Ctrl+Shift+Backspace on a Mac (or Win+S on Windows)
 * never triggers an action the user did not mean to ask for.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export interface Shortcut {
  key: string
  shift?: boolean
}

export const SAVE_SHORTCUT: Shortcut = { key: 's' }
export const DISCARD_SHORTCUT: Shortcut = { key: 'Backspace', shift: true }

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut, apple = isApplePlatform()): boolean {
  const primary = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return primary
    && !event.altKey
    && event.shiftKey === !!shortcut.shift
    && event.key.toLowerCase() === shortcut.key.toLowerCase()
}

export function shortcutLabel(shortcut: Shortcut, apple = isApplePlatform()): string {
  const key = shortcut.key === 'Backspace' ? (apple ? '⌫' : 'Backspace') : shortcut.key.toUpperCase()
  if (apple) return `${shortcut.shift ? '⇧' : ''}⌘${key}`
  return ['Ctrl', ...(shortcut.shift ? ['Shift'] : []), key].join('+')
}
