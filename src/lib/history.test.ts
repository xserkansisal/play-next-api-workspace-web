import { afterEach, describe, expect, it } from 'vitest'

import { appendHistoryEntry, clearHistory, loadHistory } from '@/lib/history'

describe('request history (browser-local, per-browser)', () => {
  afterEach(() => {
    clearHistory()
  })

  it('starts empty and records a new entry with a generated id', () => {
    expect(loadHistory()).toEqual([])
    const entries = appendHistoryEntry({ sentAt: '2026-09-29T10:00:00.000Z', method: 'GET', url: 'http://localhost:3000/health', status: 200, statusText: 'OK', durationMs: 12, sizeBytes: 20 })
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toEqual(expect.any(String))
    expect(loadHistory()).toHaveLength(1)
  })

  it('keeps only the most recent 50 entries', () => {
    for (let i = 0; i < 55; i += 1) {
      appendHistoryEntry({ sentAt: new Date(i).toISOString(), method: 'GET', url: `http://localhost:3000/${i}` })
    }
    const entries = loadHistory()
    expect(entries).toHaveLength(50)
    expect(entries[0].url).toBe('http://localhost:3000/54')
  })

  it('truncates request/response body previews and never stores the raw headers', () => {
    const longBody = 'x'.repeat(2000)
    const entries = appendHistoryEntry({
      sentAt: '2026-09-29T10:00:00.000Z',
      method: 'POST',
      url: 'http://localhost:3000/users',
      requestBody: longBody,
      responseBody: longBody,
    })
    expect(entries[0].requestBodyPreview?.length).toBeLessThan(longBody.length)
    expect(entries[0].responseBodyPreview?.length).toBeLessThan(longBody.length)
    expect(entries[0]).not.toHaveProperty('headers')
  })

  it('clears all history', () => {
    appendHistoryEntry({ sentAt: '2026-09-29T10:00:00.000Z', method: 'GET', url: 'http://localhost:3000/health' })
    clearHistory()
    expect(loadHistory()).toEqual([])
  })
})
