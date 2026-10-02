import { VARIABLE_PRECEDENCE, type VariableOrigin, type VariableResolution } from '@/lib/variable-scopes'

/** A variable reference containing the caret, whether or not its closing braces are present. */
export interface CompletionContext {
  /** Index of the opening `{{`. */
  from: number
  /** The full name when the reference is closed; otherwise the partial name before the caret. */
  query: string
}

/**
 * Finds the reference being edited at `caret`. When the caret is inside a closed reference, use
 * its full contents for matching; otherwise return the partial name typed before the caret.
 */
export function findCompletionContext(text: string, caret: number): CompletionContext | null {
  const before = text.slice(0, caret)
  const from = before.lastIndexOf('{{')
  if (from < 0) return null
  const typed = before.slice(from + 2)
  if (/[{}\n\r]/.test(typed)) return null

  const after = text.slice(caret)
  const closing = after.indexOf('}}')
  if (closing >= 0) {
    const remaining = after.slice(0, closing)
    if (!/[{}\n\r]/.test(remaining)) return { from, query: `${typed}${remaining}`.trimStart() }
  }

  return { from, query: typed.trimStart() }
}

export interface VariableSuggestion {
  name: string
  value: string
  origin: VariableOrigin
  shadowed: VariableOrigin[]
  /** Where `query` matched inside `name`, for highlighting; -1 when the query is empty. */
  matchIndex: number
}

const MAX_SUGGESTIONS = 50

/**
 * Prefix matches first, then names that merely contain the query, each band ordered by the same
 * precedence the request preparer uses, so the first suggestion is the most likely intended value.
 */
export function suggestVariables(variables: Record<string, VariableResolution>, query: string): VariableSuggestion[] {
  const needle = query.trim().toLowerCase()
  const suggestions: (VariableSuggestion & { rank: number })[] = []
  for (const [name, resolution] of Object.entries(variables)) {
    const matchIndex = needle ? name.toLowerCase().indexOf(needle) : -1
    if (needle && matchIndex < 0) continue
    suggestions.push({
      name,
      value: resolution.value,
      origin: resolution.origin,
      shadowed: resolution.shadowed,
      matchIndex,
      rank: matchIndex === 0 ? 0 : needle ? 1 : 0,
    })
  }
  suggestions.sort((a, b) =>
    a.rank - b.rank
    || VARIABLE_PRECEDENCE.indexOf(a.origin) - VARIABLE_PRECEDENCE.indexOf(b.origin)
    || a.name.localeCompare(b.name))
  return suggestions.slice(0, MAX_SUGGESTIONS).map(({ rank: _rank, ...suggestion }) => suggestion)
}

/**
 * Replaces the partial reference with `{{name}}`. When the caret sits inside an existing reference
 * (e.g. editing `{{bas|eUrl}}`), the rest of that reference is consumed so `}}` is never doubled.
 */
export function applyCompletion(text: string, context: CompletionContext, caret: number, name: string): { value: string; caret: number; to: number; insert: string } {
  const after = text.slice(caret)
  const tail = /^[^{}\s]*\s*\}\}/.exec(after)
  const to = caret + (tail ? tail[0].length : 0)
  const insert = `{{${name}}}`
  return { value: text.slice(0, context.from) + insert + text.slice(to), caret: context.from + insert.length, to, insert }
}

const SECRET_NAME = /token|secret|password|passwd|pwd|credential|api[-_]?key|private[-_]?key|auth/i

/** Display-only masking for suggestion lists, which are shown to anyone looking at the screen. */
export function previewValue(name: string, value: string): string {
  if (value === '') return '(empty)'
  if (SECRET_NAME.test(name)) return '•'.repeat(Math.min(Math.max(value.length, 8), 16))
  return value
}

export function originLabel(origin: VariableOrigin): string {
  if (origin === 'user') return 'Your variables'
  if (origin === 'global') return 'Team'
  return 'Environment'
}
