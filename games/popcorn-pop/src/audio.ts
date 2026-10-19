// ---------------------------------------------------------------------------
// Procedural SFX with the Web Audio API. No audio files.
// The context is created on the first user gesture (autoplay policy).
// If Web Audio is missing, every call is a silent no-op.
// ---------------------------------------------------------------------------

type Ctor = typeof AudioContext;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private lastPop = 0;
  private lastKernel = 0;
  private popsThisWindow = 0;

  /** Call from a pointer/key handler. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC: Ctor | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        // gentle compressor keeps overlapping pops from clipping
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(
    freq: number,
    t0: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    attack = 0.005,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn).connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(t0: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(vol, t0 + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(gn).connect(this.master!);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  /** Short popcorn pop. Pitch varies a little every time. */
  pop(intensity = 1): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    // limit density so fast machines don't turn into white noise
    if (now - this.lastPop < 0.035) return;
    if (now - this.lastPop > 0.25) this.popsThisWindow = 0;
    this.popsThisWindow++;
    this.lastPop = now;
    const soft = this.popsThisWindow > 6 ? 0.6 : 1;
    const p = 0.85 + Math.random() * 0.35;
    this.burst(now, 0.05 + Math.random() * 0.03, 1700 * p, 1.4, 0.55 * intensity * soft);
    this.tone(420 * p, now, 0.07, 'sine', 0.35 * intensity * soft, 140 * p, 0.002);
  }

  kernel(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastKernel < 0.08) return;
    this.lastKernel = now;
    this.tone(2400 + Math.random() * 600, now, 0.025, 'triangle', 0.05, undefined, 0.001);
  }

  click(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(720, ctx.currentTime, 0.06, 'triangle', 0.18, 520, 0.002);
  }

  deny(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(240, t, 0.09, 'square', 0.06, 180);
    this.tone(200, t + 0.08, 0.12, 'square', 0.05, 150);
  }

  sale(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const j = 1 + (Math.random() - 0.5) * 0.04;
    this.tone(1318 * j, t, 0.09, 'square', 0.07);
    this.tone(1760 * j, t + 0.07, 0.28, 'square', 0.07);
    this.tone(2637 * j, t + 0.07, 0.3, 'sine', 0.08);
    this.burst(t + 0.06, 0.18, 7000, 0.8, 0.12, 'highpass');
  }

  upgrade(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.055, 0.16, 'triangle', 0.2));
    this.tone(1568, t + 0.22, 0.25, 'sine', 0.08);
  }

  shake(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) this.burst(t + i * 0.045, 0.04, 2600 + Math.random() * 1400, 2, 0.25);
    this.tone(160, t, 0.25, 'sine', 0.18, 90);
  }

  mission(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.08, 0.2, 'triangle', 0.18));
    this.burst(t + 0.4, 0.3, 8000, 0.7, 0.1, 'highpass');
  }

  fanfare(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, t + i * 0.07, 0.35, 'triangle', 0.17));
    [523, 659, 784].forEach((f) => this.tone(f, t + 0.45, 0.6, 'sine', 0.1));
  }
}

export const sfx = new Sfx();
