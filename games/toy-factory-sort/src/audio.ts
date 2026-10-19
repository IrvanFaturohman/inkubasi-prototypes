// WebAudio synthesised sound, no files. Unlocked on the first touch.
// Pitch is pentatonic: machine slots stack into a chord (1 part = single note,
// 2 parts = unfinished dyad, 3 parts = full triad), and the root climbs with
// shift progress.

const PENTA = [0, 2, 4, 7, 9];
const BASE = 261.63; // C4

export function note(step: number): number {
  const oct = Math.floor(step / 5);
  const semi = PENTA[((step % 5) + 5) % 5] + oct * 12;
  return BASE * Math.pow(2, semi / 12);
}

interface ToneOpt {
  type?: OscillatorType;
  vol?: number;
  at?: number;
  slide?: number;
  attack?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 4;
        const out = ctx.createGain();
        out.gain.value = 0.55;
        out.connect(comp);
        comp.connect(ctx.destination);
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
        this.out = out;
        this.noiseBuf = buf;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* audio is optional */
    }
  }

  private ready(): AudioContext | null {
    if (this.muted || !this.ctx || !this.out || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  tone(f: number, dur: number, o: ToneOpt = {}) {
    const ctx = this.ready();
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'triangle';
    osc.frequency.setValueAtTime(f, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.18;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.out!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  noise(dur: number, freq: number, o: { vol?: number; at?: number; slide?: number; q?: number } = {}) {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = o.q ?? 1.2;
    f.frequency.setValueAtTime(freq, t0);
    if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol ?? 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.out!);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.03);
  }

  // --- events ---------------------------------------------------------
  gate() {
    this.noise(0.04, 2600, { vol: 0.14, q: 3 });
    this.tone(540, 0.05, { type: 'square', vol: 0.05 });
  }
  land(soft = false) {
    this.tone(soft ? 120 : 160, 0.09, { type: 'sine', vol: soft ? 0.12 : 0.22, slide: 70 });
    this.noise(0.05, 900, { vol: 0.06 });
  }
  suck() {
    this.noise(0.2, 500, { vol: 0.16, slide: 3200, q: 2.5 });
  }
  slot(root: number, filled: number) {
    const steps = [root, root + 2, root + 4].slice(0, filled);
    steps.forEach((s, i) => {
      const last = i === steps.length - 1;
      this.tone(note(s), last ? 0.5 : 0.35, { type: 'triangle', vol: last ? 0.13 : 0.07, at: last ? 0.06 : 0 });
    });
  }
  press() {
    for (let i = 0; i < 7; i++) this.tone(75, 0.06, { type: 'square', vol: 0.06, at: i * 0.13 });
    this.tone(95, 0.2, { type: 'sine', vol: 0.3, slide: 45, at: 0.05 });
    this.noise(0.14, 380, { vol: 0.18, at: 0.05 });
  }
  burst(root: number, combo: number) {
    this.tone(260, 0.1, { type: 'sine', vol: 0.25, slide: 980 });
    this.noise(0.12, 1800, { vol: 0.12, slide: 5000 });
    const n = 3 + Math.min(combo, 4);
    for (let k = 0; k < n; k++) {
      this.tone(note(root + 5 + combo + k), 0.22, { type: 'triangle', vol: 0.11, at: 0.04 + k * 0.055 });
    }
  }
  shelf() {
    this.tone(430, 0.07, { type: 'triangle', vol: 0.12 });
    this.tone(200, 0.12, { type: 'sine', vol: 0.18, slide: 120 });
  }
  flip() {
    this.tone(880, 0.05, { type: 'square', vol: 0.04 });
    this.tone(1320, 0.05, { type: 'square', vol: 0.03, at: 0.05 });
  }
  thud() {
    this.tone(90, 0.12, { type: 'sine', vol: 0.12, slide: 55 });
  }
  alarm() {
    this.tone(880, 0.11, { type: 'square', vol: 0.06 });
    this.tone(660, 0.11, { type: 'square', vol: 0.06, at: 0.13 });
  }
  jam() {
    this.tone(220, 0.7, { type: 'sawtooth', vol: 0.16, slide: 50 });
    this.noise(0.5, 300, { vol: 0.25, slide: 90 });
  }
  win() {
    [0, 2, 4, 5, 7, 9, 10].forEach((s, i) => this.tone(note(s + 5), 0.4, { type: 'triangle', vol: 0.12, at: i * 0.08 }));
    [10, 12, 14].forEach((s) => this.tone(note(s), 0.9, { type: 'triangle', vol: 0.08, at: 0.6 }));
  }
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* no haptics */
  }
}
