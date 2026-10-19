import type { Settings } from '../game/state';
import { clamp } from '../game/util';

export type SfxName =
  | 'break'
  | 'bonus'
  | 'contact'
  | 'reinforced'
  | 'pickup'
  | 'nearFull'
  | 'full'
  | 'rattle'
  | 'coin'
  | 'upgrade'
  | 'areaClear'
  | 'ui'
  | 'deny'
  | 'unloadStart'
  | 'gate';

export interface PlayOpts {
  /** Coalesced event count this frame (louder/brighter, never more voices). */
  count?: number;
  /** Sequence index (coin arpeggio). */
  index?: number;
  pitch?: number;
}

export interface EngineState {
  speed: number;
  maxSpeed: number;
  throttle: number;
  /** 0..1 crusher contact intensity. */
  contact: number;
  power: number;
  full: boolean;
  active: boolean;
}

const MIN_INTERVAL: Partial<Record<SfxName, number>> = {
  break: 0.045,
  contact: 0.07,
  reinforced: 0.14,
  pickup: 0.075,
  rattle: 0.065,
  coin: 0.055,
  bonus: 0.09,
  ui: 0.04,
  deny: 0.15,
};

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/**
 * Self-contained procedural audio: Web Audio synthesis + generated noise.
 * Separate SFX / music buses under a master with a gentle compressor.
 * Short voices are budgeted and high-rate events are rate-limited/coalesced.
 * Everything no-ops gracefully if the context can't start.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private voices = 0;
  private readonly maxVoices = 14;
  private last: Partial<Record<SfxName, number>> = {};
  private settings: Settings | null = null;
  private motor: { o1: OscillatorNode; o2: OscillatorNode; lp: BiquadFilterNode; gain: GainNode } | null = null;
  private rumble: { osc: OscillatorNode; gain: GainNode } | null = null;
  private grainClock = 0;
  private hidden = false;
  failed = false;

  // Music scheduler
  private musicOn = false;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private musicStep = 0;
  private phraseSeed = 1;
  private phrase: number[] = [];

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this.failed;
  }

  /** Create/resume the context. Call from trusted user gestures. */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return;
        }
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state === 'suspended' && !this.hidden) void this.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  private build(): void {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);

    // One second of white noise, reused by every noisy sound.
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Motor: two low oscillators through a lowpass.
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 46;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 69.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 0.7;
    const mg = ctx.createGain();
    mg.gain.value = 0;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    o1.connect(lp);
    o2.connect(o2g).connect(lp);
    lp.connect(mg).connect(this.sfx);
    o1.start();
    o2.start();
    this.motor = { o1, o2, lp, gain: mg };

    // Drum rumble under the crunch texture.
    const ro = ctx.createOscillator();
    ro.type = 'triangle';
    ro.frequency.value = 72;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    ro.connect(rg).connect(this.sfx);
    ro.start();
    this.rumble = { osc: ro, gain: rg };

    if (this.settings) this.applySettings(this.settings);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : 0.9, t, 0.04);
    this.sfx.gain.setTargetAtTime(s.sfxVolume, t, 0.04);
    this.musicBus.gain.setTargetAtTime(s.musicVolume * 0.32, t, 0.08);
    const wantMusic = !s.muted && s.musicVolume > 0.001;
    if (wantMusic && !this.musicOn) this.startMusic();
    else if (!wantMusic && this.musicOn) this.stopMusic();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.ctx) return;
    try {
      if (hidden) {
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
        window.setTimeout(() => {
          if (this.hidden && this.ctx) void this.ctx.suspend().catch(() => undefined);
        }, 150);
      } else {
        void this.ctx.resume().catch(() => undefined);
        if (this.settings) this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 0.9, this.ctx.currentTime, 0.1);
        this.nextNoteTime = this.ctx.currentTime + 0.1;
      }
    } catch {
      /* ignore */
    }
  }

  /** Continuous layers: motor + drum rumble + granular crunch texture. */
  update(dt: number, e: EngineState): void {
    if (!this.ready || !this.motor || !this.rumble) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const sp = clamp(Math.abs(e.speed) / Math.max(0.1, e.maxSpeed), 0, 1);
    const motorGain = e.active ? 0.035 + 0.055 * sp + 0.02 * e.throttle : 0;
    this.motor.gain.gain.setTargetAtTime(motorGain, t, 0.08);
    this.motor.o1.frequency.setTargetAtTime(44 + 22 * sp + 6 * e.contact, t, 0.1);
    this.motor.o2.frequency.setTargetAtTime(66 + 34 * sp + 8 * e.contact, t, 0.1);
    this.motor.lp.frequency.setTargetAtTime(220 + 380 * sp + 200 * e.contact, t, 0.1);
    const rumbleGain = e.active && !e.full ? e.contact * (0.05 + e.power * 0.008) : 0;
    this.rumble.gain.gain.setTargetAtTime(rumbleGain, t, 0.05);
    this.rumble.osc.frequency.setTargetAtTime(66 + e.power * 6 + e.contact * 10, t, 0.1);

    // Granular crunch: a controlled texture, never one loud voice per block.
    if (e.active && e.contact > 0.02 && !e.full) {
      const rate = 12 + 16 * e.contact;
      this.grainClock += dt * rate;
      let n = 0;
      while (this.grainClock >= 1 && n < 3) {
        this.grainClock -= 1;
        n++;
        this.grain(t + Math.random() * 0.02, e.contact, e.power);
      }
      if (this.grainClock > 1) this.grainClock = 0;
    } else {
      this.grainClock = 0;
    }
  }

  private grain(t: number, intensity: number, power: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 1900;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    const dur = 0.025 + Math.random() * 0.03;
    const amp = (0.05 + Math.random() * 0.05) * (0.6 + intensity * 0.6) * (1 + (power - 1) * 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.9, dur + 0.01);
  }

  play(name: SfxName, opts: PlayOpts = {}): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const minI = MIN_INTERVAL[name];
    if (minI !== undefined) {
      const l = this.last[name];
      if (l !== undefined && now - l < minI) return;
    }
    const critical = name === 'full' || name === 'upgrade' || name === 'areaClear' || name === 'ui';
    if (this.voices >= this.maxVoices && !critical) return;
    this.last[name] = now;
    const count = Math.max(1, opts.count ?? 1);
    const boost = 1 + Math.min(0.5, Math.log2(count) * 0.15);
    const p = opts.pitch ?? 1;
    const t = now + 0.005;
    switch (name) {
      case 'break': {
        const f = 540 * p * (0.92 + Math.random() * 0.16);
        this.tone(t, 'triangle', f, f * 0.6, 0.2 * boost, 0.002, 0.07);
        this.tone(t, 'sine', 190 * (0.95 + Math.random() * 0.1), 150, 0.12 * boost, 0.002, 0.05);
        this.noiseHit(t, 2400 + Math.random() * 600, 1.2, 0.14 * boost, 0.035);
        break;
      }
      case 'contact':
        this.noiseHit(t, 1500, 1.4, 0.08, 0.03);
        this.tone(t, 'sine', 320, 260, 0.05, 0.002, 0.04);
        break;
      case 'reinforced':
        this.tone(t, 'square', 150, 120, 0.05, 0.003, 0.09, 900);
        this.noiseHit(t, 900, 1.5, 0.09, 0.06);
        break;
      case 'bonus':
        this.tone(t, 'sine', 1320, 1320, 0.1, 0.004, 0.08);
        this.tone(t + 0.06, 'sine', 1760, 1760, 0.1, 0.004, 0.12);
        this.tone(t + 0.06, 'triangle', 2640, 2640, 0.035, 0.004, 0.1);
        break;
      case 'pickup': {
        const f = 880 * p * (0.95 + Math.random() * 0.1);
        this.tone(t, 'triangle', f, f * 1.02, 0.055 * boost, 0.002, 0.06);
        break;
      }
      case 'nearFull':
        this.tone(t, 'sine', 660, 660, 0.08, 0.005, 0.18);
        this.tone(t, 'sine', 990, 990, 0.04, 0.005, 0.16);
        break;
      case 'full':
        this.tone(t, 'sine', 1047, 1047, 0.12, 0.006, 0.2);
        this.tone(t, 'triangle', 1047, 1047, 0.04, 0.006, 0.18);
        this.tone(t + 0.17, 'sine', 784, 784, 0.12, 0.006, 0.32);
        this.tone(t + 0.17, 'triangle', 784, 784, 0.04, 0.006, 0.28);
        break;
      case 'rattle':
        this.noiseHit(t, 1600 + Math.random() * 1400, 1.8, 0.07, 0.04);
        this.tone(t, 'triangle', 420 + Math.random() * 180, 300, 0.04, 0.002, 0.04);
        break;
      case 'coin': {
        const idx = Math.min(PENTA.length - 1, opts.index ?? 0);
        const f = 880 * Math.pow(2, PENTA[idx] / 12);
        this.tone(t, 'sine', f, f, 0.075, 0.003, 0.16);
        this.tone(t, 'sine', f * 2.76, f * 2.76, 0.018, 0.002, 0.07);
        break;
      }
      case 'upgrade': {
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((f, i) => this.tone(t + i * 0.07, 'triangle', f, f, 0.09, 0.004, 0.22));
        [523.25, 659.25, 783.99, 1046.5].forEach((f) => this.tone(t + 0.22, 'sine', f, f, 0.06, 0.01, 0.45));
        break;
      }
      case 'areaClear': {
        const arp = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        arp.forEach((f, i) => this.tone(t + i * 0.075, 'triangle', f, f, 0.1, 0.004, 0.2));
        [523.25, 783.99, 1046.5, 1318.5].forEach((f) => this.tone(t + 0.4, 'sine', f, f, 0.07, 0.02, 0.7));
        for (let k = 0; k < 5; k++) this.tone(t + 0.45 + k * 0.06, 'sine', 2093 * (1 + k * 0.12), 2093, 0.025, 0.003, 0.12);
        break;
      }
      case 'ui':
        this.tone(t, 'sine', 1150, 1000, 0.05, 0.002, 0.035);
        break;
      case 'deny':
        this.tone(t, 'triangle', 240, 180, 0.07, 0.004, 0.12);
        break;
      case 'unloadStart':
        this.tone(t, 'sawtooth', 110, 210, 0.05, 0.02, 0.28, 700);
        this.noiseHit(t + 0.05, 1200, 1, 0.05, 0.12);
        break;
      case 'gate':
        this.noiseSweep(t, 400, 2400, 0.08, 0.45);
        this.tone(t + 0.2, 'sine', 784, 784, 0.07, 0.005, 0.2);
        this.tone(t + 0.3, 'sine', 1175, 1175, 0.07, 0.005, 0.3);
        break;
    }
  }

  private track(node: AudioScheduledSourceNode, end: number): void {
    this.voices++;
    node.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
    };
    node.stop(end + 0.02);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, amp: number, attack: number, decay: number, lowpass?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + attack + decay);
    let head: AudioNode = o;
    if (lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      o.connect(lp);
      head = lp;
    }
    head.connect(g).connect(this.sfx);
    o.start(t);
    this.track(o, t + attack + decay);
  }

  private noiseHit(t: number, freq: number, q: number, amp: number, decay: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.8);
    this.track(src, t + decay);
  }

  private noiseSweep(t: number, f0: number, f1: number, amp: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, 0);
    this.track(src, t + dur);
  }

  // ---------------------------------------------------------------- music
  // A light procedural loop: soft marimba melody over I–V–vi–IV with a quiet
  // bass. New melodic phrases are generated every four bars.

  private startMusic(): void {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextNoteTime = this.ctx.currentTime + 0.2;
    this.musicStep = 0;
    this.newPhrase();
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 90);
  }

  private stopMusic(): void {
    this.musicOn = false;
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private newPhrase(): void {
    // Simple LCG for musical variety that doesn't touch gameplay randomness.
    let s = (this.phraseSeed = (this.phraseSeed * 1103515245 + 12345) >>> 0);
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const out: number[] = [];
    let deg = 4;
    for (let i = 0; i < 32; i++) {
      if (rnd() < 0.38 || (i % 8 === 7 && rnd() < 0.6)) {
        out.push(-1);
        continue;
      }
      deg = clamp(deg + Math.round((rnd() - 0.5) * 4), 0, 9);
      out.push(deg);
    }
    this.phrase = out;
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicOn || this.hidden || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const eighth = 60 / 96 / 2;
    const chords = [
      [0, 4, 7],
      [7, 11, 14],
      [9, 12, 16],
      [5, 9, 12],
    ];
    const root = 261.63;
    if (this.nextNoteTime < ctx.currentTime - 0.5) this.nextNoteTime = ctx.currentTime + 0.05;
    while (this.nextNoteTime < ctx.currentTime + 0.3) {
      const step = this.musicStep;
      const bar = Math.floor(step / 8) % 4;
      const t = this.nextNoteTime;
      if (step % 8 === 0) {
        const bassF = (root / 2) * Math.pow(2, chords[bar][0] / 12);
        this.musicNote(t, bassF, 'triangle', 0.16, eighth * 6);
      }
      if (step % 8 === 4) {
        const f = (root / 2) * Math.pow(2, chords[bar][2] / 12);
        this.musicNote(t, f, 'triangle', 0.08, eighth * 3);
      }
      const deg = this.phrase[step % 32];
      if (deg >= 0) {
        const semis = PENTA[deg] + 12;
        this.musicNote(t, root * Math.pow(2, semis / 12), 'sine', 0.11, eighth * 1.6);
      }
      if (step % 2 === 1) this.musicShaker(t);
      this.musicStep++;
      if (this.musicStep % 64 === 0) this.newPhrase();
      this.nextNoteTime += eighth;
    }
  }

  private musicNote(t: number, f: number, type: OscillatorType, amp: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private musicShaker(t: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.018, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 0.8, 0.06);
  }
}
