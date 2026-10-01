import { describe, expect, it } from 'vitest'

import {
  parseMultipartFields,
  parseUrlEncodedFields,
  serializeMultipart,
  serializeUrlEncodedFields,
} from '@/lib/request-body'

describe('URL-encoded request body fields', () => {
  it('round-trips duplicate keys in row order using URLSearchParams encoding', () => {
    const fields = parseUrlEncodedFields('tag=one&name=Sam%20Lee&tag=two')
    expect(fields).toEqual([
      { key: 'tag', value: 'one' },
      { key: 'name', value: 'Sam Lee' },
      { key: 'tag', value: 'two' },
    ])
    expect(serializeUrlEncodedFields(fields)).toBe('tag=one&name=Sam+Lee&tag=two')
  })
})

describe('multipart request body fields', () => {
  it('parses the stored text-field list and rejects malformed shapes', () => {
    expect(parseMultipartFields('[{"key":"name","value":"Sam","enabled":true}]')).toEqual({
      ok: true,
      fields: [{ key: 'name', value: 'Sam', enabled: true }],
    })
    expect(parseMultipartFields('{')).toEqual({ ok: false, message: 'Multipart fields must be valid JSON.' })
    expect(parseMultipartFields('[{"key":"name","value":"Sam"}]')).toEqual({
      ok: false,
      message: 'Multipart field 1 must have text key/value and a boolean enabled flag.',
    })
  })

  it('escapes quoted names and rejects line breaks that would inject part headers', () => {
    expect(serializeMultipart([{ key: 'a"name', value: 'text', enabled: true }], 'boundary')).toEqual({
      ok: true,
      content: '--boundary\r\nContent-Disposition: form-data; name="a\\"name"\r\n\r\ntext\r\n--boundary--\r\n',
    })
    expect(serializeMultipart([{ key: 'name\r\nX-Injected: yes', value: 'text', enabled: true }], 'boundary')).toEqual({
      ok: false,
      message: 'Multipart field names cannot contain line breaks.',
    })
  })
})
