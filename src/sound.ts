/**
 * Sound for Tend: short synthesized cues, an optional soft ambient bed during
 * a session, and optional spoken announcements so a session can be followed
 * without looking at it. Uses Web Audio and speech synthesis; no audio files.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture (click, entering XR) so later cues can play. */
export function unlockAudio(): void {
  context();
}

function tone(freq: number, start: number, length: number, volume = 0.18, type: OscillatorType = 'sine'): void {
  const ac = context();
  if (!ac) return;
  const t = ac.currentTime + start;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

export const sounds = {
  pickUp: () => tone(660, 0, 0.12, 0.08),
  plant: () => {
    tone(392, 0, 0.25, 0.14);
    tone(523, 0.08, 0.3, 0.12);
  },
  /** Session started. */
  water: () => {
    tone(523, 0, 0.5);
    tone(659, 0.12, 0.5);
    tone(784, 0.24, 0.7);
  },
  /** Halfway through the session. */
  halfway: () => {
    tone(587, 0, 0.6, 0.12);
    tone(784, 0.18, 0.8, 0.12);
  },
  /** Two minutes left. */
  twoMinutes: () => {
    tone(784, 0, 0.35, 0.12);
    tone(784, 0.3, 0.35, 0.12);
  },
  bloom: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 1.1, 0.13));
  },
  wilt: () => {
    tone(392, 0, 0.5, 0.12, 'triangle');
    tone(311, 0.22, 0.8, 0.12, 'triangle');
  },
  select: () => tone(880, 0, 0.08, 0.07),
};

// --- Ambient bed: brown noise through a low-pass filter, like distant rain.

let ambientGain: GainNode | null = null;
let ambientSource: AudioBufferSourceNode | null = null;

export function setAmbient(on: boolean): void {
  const ac = context();
  if (!ac) return;
  if (on && !ambientSource) {
    const length = ac.sampleRate * 4;
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.05, ac.currentTime + 3);
    source.connect(filter).connect(gain).connect(ac.destination);
    source.start();
    ambientSource = source;
    ambientGain = gain;
  } else if (!on && ambientSource && ambientGain) {
    const source = ambientSource;
    ambientGain.gain.cancelScheduledValues(ac.currentTime);
    ambientGain.gain.setValueAtTime(ambientGain.gain.value, ac.currentTime);
    ambientGain.gain.linearRampToValueAtTime(0, ac.currentTime + 1.5);
    source.stop(ac.currentTime + 1.6);
    ambientSource = null;
    ambientGain = null;
  }
}

// --- Spoken cues.

export function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.volume = 0.9;
    synth.speak(utterance);
  } catch {
    // Speech not available in this browser.
  }
}
