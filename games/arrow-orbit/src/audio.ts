// WebAudio synth, no samples. Impacts are low thumps with a 150 -> 42 Hz drop so they
// still read on phone speakers; everything else is a short sound from the real object
// (clicker tick, bowstring twang, wood crack, trampoline boing).
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode } | null = null;
  muted = false;

  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 1.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.startWind();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private get ok(): boolean {
    return !!this.ctx && !!this.master && !this.muted && this.ctx.state === 'running';
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private osc(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, peak, 0.004, dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(type: BiquadFilterType, freq: number, q: number, dur: number, peak: number, sweepTo?: number, delay = 0): void {
    if (!this.ok || !this.noise) return;
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, peak, 0.003, dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  /** The core impact: thumpy sine 150 -> 42 Hz plus a dull noise slap. */
  thump(strength: number): void {
    const s = Math.min(1, Math.max(0.15, strength));
    this.osc('sine', 150, 42, 0.16 + 0.14 * s, 0.55 + 0.45 * s);
    this.osc('triangle', 95, 38, 0.12, 0.25 * s);
    this.burst('lowpass', 900, 0.7, 0.07 + 0.05 * s, 0.35 * s);
  }

  /** Wood crack; combo raises the pitch a semitone-ish per hit. */
  smash(combo: number, barrel: boolean): void {
    const up = Math.pow(1.06, Math.min(combo, 14));
    if (barrel) {
      this.osc('sine', 230 * up, 90 * up, 0.18, 0.45);
      this.osc('square', 460 * up, 300 * up, 0.05, 0.08);
    } else {
      this.burst('bandpass', 1700 * up, 1.6, 0.06, 0.6);
      this.osc('triangle', 320 * up, 140 * up, 0.07, 0.3);
    }
    this.osc('sine', 150, 42, 0.12, 0.35);
  }

  clickerTick(): void {
    this.osc('square', 3400, 2600, 0.018, 0.12);
    this.burst('highpass', 5000, 0.8, 0.02, 0.2);
  }

  /** Bowstring twang + whoosh on release. */
  twang(power: number): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(118, t);
    o.frequency.exponentialRampToValueAtTime(96, t + 0.4);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.4);
    const g = c.createGain();
    this.env(g, t, 0.35, 0.003, 0.45);
    o.connect(f).connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.5);
    this.burst('bandpass', 500, 1.2, 0.35, 0.25 + 0.3 * power, 2400);
    this.thump(0.35);
  }

  boing(): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(540, t + 0.28);
    const lfo = c.createOscillator();
    lfo.frequency.value = 22;
    const lg = c.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    const g = c.createGain();
    this.env(g, t, 0.5, 0.005, 0.38);
    o.connect(g).connect(this.master!);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.45);
    lfo.stop(t + 0.45);
    this.thump(0.7);
  }

  whoosh(): void {
    this.burst('bandpass', 2600, 2, 0.28, 0.4, 700);
  }

  /** Head bites into the turf at the end of the run. */
  thunk(): void {
    this.osc('sine', 150, 42, 0.3, 0.9);
    this.burst('lowpass', 600, 1, 0.1, 0.4);
    this.osc('triangle', 600, 380, 0.06, 0.15, 0.02);
  }

  tick(i: number): void {
    this.osc('triangle', 1100 + (i % 8) * 70, 1000, 0.03, 0.12);
  }

  coin(): void {
    this.osc('square', 988, 988, 0.07, 0.12);
    this.osc('square', 1319, 1319, 0.16, 0.12, 0.07);
    this.thump(0.25);
  }

  deny(): void {
    this.osc('square', 92, 80, 0.14, 0.18);
  }

  record(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.osc('triangle', f, f, 0.18, 0.2, i * 0.09));
  }

  private startWind(): void {
    if (!this.ctx || !this.noise || !this.master) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 500;
    filt.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filt).connect(gain).connect(this.master);
    src.start();
    this.wind = { src, gain, filt };
  }

  /** Air rushing past the shaft, follows speed. */
  setWind(speed: number): void {
    if (!this.wind || !this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.muted ? 0 : Math.min(0.22, Math.max(0, (speed - 6) / 260));
    this.wind.gain.gain.setTargetAtTime(v, t, 0.08);
    this.wind.filt.frequency.setTargetAtTime(350 + speed * 18, t, 0.1);
  }
}

export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
