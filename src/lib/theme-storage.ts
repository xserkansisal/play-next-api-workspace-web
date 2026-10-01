export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'play-next-api-workspace.theme.v1'

function readTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

let theme = readTheme()
const listeners = new Set<() => void>()

export function getTheme(): Theme {
  return theme
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyTheme(nextTheme: Theme): void {
  document.documentElement.dataset.theme = nextTheme
}

export function initializeTheme(): void {
  applyTheme(theme)
}

export function setTheme(nextTheme: Theme): void {
  if (nextTheme === theme) return
  theme = nextTheme
  applyTheme(theme)
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // The theme still applies for this page load when storage is unavailable.
  }
  listeners.forEach((listener) => listener())
}
