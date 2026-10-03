export type SoundName = 'click' | 'success' | 'error' | 'notification' | 'complete' | 'pop'

interface Tone {
  frequency: number
  endFrequency?: number
  delay: number
  duration: number
  type: OscillatorType
  peak: number
}

const STORAGE_KEY = 'play-next-api-workspace.sound.v1'
const MASTER_VOLUME = 0.35

const SOUND_PATTERNS: Record<SoundName, Tone[]> = {
  click: [{ frequency: 620, delay: 0, duration: 0.075, type: 'triangle', peak: 0.18 }],
  success: [
    { frequency: 523.25, delay: 0, duration: 0.19, type: 'sine', peak: 0.18 },
    { frequency: 783.99, delay: 0.15, duration: 0.26, type: 'sine', peak: 0.16 },
  ],
  error: [
    { frequency: 330, delay: 0, duration: 0.16, type: 'sine', peak: 0.14 },
    { frequency: 261.63, delay: 0.13, duration: 0.21, type: 'sine', peak: 0.13 },
  ],
  notification: [
    { frequency: 659.25, delay: 0, duration: 0.2, type: 'sine', peak: 0.15 },
    { frequency: 880, delay: 0.16, duration: 0.26, type: 'sine', peak: 0.13 },
  ],
  complete: [
    { frequency: 523.25, delay: 0, duration: 0.17, type: 'sine', peak: 0.15 },
    { frequency: 659.25, delay: 0.12, duration: 0.17, type: 'sine', peak: 0.14 },
    { frequency: 783.99, delay: 0.24, duration: 0.3, type: 'sine', peak: 0.13 },
  ],
  pop: [{ frequency: 740, endFrequency: 360, delay: 0, duration: 0.14, type: 'sine', peak: 0.16 }],
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

let enabled = readEnabled()
let context: AudioContext | null = null
let masterGain: GainNode | null = null
const listeners = new Set<() => void>()
const activeSources = new Set<OscillatorNode>()

export function isSoundEnabled(): boolean {
  return enabled
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setSoundEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  if (!enabled) stopActiveSounds()
  try {
    // The default is stored as nothing, so a future default change can still reach the user.
    if (enabled) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, 'off')
  } catch {
    // The choice still applies for this page load when storage is unavailable.
  }
  listeners.forEach((listener) => listener())
}

function stopActiveSounds(): void {
  for (const source of activeSources) {
    try {
      source.stop()
    } catch {
      activeSources.delete(source)
    }
  }
}

function getContext(): AudioContext | null {
  if (context) return context
  const AudioContextClass = typeof window === 'undefined'
    ? undefined
    : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return null
  try {
    context = new AudioContextClass()
    masterGain = context.createGain()
    masterGain.gain.value = MASTER_VOLUME
    masterGain.connect(context.destination)
  } catch {
    context = null
    masterGain = null
  }
  return context
}

function playTone(audio: AudioContext, output: GainNode, tone: Tone): void {
  const startAt = audio.currentTime + tone.delay
  const oscillator = audio.createOscillator()
  const envelope = audio.createGain()
  oscillator.type = tone.type
  oscillator.frequency.setValueAtTime(tone.frequency, startAt)
  if (tone.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, startAt + tone.duration)
  envelope.gain.setValueAtTime(0.0001, startAt)
  envelope.gain.exponentialRampToValueAtTime(tone.peak, startAt + 0.012)
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration)
  oscillator.connect(envelope)
  envelope.connect(output)
  oscillator.onended = () => activeSources.delete(oscillator)
  activeSources.add(oscillator)
  oscillator.start(startAt)
  oscillator.stop(startAt + tone.duration + 0.01)
}

/**
 * Plays a short interface sound. It never throws and does nothing when sounds are off or the
 * browser has no Web Audio support, so callers can fire it without guarding.
 */
export function playSound(name: SoundName): void {
  if (!enabled) return
  const audio = getContext()
  if (!audio || !masterGain) return
  const output = masterGain
  const play = () => {
    if (!enabled) return
    stopActiveSounds()
    SOUND_PATTERNS[name].forEach((tone) => playTone(audio, output, tone))
  }
  try {
    if (audio.state === 'suspended') {
      // Browsers keep the context suspended until a user gesture; a refused resume stays silent.
      void audio.resume().then(play, () => {})
    } else {
      play()
    }
  } catch {
    // A sound is feedback only; a playback failure must never affect the action behind it.
  }
}
