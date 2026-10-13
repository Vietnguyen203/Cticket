/** A short high beep (in) or a long low one (refused), plus a vibration on phones. */
let audio: AudioContext | null = null

export function signal(ok: boolean): void {
  try {
    audio ??= new AudioContext()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.frequency.value = ok ? 1320 : 220
    gain.gain.value = 0.15
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + (ok ? 0.12 : 0.45))
  } catch {
    // no sound available: the screen colour is enough
  }
  navigator.vibrate?.(ok ? 80 : [200, 100, 200])
}

const GATE_KEY = 'etp-gate'

/** The gate name of this device ("Cổng A"), remembered on it (a convenience, not a secret). */
export function savedGate(): string {
  try {
    return localStorage.getItem(GATE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveGate(name: string): void {
  try {
    localStorage.setItem(GATE_KEY, name)
  } catch {
    // storage blocked: asked again next time
  }
}
