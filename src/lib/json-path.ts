/**
 * How a child's path is written, shared by the response tree and the capture form's suggestions.
 *
 * These two features have to agree exactly. The tree shows a path so it can be read off and pasted
 * into "Value path"; if the two built paths differently, the pasted one would silently miss.
 *
 * Some keys cannot be expressed at all in this path syntax, so `childPath` returns null for them
 * rather than a string the parser would reject or, worse, misread. Callers are expected to treat a
 * null as "this value has no addressable path" and say so, instead of offering one that fails.
 */

/** Keys that can be written after a dot; anything else needs the bracket-and-quote form. */
const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/

/**
 * `parsePath` reads a bracketed key with `/^"[^"]*"$/` and finds the closing bracket with the first
 * `]`, and it understands no escape sequences. A key containing either character therefore has no
 * representation — not a formatting gap to paper over, but a real limit of the syntax.
 */
const UNREPRESENTABLE_KEY = /["\]]/

export function childPath(prefix: string, key: string): string | null {
  if (PLAIN_KEY.test(key)) return prefix ? `${prefix}.${key}` : key
  if (UNREPRESENTABLE_KEY.test(key)) return null
  return `${prefix}["${key}"]`
}

export function indexPath(prefix: string, index: number): string {
  return `${prefix}[${index}]`
}
