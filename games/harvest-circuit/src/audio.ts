/**
 * Procedural SFX with the Web Audio API. Nothing plays until the first user gesture
 * unlocks the AudioContext; if audio is unavailable every call is a silent no-op.
 * Sounds are rate-limited and voice-capped so a row of crops never stacks into noise.
 */

type Ctx = AudioContext;

const MAX_VOICES = 12;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode[] = [];
  private voices = 0;
  private last = new Map<string, number>();
  private failed = false;
  muted = false;
  volume = 0.6;

  /** Create/resume the context. Must be called from a user gesture. */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyVolume();
        const len = Math.floor(this.ctx.sampleRate * 0.6);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.startEngine();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    const g = this.muted ? 0 : this.volume * 0.55;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private can(name: string, gapMs: number): boolean {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return false;
    if (this.voices >= MAX_VOICES) return false;
    const now = performance.now();
    const prev = this.last.get(name) ?? -1e9;
    if (now - prev < gapMs) return false;
    this.last.set(name, now);
    return true;
  }

  private voice(durSec: number): void {
    this.voices++;
    window.setTimeout(() => (this.voices = Math.max(0, this.voices - 1)), durSec * 1000 + 30);
  }

  private tone(freq: number, dur: number, type: OscillatorType, peak: number, when = 0, slideTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, q: number, peak: number, when = 0, type: BiquadFilterType = 'bandpass', sweepTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  private vary(): number {
    return 0.93 + Math.random() * 0.14;
  }

  /** Soft snip: short filtered noise + tiny tick. */
  cut(): void {
    if (!this.can('cut', 55)) return;
    this.voice(0.09);
    const v = this.vary();
    this.noise(0.07, 3200 * v, 1.4, 0.16);
    this.tone(1900 * v, 0.03, 'triangle', 0.035);
  }

  full(): void {
    if (!this.can('full', 400)) return;
    this.voice(0.3);
    this.tone(620, 0.12, 'triangle', 0.08);
    this.tone(465, 0.16, 'triangle', 0.07, 0.1);
  }

  sell(amount: number): void {
    if (!this.can('sell', 120)) return;
    this.voice(0.5);
    const lift = Math.min(1.25, 1 + Math.log10(Math.max(1, amount)) * 0.05) * this.vary();
    this.tone(988 * lift, 0.1, 'triangle', 0.12);
    this.tone(1319 * lift, 0.22, 'triangle', 0.11, 0.075);
    this.noise(0.18, 7000, 0.8, 0.03, 0.06, 'highpass');
  }

  upgrade(): void {
    if (!this.can('upgrade', 80)) return;
    this.voice(0.35);
    const v = this.vary();
    [523, 659, 784].forEach((f, i) => this.tone(f * v, 0.14, 'triangle', 0.09, i * 0.055));
  }

  merge(): void {
    if (!this.can('merge', 200)) return;
    this.voice(0.6);
    this.noise(0.4, 380, 2, 0.1, 0, 'bandpass', 2400);
  }

  mergePop(): void {
    if (!this.can('mergePop', 150)) return;
    this.voice(0.5);
    this.tone(220, 0.12, 'sine', 0.16, 0, 90);
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.07, 0.05 + i * 0.045));
  }

  spawn(): void {
    if (!this.can('spawn', 150)) return;
    this.voice(0.4);
    this.tone(330, 0.1, 'sine', 0.12, 0, 660);
    this.noise(0.12, 900, 1, 0.06, 0.22);
  }

  tap(): void {
    if (!this.can('tap', 90)) return;
    this.voice(0.05);
    this.tone(700 * this.vary(), 0.035, 'sine', 0.035);
  }

  deny(): void {
    if (!this.can('deny', 150)) return;
    this.voice(0.15);
    this.tone(240, 0.1, 'square', 0.03, 0, 180);
  }

  mission(): void {
    if (!this.can('mission', 300)) return;
    this.voice(0.6);
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.07, i * 0.07));
  }

  expand(): void {
    if (!this.can('expand', 300)) return;
    this.voice(0.8);
    this.noise(0.6, 250, 1.5, 0.08, 0, 'bandpass', 1400);
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.08, 0.15 + i * 0.08));
  }

  ui(): void {
    if (!this.can('ui', 60)) return;
    this.voice(0.05);
    this.tone(880, 0.03, 'sine', 0.03);
  }

  private startEngine(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    lp.connect(g).connect(this.master!);
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = 46;
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = 92;
    a.connect(lp);
    b.connect(lp);
    a.start();
    b.start();
    this.engineOsc = [a, b];
    this.engineGain = g;
  }

  /** Low engine hum only while the player is actively driving (0..1). */
  engine(level: number, drive: number): void {
    if (!this.ctx || !this.engineGain) return;
    const t = this.ctx.currentTime;
    const target = this.muted ? 0 : 0.05 * Math.max(0, Math.min(1, level));
    this.engineGain.gain.setTargetAtTime(target, t, 0.12);
    const f = 40 + drive * 12;
    this.engineOsc[0]?.frequency.setTargetAtTime(f, t, 0.2);
    this.engineOsc[1]?.frequency.setTargetAtTime(f * 2.01, t, 0.2);
  }
}
