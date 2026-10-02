import { afterEach, describe, expect, it, vi } from 'vitest'

import { createUuid } from '@/lib/uuid'

describe('createUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'generated-by-crypto' })

    expect(createUuid()).toBe('generated-by-crypto')
  })

  it('creates a UUID v4 using getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0)
        return bytes
      },
    })

    expect(createUuid()).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('creates a UUID v4 when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)

    expect(createUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
