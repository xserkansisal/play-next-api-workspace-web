/** Same reference syntax the request preparer substitutes, so what is highlighted is what is sent. */
const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

export type TemplateSegment =
  | { kind: 'text'; text: string; from: number }
  | { kind: 'variable'; text: string; name: string; from: number }

export function tokenizeTemplate(text: string): TemplateSegment[] {
  const segments: TemplateSegment[] = []
  let last = 0
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const from = match.index ?? 0
    if (from > last) segments.push({ kind: 'text', text: text.slice(last, from), from: last })
    segments.push({ kind: 'variable', text: match[0], name: match[1].trim(), from })
    last = from + match[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last), from: last })
  return segments
}

export function variableNames(text: string): string[] {
  return tokenizeTemplate(text).flatMap((segment) => segment.kind === 'variable' ? [segment.name] : [])
}
