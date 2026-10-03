import { describe, expect, it } from 'vitest'

import {
  buildSyncApplyInput,
  contentDispositionFileName,
  describeOpenApiWarning,
  emptySyncDecisions,
  fallbackOpenApiFileName,
  readOpenApiFile,
  unresolvedConflictKeys,
  type OpenApiSyncPreview,
} from '@/lib/openapi'

function fileWithText(name: string, text: string) {
  const file = new File([text], name)
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) })
  return file
}

const preview: OpenApiSyncPreview = {
  collectionId: 'c1',
  linked: true,
  source: { title: 'Example', version: '1.0.0' },
  previewToken: 'a'.repeat(64),
  warnings: [],
  changes: [
    { key: 'operationId:adopt', kind: 'adopt', method: 'GET', path: '/a', candidateItemIds: ['r1', 'r2'] },
    { key: 'operationId:conflict', kind: 'conflict', method: 'PUT', path: '/c', itemId: 'r3' },
    { key: 'operationId:gone', kind: 'delete', method: 'DELETE', path: '/d', itemId: 'r4' },
    { key: 'operationId:edited-gone', kind: 'delete-conflict', method: 'DELETE', path: '/e', itemId: 'r5' },
    { key: 'operationId:missing', kind: 'missing', method: 'GET', path: '/m', itemId: 'r6', recreatable: true },
    { key: 'operationId:untrack', kind: 'missing', method: 'GET', path: '/u', itemId: 'r7', recreatable: false },
    { key: 'operationId:same', kind: 'unchanged', method: 'GET', path: '/s', itemId: 'r8' },
  ],
}

describe('readOpenApiFile', () => {
  it('returns the original text untouched', async () => {
    const text = 'openapi: 3.1.0\ninfo:\n  title: Example\n'
    await expect(readOpenApiFile(fileWithText('spec.yaml', text))).resolves.toEqual({ fileName: 'spec.yaml', text })
  })

  it('rejects unsupported extensions and empty files', async () => {
    await expect(readOpenApiFile(fileWithText('spec.txt', 'x'))).rejects.toThrow(/\.json, \.yaml, or \.yml/)
    await expect(readOpenApiFile(fileWithText('spec.json', '  '))).rejects.toThrow(/empty/)
  })

  it('rejects files over 10 MB', async () => {
    const file = fileWithText('big.json', '{}')
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })
    await expect(readOpenApiFile(file)).rejects.toThrow(/10 MB/)
  })
})

describe('export file names', () => {
  it('reads plain and RFC 5987 Content-Disposition filenames', () => {
    expect(contentDispositionFileName('attachment; filename="shop-api-openapi.json"')).toBe('shop-api-openapi.json')
    expect(contentDispositionFileName("attachment; filename=\"x\"; filename*=UTF-8''sh%C3%B6p-openapi.yaml")).toBe('shöp-openapi.yaml')
    expect(contentDispositionFileName('attachment; filename=plain.yaml')).toBe('plain.yaml')
    expect(contentDispositionFileName(undefined)).toBeNull()
  })

  it('falls back to the API naming rule', () => {
    expect(fallbackOpenApiFileName('Shop API v2!', 'yaml')).toBe('shop-api-v2-openapi.yaml')
    expect(fallbackOpenApiFileName('***', 'json')).toBe('collection-openapi.json')
  })
})

describe('describeOpenApiWarning', () => {
  it('describes conversion and bulk header warnings', () => {
    expect(describeOpenApiWarning({ code: 'MULTIPLE_TAGS', method: 'get', path: '/pets', usedTag: 'pets' }))
      .toBe('GET /pets: the operation has several tags. It was placed in the "pets" folder (its first tag).')
    expect(describeOpenApiWarning({ code: 'UNSUPPORTED_BODY', method: 'POST', path: '/upload', mediaType: 'application/xml' }))
      .toContain('"application/xml" body type is not supported')
    expect(describeOpenApiWarning({ code: 'SENSITIVE_HEADER', path: ['Auth', 'Login'], header: 'Authorization' }))
      .toBe('Auth / Login: the Authorization header may contain a sensitive value. Review it before sending.')
  })
})

describe('buildSyncApplyInput', () => {
  it('sends only valid, explicit choices', () => {
    const input = buildSyncApplyInput('spec-text', preview, {
      adopt: { 'operationId:adopt': 'r2', 'operationId:other': 'r9' },
      conflicts: { 'operationId:conflict': 'keep', 'operationId:same': 'spec' },
      deleteItemIds: ['r4', 'r6', 'r7', 'r8'],
      recreate: ['operationId:missing', 'operationId:untrack'],
    })
    expect(input).toEqual({
      spec: 'spec-text',
      previewToken: preview.previewToken,
      adopt: { 'operationId:adopt': 'r2' },
      conflicts: { 'operationId:conflict': 'keep' },
      deleteItemIds: ['r4', 'r7'],
      recreate: ['operationId:missing'],
    })
  })

  it('drops an adoption candidate that is not in the preview', () => {
    const input = buildSyncApplyInput('s', preview, { ...emptySyncDecisions(), adopt: { 'operationId:adopt': 'not-a-candidate' } })
    expect(input.adopt).toEqual({})
    expect(input.deleteItemIds).toEqual([])
    expect(input.recreate).toEqual([])
  })

  it('reports conflicts without a resolution', () => {
    expect(unresolvedConflictKeys(preview, emptySyncDecisions())).toEqual(['operationId:conflict'])
    expect(unresolvedConflictKeys(preview, { ...emptySyncDecisions(), conflicts: { 'operationId:conflict': 'spec' } })).toEqual([])
  })
})
