// Remembers how wide the user dragged the sidebar.
//
// Collection and request names are long and deeply nested, and a fixed width truncated them with
// no recourse. The width is a durable preference like the runner choice and the collapsed-node
// set, so it lives in `localStorage` and survives a reload; it records no workspace content.

export const DEFAULT_SIDEBAR_WIDTH = 260
/**
 * Below the minimum the tree stops being usable at all, and past the maximum the editor is the
 * thing that becomes unusable. Clamping on read as well as on write matters: a stored value can
 * come from a wider window, or from a hand-edited entry.
 */
export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 640

const STORAGE_KEY = 'play-next-api-workspace.sidebar-width.v1'

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)))
}

/**
 * The sidebar may never take more than this share of the window. The stored width survives across
 * windows, so a width dragged on a wide monitor would otherwise cover most of a narrow one - and
 * the inline width outranks the responsive stylesheet, so nothing else would hold it back.
 */
export const MAX_SIDEBAR_SHARE = 0.6

/**
 * Applied at render rather than stored: widening the window again should restore the width the
 * user actually chose, not the shrunken one they were temporarily given.
 */
export function fitSidebarWidth(width: number, viewportWidth: number): number {
  const wanted = clampSidebarWidth(width)
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return wanted
  const cap = Math.max(MIN_SIDEBAR_WIDTH, Math.round(viewportWidth * MAX_SIDEBAR_SHARE))
  return Math.min(wanted, cap)
}

export function loadSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_SIDEBAR_WIDTH
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

export function saveSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampSidebarWidth(width)))
  } catch {
    // A full or unavailable store must not break resizing; the width just will not survive.
  }
}
