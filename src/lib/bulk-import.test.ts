import { describe, expect, it } from 'vitest'

import {
  BulkImportFileError,
  MAX_BULK_IMPORT_DEPTH,
  MAX_BULK_IMPORT_FILE_BYTES,
  MAX_BULK_IMPORT_NODES,
  parseBulkImportFile,
  validateBulkImportDestinationDepth,
  validateBulkImportFileSize,
} from '@/lib/bulk-import'

const request = (name: string) => ({
  type: 'request',
  name,
  method: 'GET',
  url: '{{baseUrl}}/health',
})

describe('parseBulkImportFile', () => {
  it('normalizes valid nodes and defaults onConflict to rename', () => {
    const parsed = parseBulkImportFile(JSON.stringify({
      items: [{
        type: 'folder',
        name: ' Auth ',
        items: [request('Login')],
      }],
    }))

    expect(parsed.onConflict).toBe('rename')
    expect(parsed.folders).toBe(1)
    expect(parsed.requests).toBe(1)
    expect(parsed.maxDepth).toBe(2)
    expect(parsed.items).toEqual([{
      type: 'folder',
      name: 'Auth',
      description: '',
      items: [{
        type: 'request',
        name: 'Login',
        description: '',
        method: 'GET',
        url: '{{baseUrl}}/health',
        queryParams: [],
        headers: [],
        body: null,
        auth: { type: 'none' },
      }],
    }])
  })

  it('accepts only rename and fail conflict policies', () => {
    expect(parseBulkImportFile(JSON.stringify({ onConflict: 'fail', items: [request('Health')] })).onConflict).toBe('fail')
    expect(() => parseBulkImportFile(JSON.stringify({ onConflict: 'merge', items: [request('Health')] }))).toThrow('"rename" or "fail"')
  })

  it('rejects duplicate sibling folder names case-insensitively but allows repeated request names', () => {
    expect(() => parseBulkImportFile(JSON.stringify({
      items: [{ type: 'folder', name: 'Parent', items: [{ type: 'folder', name: 'Auth' }, { type: 'folder', name: 'auth' }] }],
    }))).toThrow('Sibling folders cannot share the name')
    expect(() => parseBulkImportFile(JSON.stringify({
      items: [request('Health'), request('Health')],
    }))).not.toThrow()
    expect(() => parseBulkImportFile(JSON.stringify({
      items: [{ type: 'folder', name: 'Auth' }, { type: 'folder', name: 'Auth' }],
    }))).not.toThrow()
  })

  it('rejects malformed JSON, empty trees and unsupported fields', () => {
    expect(() => parseBulkImportFile('{')).toThrow('not valid JSON')
    expect(() => parseBulkImportFile(JSON.stringify({ items: [] }))).toThrow('at least one item')
    expect(() => parseBulkImportFile(JSON.stringify({ items: [request('Health')], extra: true }))).toThrow('unsupported field')
  })

  it('enforces the backend node and nesting limits before recursive parsing', () => {
    const tooMany = Array.from({ length: MAX_BULK_IMPORT_NODES + 1 }, (_, index) => request(`Request ${index}`))
    expect(() => parseBulkImportFile(JSON.stringify({ items: tooMany }))).toThrow('at most 2,000 items')

    let nested: object = request('Leaf')
    for (let depth = 0; depth < MAX_BULK_IMPORT_DEPTH; depth += 1) {
      nested = { type: 'folder', name: `Folder ${depth}`, items: [nested] }
    }
    expect(() => parseBulkImportFile(JSON.stringify({ items: [nested] }))).toThrow('nested at most 32 levels')
  })

  it('rejects invalid request methods and duplicate nested folders', () => {
    expect(() => parseBulkImportFile(JSON.stringify({ items: [{ ...request('Head'), method: 'HEAD' }] }))).toThrow('method must be GET')
    expect(() => parseBulkImportFile(JSON.stringify({
      items: [{ type: 'folder', name: 'Parent', items: [{ type: 'folder', name: 'Child' }, { type: 'folder', name: 'child' }] }],
    }))).toThrow('Sibling folders cannot share the name')
  })

  it('preserves every supported body type and content verbatim', () => {
    const bodies = [
      { type: 'json', content: '{"name":"{{name}}"}' },
      { type: 'form-urlencoded', content: 'tag=one&tag=two' },
      { type: 'multipart', content: '[{"key":"fileName","value":"text only","enabled":true}]' },
      { type: 'raw', content: '<note>hello</note>' },
      { type: 'graphql', content: '{"query":"query { status }"}' },
    ]
    const parsed = parseBulkImportFile(JSON.stringify({
      items: bodies.map((body, index) => ({ ...request(`Request ${index}`), body })),
    }))
    expect(parsed.items.map((item) => item.type === 'request' ? item.body : null)).toEqual(bodies)
  })

  it('rejects unsupported request body types', () => {
    expect(() => parseBulkImportFile(JSON.stringify({
      items: [{ ...request('Request'), body: { type: 'binary', content: 'bytes' } }],
    }))).toThrow('body type must be json, form-urlencoded, multipart, raw, or graphql')
  })
})

describe('bulk import limits', () => {
  it('rejects files at or above the 10 MB limit', () => {
    expect(() => validateBulkImportFileSize(MAX_BULK_IMPORT_FILE_BYTES)).toThrow('smaller than 10 MB')
    expect(() => validateBulkImportFileSize(MAX_BULK_IMPORT_FILE_BYTES - 1)).not.toThrow()
  })

  it('counts the destination folder depth toward the 32-level maximum', () => {
    expect(() => validateBulkImportDestinationDepth(31, 1)).not.toThrow()
    expect(() => validateBulkImportDestinationDepth(31, 2)).toThrow(BulkImportFileError)
  })
})
