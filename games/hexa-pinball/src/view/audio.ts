// Every sound is synthesised with WebAudio. Pitches walk a major pentatonic scale,
// and a level-progress offset lifts the whole palette as the table empties.
const PENTA = [0, 2, 4, 7, 9];

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  /** 0..1 level progress, raises base pitch by up to a fifth+octave of steps. */
  progress = 0;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.6;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Frequency of pentatonic step n (C5 = step 0), shifted by progress. */
  penta(step: number): number {
    const s = Math.round(step + this.progress * 5);
    const oct = Math.floor(s / 5);
    const deg = PENTA[((s % 5) + 5) % 5];
    return 523.25 * Math.pow(2, oct + deg / 12);
  }

  private tone(freq: number, dur: number, o: { type?: OscillatorType; vol?: number; slide?: number; delay?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.slide), t0 + dur);
    const v = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, o: { vol?: number; from?: number; to?: number; q?: number; delay?: number; type?: BiquadFilterType } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || this.muted) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1.2;
    f.frequency.setValueAtTime(o.from ?? 800, t0);
    f.frequency.exponentialRampToValueAtTime(o.to ?? o.from ?? 800, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol ?? 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  place(): void {
    this.tone(180, 0.16, { type: 'sine', vol: 0.35, slide: 70 });
    this.noise(0.08, { vol: 0.15, from: 1800, to: 400 });
  }
  pick(): void {
    this.tone(this.penta(2), 0.07, { type: 'triangle', vol: 0.12 });
  }
  drop(): void {
    this.tone(this.penta(-3), 0.08, { type: 'triangle', vol: 0.1, slide: this.penta(-5) });
  }
  tileLand(step: number): void {
    this.tone(this.penta(step), 0.09, { type: 'triangle', vol: 0.16 });
    this.noise(0.03, { vol: 0.06, from: 3000 });
  }
  combo(n: number): void {
    for (let i = 0; i < 3; i++) this.tone(this.penta(n + i * 2), 0.14, { type: 'square', vol: 0.05, delay: i * 0.05 });
  }
  compress(step: number): void {
    this.tone(this.penta(step), 0.05, { type: 'square', vol: 0.05 });
  }
  morphPop(): void {
    this.tone(this.penta(5), 0.5, { type: 'sine', vol: 0.3 });
    this.tone(this.penta(9), 0.4, { type: 'triangle', vol: 0.12, delay: 0.02 });
    this.tone(90, 0.25, { type: 'sine', vol: 0.4, slide: 40 });
    this.noise(0.18, { vol: 0.2, from: 5000, to: 900 });
  }
  whoosh(dur: number): void {
    this.noise(dur, { vol: 0.12, from: 300, to: 2600, q: 3 });
    this.tone(this.penta(0), dur, { type: 'sine', vol: 0.05, slide: this.penta(7) });
  }
  plungePull(): void {
    this.tone(120, 0.2, { type: 'sawtooth', vol: 0.04, slide: 70 });
  }
  plunge(): void {
    this.tone(70, 0.22, { type: 'sine', vol: 0.5, slide: 40 });
    this.noise(0.14, { vol: 0.25, from: 900, to: 200, type: 'lowpass' });
    this.tone(this.penta(7), 0.12, { type: 'square', vol: 0.04, delay: 0.03 });
  }
  hitSame(streak: number): void {
    this.tone(this.penta(streak + 2), 0.12, { type: 'square', vol: 0.09 });
    this.tone(this.penta(streak + 4), 0.1, { type: 'sine', vol: 0.12, delay: 0.015 });
  }
  hitWrong(): void {
    this.tone(260, 0.05, { type: 'triangle', vol: 0.06, slide: 200 });
  }
  bumper(): void {
    this.tone(this.penta(-2), 0.1, { type: 'square', vol: 0.06, slide: this.penta(3) });
  }
  sling(): void {
    this.tone(this.penta(-4), 0.06, { type: 'triangle', vol: 0.06 });
  }
  groupClear(): void {
    for (let i = 0; i < 6; i++) this.tone(this.penta(i * 2), 0.3, { type: 'triangle', vol: 0.14, delay: i * 0.055 });
    this.noise(0.5, { vol: 0.22, from: 6000, to: 500 });
    this.tone(60, 0.4, { type: 'sine', vol: 0.45, slide: 35 });
  }
  beamLand(): void {
    this.tone(this.penta(10), 0.4, { type: 'sine', vol: 0.18 });
    this.tone(this.penta(12), 0.5, { type: 'sine', vol: 0.12, delay: 0.06 });
    this.noise(0.25, { vol: 0.12, from: 7000, to: 2000, q: 2 });
  }
  wasted(): void {
    this.tone(220, 0.25, { type: 'triangle', vol: 0.08, slide: 160 });
  }
  win(): void {
    const seq = [0, 2, 4, 5, 7, 10];
    seq.forEach((s, i) => this.tone(this.penta(s), 0.35, { type: 'triangle', vol: 0.16, delay: i * 0.09 }));
    this.tone(this.penta(10), 0.9, { type: 'sine', vol: 0.18, delay: 0.55 });
  }
  lose(): void {
    [4, 2, 0, -3].forEach((s, i) => this.tone(this.penta(s - 5), 0.4, { type: 'triangle', vol: 0.15, delay: i * 0.16 }));
  }
  ui(): void {
    this.tone(this.penta(4), 0.06, { type: 'square', vol: 0.06 });
  }
}

export function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* haptics are optional */
  }
}
