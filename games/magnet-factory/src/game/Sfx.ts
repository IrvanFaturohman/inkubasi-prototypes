import { GameConfig as C } from '../config/GameConfig';

// All sound is synthesised with WebAudio. No audio files.

const PENTA = [0, 2, 4, 7, 9];

/** major pentatonic, i = 0 is base; climbs an octave every 5 steps */
export function pentaFreq(i: number, base = 523.25) {
  const o = Math.floor(i / 5);
  const st = o * 12 + PENTA[((i % 5) + 5) % 5];
  return base * Math.pow(2, st / 12);
}

interface ToneOpts { type?: OscillatorType; vol?: number; attack?: number; slideTo?: number; delay?: number }
interface NoiseOpts { vol?: number; freq?: number; slideTo?: number; q?: number; filter?: BiquadFilterType; delay?: number }

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      const master = ctx.createGain();
      master.gain.value = C.juice.volume;
      master.connect(comp).connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx; this.master = master; this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ready() {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return false;
    this.master.gain.value = C.juice.volume;
    return true;
  }

  tone(freq: number, dur: number, o: ToneOpts = {}) {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + dur);
    const vol = o.vol ?? 0.15;
    const att = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise(dur: number, o: NoiseOpts = {}) {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1200, t0);
    if (o.slideTo) f.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    f.Q.value = o.q ?? 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol ?? 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  // ---------------------------------------------------------------- palette
  unseat() { this.tone(900 + Math.random() * 250, 0.05, { type: 'triangle', vol: 0.05, slideTo: 1500 }); }

  attach(count: number) {
    this.tone(200 + count * 28, 0.07, { type: 'square', vol: 0.06 });
    this.noise(0.035, { vol: 0.16, freq: 3200, q: 2 });
  }

  full() {
    this.tone(150, 0.18, { type: 'square', vol: 0.09, slideTo: 85 });
    this.noise(0.12, { vol: 0.2, freq: 500, filter: 'lowpass' });
  }

  suck() { this.noise(0.13, { vol: 0.07, freq: 700, slideTo: 2600, q: 3 }); }

  deliver(note: number, combo: number) {
    const f = pentaFreq(note);
    this.tone(f, 0.24, { type: 'triangle', vol: 0.2 });
    this.tone(f * 2, 0.12, { type: 'sine', vol: 0.05 + Math.min(0.06, combo * 0.008) });
    this.tone(120, 0.09, { type: 'sine', vol: 0.22, slideTo: 55 });
  }

  purge(note: number) {
    const f = pentaFreq(note);
    this.tone(f, 0.12, { type: 'square', vol: 0.05 });
    this.tone(f * 1.5, 0.1, { type: 'triangle', vol: 0.07 });
  }

  overdrive(note: number) {
    for (let i = 0; i < 6; i++) this.tone(pentaFreq(note + i), 0.16, { type: 'square', vol: 0.06, delay: i * 0.045 });
    this.tone(180, 0.45, { type: 'sawtooth', vol: 0.12, slideTo: 1400 });
    this.noise(0.5, { vol: 0.18, freq: 400, slideTo: 5000, q: 0.8 });
  }

  mismatch() {
    this.tone(155, 0.11, { type: 'square', vol: 0.07 });
    this.tone(130, 0.14, { type: 'square', vol: 0.07, delay: 0.1 });
  }

  reject() { this.tone(360, 0.14, { type: 'sawtooth', vol: 0.06, slideTo: 150 }); }
  returned() { this.tone(240, 0.07, { type: 'sine', vol: 0.12, slideTo: 170 }); }
  drop() { this.tone(520, 0.05, { type: 'sine', vol: 0.04, slideTo: 300 }); }
  land() { this.tone(170, 0.05, { type: 'sine', vol: 0.07, slideTo: 120 }); }

  warn(level: number) {
    if (level >= 2) {
      this.tone(880, 0.09, { type: 'square', vol: 0.07 });
      this.tone(660, 0.09, { type: 'square', vol: 0.07, delay: 0.11 });
    } else this.tone(640, 0.07, { type: 'square', vol: 0.035 });
  }

  fail() {
    this.tone(440, 0.95, { type: 'sawtooth', vol: 0.16, slideTo: 50 });
    this.tone(330, 0.95, { type: 'square', vol: 0.06, slideTo: 40, delay: 0.05 });
    this.noise(0.7, { vol: 0.32, freq: 900, filter: 'lowpass' });
  }

  roundGo() {
    this.tone(pentaFreq(2), 0.1, { vol: 0.12 });
    this.tone(pentaFreq(5), 0.18, { vol: 0.14, delay: 0.1 });
  }

  clear() {
    for (let i = 0; i < 8; i++) this.tone(pentaFreq(i), 0.18, { type: 'triangle', vol: 0.12, delay: i * 0.06 });
    [0, 2, 4].forEach((n) => this.tone(pentaFreq(10 + n), 0.7, { type: 'triangle', vol: 0.08, delay: 0.5 }));
  }

  celebrate(i: number) { this.tone(pentaFreq(5 + (i % 10)), 0.1, { type: 'sine', vol: 0.06 }); }

  won() {
    for (let i = 0; i < 12; i++) this.tone(pentaFreq(i), 0.2, { type: 'triangle', vol: 0.12, delay: i * 0.07 });
    [0, 2, 4, 5].forEach((n) => this.tone(pentaFreq(10 + n), 1.2, { type: 'triangle', vol: 0.07, delay: 0.9 }));
  }
}

export function vibrate(pattern: number | number[]) {
  if (!C.juice.haptics) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch { /* not supported */ }
}
