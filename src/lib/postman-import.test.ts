import { describe, expect, it } from 'vitest'

import authScriptsRaw from '@/lib/__fixtures__/postman/auth-scripts.json?raw'
import caseConflictFoldersRaw from '@/lib/__fixtures__/postman/case-conflict-folders.json?raw'
import graphqlExampleRaw from '@/lib/__fixtures__/postman/graphql-example.json?raw'
import httpbinNestedRaw from '@/lib/__fixtures__/postman/httpbin-nested.json?raw'
import notPostmanRaw from '@/lib/__fixtures__/postman/not-postman.json?raw'
import { parsePostmanCollection } from '@/lib/postman-import'
import type { TreeNodeInput } from '@/lib/workspace-types'

const authScripts = JSON.parse(authScriptsRaw)
const caseConflictFolders = JSON.parse(caseConflictFoldersRaw)
const graphqlExample = JSON.parse(graphqlExampleRaw)
const httpbinNested = JSON.parse(httpbinNestedRaw)
const notPostman = JSON.parse(notPostmanRaw)

function requestNames(items: TreeNodeInput[]): string[] {
  return items.flatMap((item) => (item.type === 'request' ? [item.name] : requestNames(item.items)))
}

describe('parsePostmanCollection', () => {
  it('rejects a plain object with no info/item shape (non-Postman JSON)', () => {
    const plan = parsePostmanCollection(notPostman)
    expect(plan.errors.length).toBeGreaterThan(0)
    expect(plan.items).toEqual([])
  })

  it('rejects non-object input', () => {
    const plan = parsePostmanCollection('not even an object')
    expect(plan.errors.length).toBeGreaterThan(0)
  })

  it('imports a real flat collection with bearer auth and scripts, disclosing what is dropped', () => {
    // dinhlongvu/fullstack-training-2026 qa/postman/01-auth.postman_collection — a genuine
    // Postman export (not authored by us) with bearer auth, prerequest/test scripts, and a
    // collection-level variable.
    const plan = parsePostmanCollection(authScripts)
    expect(plan.errors).toEqual([])
    expect(plan.name).toBe('MiniProject')
    expect(plan.stats.requests).toBeGreaterThan(0)
    // Bearer auth on every request must be dropped, not silently kept.
    expect(plan.stats.authDropped).toBeGreaterThan(0)
    expect(plan.warnings.some((w) => w.includes('bearer'))).toBe(true)
    // Test/prerequest scripts on every item must be disclosed, not silently dropped.
    expect(plan.stats.scriptsDropped).toBeGreaterThan(0)
    expect(plan.warnings.some((w) => w.toLowerCase().includes('script'))).toBe(true)
    // Collection-level variables are not imported as an Environment; must be disclosed.
    expect(plan.warnings.some((w) => w.toLowerCase().includes('collection-level variable'))).toBe(true)
    // Every imported request must carry auth: none regardless of source auth type.
    for (const item of plan.items) {
      if (item.type === 'request') expect(item.auth).toEqual({ type: 'none' })
    }
    // Bodies with {{variables}} must be preserved verbatim (API never parses body content).
    const register = plan.items.find((item) => item.type === 'request' && item.name === 'Register')
    expect(register && register.type === 'request' ? register.body?.content : undefined).toContain('{{email}}')
  })

  it('imports a real nested-folder collection, dropping unsupported body modes with disclosure', () => {
    // postmanlabs/postman-collection-transformer examples/v2.1.0/httpbin.json — official
    // Postman-owned example with nested folders, raw/formdata/urlencoded bodies, a "headers"
    // (plural, nonstandard) key on one request, and a structured URL with path variables.
    const plan = parsePostmanCollection(httpbinNested)
    expect(plan.errors).toEqual([])
    // The nested "All POST JSON" folder should survive with its child request.
    const names = requestNames(plan.items)
    expect(names).toContain('POST with URL params and JSON')
    // formdata / urlencoded bodies are unsupported; must be dropped with a warning per request.
    expect(plan.stats.bodiesDropped).toBeGreaterThan(0)
    expect(plan.warnings.some((w) => w.includes('formdata'))).toBe(true)
    // The nonstandard plural "headers" key must still be read (defensive leniency).
    const jsonPost = plan.items
      .flatMap(function flatten(item): TreeNodeInput[] { return item.type === 'folder' ? item.items.flatMap(flatten) : [item] })
      .find((item) => item.type === 'request' && item.name === 'POST with URL params and JSON')
    expect(jsonPost && jsonPost.type === 'request' ? jsonPost.headers : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'Content-Type', value: 'application/json' })]),
    )
    // Query params embedded in the raw URL string must be split into the queryParams list.
    expect(jsonPost && jsonPost.type === 'request' ? jsonPost.queryParams : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'random', value: 'yeah' })]),
    )
  })

  it('imports a real GraphQL-body collection, dropping the unsupported graphql body mode', () => {
    // juffalow/express-graphql-example — a genuine, compact real-world file using mode: "graphql".
    const plan = parsePostmanCollection(graphqlExample)
    expect(plan.errors).toEqual([])
    expect(plan.stats.requests).toBe(4)
    expect(plan.stats.bodiesDropped).toBe(4)
    expect(plan.warnings.some((w) => w.includes('graphql'))).toBe(true)
    for (const item of plan.items) {
      if (item.type === 'request') expect(item.body).toBeNull()
    }
  })

  it('renames a case-only-duplicate sibling folder rather than dropping it or failing', () => {
    const plan = parsePostmanCollection(caseConflictFolders)
    expect(plan.errors).toEqual([])
    expect(plan.stats.foldersRenamedForCaseConflict).toBe(1)
    const folderNames = plan.items.filter((item) => item.type === 'folder').map((item) => item.name)
    expect(folderNames).toEqual(['Users', 'users (2)'])
    expect(plan.warnings.some((w) => w.includes('Renamed folder'))).toBe(true)
  })

  it('skips a request with an unsupported HTTP method rather than importing it incorrectly', () => {
    const plan = parsePostmanCollection({
      info: { name: 'Odd methods', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        { name: 'Probe', request: { method: 'OPTIONS', header: [], url: 'https://example.com' } },
        { name: 'Get it', request: { method: 'get', header: [], url: 'https://example.com' } },
      ],
    })
    expect(plan.errors).toEqual([])
    expect(plan.stats.requestsSkippedUnsupportedMethod).toBe(1)
    expect(plan.stats.requests).toBe(1)
    expect(requestNames(plan.items)).toEqual(['Get it'])
  })

  it('flags an undefined-variable-free JSON raw body as importable verbatim, including {{variables}}', () => {
    const plan = parsePostmanCollection({
      info: { name: 'Body test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'Create',
          request: {
            method: 'POST',
            header: [],
            url: '{{baseUrl}}/things',
            body: { mode: 'raw', raw: '{ "name": "{{name}}" }', options: { raw: { language: 'json' } } },
          },
        },
      ],
    })
    expect(plan.errors).toEqual([])
    const request = plan.items[0]
    expect(request.type === 'request' ? request.body : undefined).toEqual({ type: 'json', content: '{ "name": "{{name}}" }' })
  })

  it('discloses that item ordering is not preserved when there is more than one sibling', () => {
    const plan = parsePostmanCollection({
      info: { name: 'Order test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        { name: 'B', request: { method: 'GET', header: [], url: 'https://example.com/b' } },
        { name: 'A', request: { method: 'GET', header: [], url: 'https://example.com/a' } },
      ],
    })
    expect(plan.warnings.some((w) => w.toLowerCase().includes('order'))).toBe(true)
  })

  it('blocks the import when the resulting payload would exceed the practical size limit', () => {
    const bigRaw = 'x'.repeat(999_000) // just under MAX_BODY_LENGTH so it is not itself truncated
    const items = Array.from({ length: 52 }, (_, index) => ({
      name: `Big ${index}`,
      request: { method: 'POST', header: [], url: 'https://example.com', body: { mode: 'raw', raw: bigRaw } },
    }))
    const plan = parsePostmanCollection({
      info: { name: 'Huge', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: items,
    })
    expect(plan.errors.length).toBeGreaterThan(0)
  })

  it('accepts a ~22 MB import that the old 4.5 MB limit rejected', () => {
    const bigRaw = 'x'.repeat(999_000)
    const items = Array.from({ length: 22 }, (_, index) => ({
      name: `Big ${index}`,
      request: { method: 'POST', header: [], url: 'https://example.com', body: { mode: 'raw', raw: bigRaw } },
    }))
    const plan = parsePostmanCollection({
      info: { name: 'Large', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: items,
    })
    expect(plan.approxPayloadBytes).toBeGreaterThan(20_000_000)
    expect(plan.errors).toEqual([])
  })
})
