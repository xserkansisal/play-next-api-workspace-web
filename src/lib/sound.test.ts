import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'play-next-api-workspace.sound.v1'

function installAudioStub() {
  const oscillators: { start: ReturnType<typeof vi.fn> }[] = []
  class FakeAudioContext {
    currentTime = 0
    state = 'running'
    destination = {}
    createGain() {
      return {
        gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }
    }
    createOscillator() {
      const oscillator = {
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      oscillators.push(oscillator)
      return oscillator
    }
    resume() {
      return Promise.resolve()
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  window.AudioContext = FakeAudioContext as unknown as typeof AudioContext
  return oscillators
}

describe('sound', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is on by default and remembers when it is turned off', async () => {
    const sound = await import('@/lib/sound')
    expect(sound.isSoundEnabled()).toBe(true)
    sound.setSoundEnabled(false)
    expect(window.localStorage.getItem(KEY)).toBe('off')
    vi.resetModules()
    expect((await import('@/lib/sound')).isSoundEnabled()).toBe(false)
  })

  it('stores nothing once turned back on', async () => {
    const sound = await import('@/lib/sound')
    sound.setSoundEnabled(false)
    sound.setSoundEnabled(true)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('plays one oscillator per tone while enabled and none while off', async () => {
    const oscillators = installAudioStub()
    const sound = await import('@/lib/sound')
    sound.playSound('success')
    expect(oscillators).toHaveLength(2)
    sound.setSoundEnabled(false)
    sound.playSound('success')
    expect(oscillators).toHaveLength(2)
  })

  it('does nothing without Web Audio support', async () => {
    const sound = await import('@/lib/sound')
    expect(() => sound.playSound('click')).not.toThrow()
  })
})
