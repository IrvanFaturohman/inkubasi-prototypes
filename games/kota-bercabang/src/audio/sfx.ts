import type { MaterialKind } from '../game/types';

/**
 * Synthesizer SFX ringan berbasis Web Audio: osilator pendek + noise terfilter + envelope.
 * - master gain + compressor supaya tumpukan suara tidak pecah,
 * - batas jumlah voice & cooldown per jenis suara agar repetisi tidak bising,
 * - variasi pitch kecil supaya tidak monoton,
 * - aktif hanya setelah gesture pengguna (kebijakan autoplay browser); game tetap jalan tanpa audio.
 */

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];
const MAX_VOICES = 18;

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private voices = 0;
  private last = new Map<string, number>();
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private birdTimer = 6;
  ambience: 'birds' | 'city' | 'none' = 'birds';

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Panggil dari event gesture pengguna (pointerdown/keydown). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 10;
        comp.ratio.value = 4;
        comp.attack.value = 0.004;
        comp.release.value = 0.18;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : 0.6, t, 0.03);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  // ---------------------------------------------------------------------------
  // Primitive
  // ---------------------------------------------------------------------------

  private ok(name: string, cooldownMs: number, priority = 0): boolean {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return false;
    if (this.voices >= MAX_VOICES - priority * 6) return false;
    const now = performance.now();
    const prev = this.last.get(name) ?? -1e9;
    if (now - prev < cooldownMs) return false;
    this.last.set(name, now);
    return true;
  }

  private track(node: AudioScheduledSourceNode): void {
    this.voices++;
    node.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
    };
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, o: { delay?: number; slide?: number; attack?: number; detune?: number } = {}): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    this.track(osc);
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, o: { delay?: number; q?: number; slide?: number; attack?: number } = {}): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
    this.track(src);
  }

  private vary(f: number, amt = 0.04): number {
    return f * (1 + (Math.random() - 0.5) * amt);
  }

  // ---------------------------------------------------------------------------
  // Suara game
  // ---------------------------------------------------------------------------

  produce(m: MaterialKind): void {
    if (!this.ok('produce', 140, 1)) return;
    if (m === 'wood') {
      this.noise(0.05, 0.05, 'bandpass', this.vary(1500, 0.2), { q: 4 });
      this.tone(this.vary(330), 0.07, 'sine', 0.04, { slide: 190 });
    } else {
      this.noise(0.04, 0.045, 'bandpass', this.vary(2800, 0.2), { q: 5 });
      this.tone(this.vary(560), 0.05, 'square', 0.018, { slide: 300 });
    }
  }

  stored(): void {
    if (!this.ok('stored', 220, 1)) return;
    this.tone(this.vary(1900, 0.1), 0.025, 'sine', 0.012);
  }

  pickup(amount: number): void {
    if (!this.ok('pickup', 70)) return;
    const n = Math.min(3, 1 + Math.floor(amount / 8));
    for (let i = 0; i < n; i++) this.tone(this.vary(PENTA[2 + i * 2], 0.02), 0.09, 'triangle', 0.07, { delay: i * 0.055 });
  }

  unload(amount: number, m: MaterialKind): void {
    if (!this.ok('unload', 60)) return;
    const size = 0.55 + Math.min(1, Math.log10(1 + amount) / 1.8);
    this.tone(this.vary(160, 0.06), 0.28 * size + 0.05, 'sine', 0.26 * size, { slide: 52 });
    this.noise(0.16 + 0.06 * size, 0.1 * size, 'lowpass', 900);
    this.noise(0.06, 0.06 * size, 'bandpass', m === 'wood' ? this.vary(1100, 0.2) : this.vary(2300, 0.2), { q: 3, delay: 0.02 });
    if (amount >= 20) {
      const base = amount >= 50 ? 4 : 2;
      [0, 2, 4].forEach((k, i) => this.tone(PENTA[base + k] / 2, 0.22, 'triangle', 0.05, { delay: 0.05 + i * 0.05 }));
    }
  }

  private rentCombo = 0;
  private rentLast = 0;

  /** Koin sewa: nada naik bertahap saat banyak bangunan membayar beruntun (terasa "reward line"). */
  rent(): void {
    const now = performance.now();
    this.rentCombo = now - this.rentLast < 380 ? Math.min(12, this.rentCombo + 1) : 0;
    this.rentLast = now;
    if (!this.ok('rent', 45, 1)) return;
    const f = 1318.51 * Math.pow(2, (this.rentCombo % 13) / 12);
    this.tone(f, 0.07, 'triangle', 0.035);
    this.tone(f * 1.5, 0.05, 'sine', 0.018, { delay: 0.03 });
  }

  modulePop(i: number): void {
    if (!this.ok('pop', 45, 1)) return;
    this.tone(this.vary(PENTA[i % PENTA.length], 0.015), 0.1, 'sine', 0.05, { slide: PENTA[i % PENTA.length] * 1.25 });
  }

  land(m: MaterialKind, big: boolean): void {
    if (!this.ok('land', 80)) return;
    this.noise(0.08, big ? 0.09 : 0.06, 'bandpass', m === 'wood' ? 700 : 1600, { q: 2 });
  }

  stageComplete(): void {
    if (!this.ok('stage', 300)) return;
    [0, 2, 4, 5].forEach((k, i) => this.tone(PENTA[k], 0.28, 'triangle', 0.09, { delay: i * 0.08 }));
    this.noise(0.5, 0.03, 'highpass', 6000, { delay: 0.28 });
  }

  projectComplete(): void {
    if (!this.ok('complete', 1000)) return;
    const mel = [
      [0, 0],
      [2, 0.12],
      [4, 0.24],
      [5, 0.36],
      [4, 0.56],
      [5, 0.68],
      [7, 0.8],
    ];
    for (const [k, t] of mel) {
      this.tone(PENTA[k], 0.34, 'triangle', 0.1, { delay: t });
      this.tone(PENTA[k] * 2, 0.2, 'sine', 0.03, { delay: t });
    }
    this.tone(130.81, 1.2, 'triangle', 0.1, { delay: 0.8 });
    this.tone(196, 1.2, 'triangle', 0.06, { delay: 0.8 });
    this.noise(1.2, 0.04, 'highpass', 7000, { delay: 0.8, attack: 0.01 });
  }

  merge(level: number): void {
    if (!this.ok('merge', 150)) return;
    const b = 1 + (level - 2) * 0.12;
    this.tone(380 * b, 0.28, 'sine', 0.1, { slide: 900 * b });
    this.tone(PENTA[Math.min(9, 3 + level)], 0.22, 'triangle', 0.08, { delay: 0.3 });
    this.noise(0.12, 0.05, 'highpass', 3500, { delay: 0.3 });
  }

  purchase(): void {
    if (!this.ok('purchase', 80)) return;
    this.tone(987.77, 0.07, 'square', 0.035);
    this.tone(1318.51, 0.16, 'square', 0.035, { delay: 0.07 });
  }

  expand(): void {
    if (!this.ok('expand', 500)) return;
    this.noise(0.9, 0.1, 'bandpass', 300, { q: 1.2, slide: 2600, attack: 0.15 });
    this.tone(196, 0.9, 'triangle', 0.08, { slide: 392, attack: 0.1 });
    this.tone(PENTA[4], 0.3, 'triangle', 0.08, { delay: 1.0 });
    this.tone(PENTA[7], 0.4, 'sine', 0.06, { delay: 1.1 });
  }

  build(): void {
    if (!this.ok('build', 300)) return;
    for (let i = 0; i < 3; i++) this.noise(0.06, 0.1, 'bandpass', this.vary(900, 0.2), { q: 3, delay: i * 0.1 });
    this.tone(PENTA[5], 0.3, 'triangle', 0.08, { delay: 0.32 });
  }

  upgrade(): void {
    if (!this.ok('upgrade', 150)) return;
    [2, 4, 6].forEach((k, i) => this.tone(PENTA[k], 0.12, 'sine', 0.07, { delay: i * 0.05 }));
  }

  deny(): void {
    if (!this.ok('deny', 250)) return;
    this.tone(196, 0.08, 'square', 0.03);
    this.tone(165, 0.1, 'square', 0.03, { delay: 0.09 });
  }

  click(): void {
    if (!this.ok('click', 40, 1)) return;
    this.tone(1400, 0.03, 'sine', 0.03);
  }

  select(): void {
    if (!this.ok('select', 60)) return;
    this.tone(880, 0.06, 'triangle', 0.05, { slide: 1320 });
  }

  boostStart(): void {
    if (!this.ok('boost', 350, 1)) return;
    this.noise(0.25, 0.035, 'bandpass', 400, { q: 1.5, slide: 1400 });
  }

  /** Dengung mesin sangat halus yang naik saat boost. */
  setEngine(boost: number, running: boolean): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    if (!this.engine) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc2.type = 'square';
      osc.frequency.value = 70;
      osc2.frequency.value = 35;
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, gain, filter };
    }
    const t = this.ctx.currentTime;
    const k = Math.max(0, Math.min(1, (boost - 1) / 0.7));
    // Diam saat kecepatan normal; hanya terdengar halus ketika boost.
    const vol = running && !this.muted ? k * 0.03 : 0;
    this.engine.gain.gain.setTargetAtTime(vol, t, 0.08);
    this.engine.osc.frequency.setTargetAtTime(70 + k * 45, t, 0.1);
    this.engine.osc2.frequency.setTargetAtTime(35 + k * 22, t, 0.1);
    this.engine.filter.frequency.setTargetAtTime(300 + k * 500, t, 0.1);
  }

  /** Ambience opsional: kicau burung sesekali (hutan) — pelan & jarang. */
  tick(dt: number): void {
    if (this.ambience !== 'birds' || !this.ctx || this.muted) return;
    this.birdTimer -= dt;
    if (this.birdTimer > 0) return;
    this.birdTimer = 7 + Math.random() * 10;
    if (!this.ok('bird', 3000, 1)) return;
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1200;
    for (let i = 0; i < n; i++) this.tone(base * (1 + i * 0.05), 0.08, 'sine', 0.018, { delay: i * 0.12, slide: base * 1.35 });
  }
}
