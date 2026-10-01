export interface MultipartField {
  key: string
  value: string
  enabled: boolean
}

export interface UrlEncodedField {
  key: string
  value: string
}

export function parseUrlEncodedFields(content: string): UrlEncodedField[] {
  return Array.from(new URLSearchParams(content), ([key, value]) => ({ key, value }))
}

export function serializeUrlEncodedFields(fields: UrlEncodedField[]): string {
  return new URLSearchParams(fields.map(({ key, value }) => [key, value])).toString()
}

export type MultipartParseResult =
  | { ok: true; fields: MultipartField[] }
  | { ok: false; message: string }

export function parseMultipartFields(content: string): MultipartParseResult {
  if (content === '') return { ok: true, fields: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ok: false, message: 'Multipart fields must be valid JSON.' }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: 'Multipart content must be a JSON array of text fields.' }
  }

  const fields: MultipartField[] = []
  for (const [index, row] of parsed.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return { ok: false, message: `Multipart field ${index + 1} must be an object.` }
    }
    const field = row as Record<string, unknown>
    const unexpected = Object.keys(field).find((key) => !['key', 'value', 'enabled'].includes(key))
    if (unexpected) {
      return { ok: false, message: `Multipart field ${index + 1} contains unsupported field "${unexpected}".` }
    }
    if (typeof field.key !== 'string' || typeof field.value !== 'string' || typeof field.enabled !== 'boolean') {
      return { ok: false, message: `Multipart field ${index + 1} must have text key/value and a boolean enabled flag.` }
    }
    fields.push({ key: field.key, value: field.value, enabled: field.enabled })
  }
  return { ok: true, fields }
}

export function serializeMultipart(fields: MultipartField[], boundary: string): { ok: true; content: string } | { ok: false; message: string } {
  const enabledFields = fields.filter((field) => field.enabled)
  if (enabledFields.some(({ key }) => /[\r\n]/.test(key))) {
    return { ok: false, message: 'Multipart field names cannot contain line breaks.' }
  }
  if (enabledFields.some(({ value }) => value.includes(boundary))) {
    return { ok: false, message: 'Multipart field content conflicts with the generated boundary. Send again to generate a new boundary.' }
  }

  const parts = enabledFields.map(({ key, value }) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\r\n\r\n${value}\r\n`,
  )
  return { ok: true, content: `${parts.join('')}--${boundary}--\r\n` }
}
