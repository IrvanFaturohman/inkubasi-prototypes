import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { canAddWagon, canExpand, canMerge, canUpgradeCapacity, canUpgradeSpeed, isLastLevel } from '../game/actions';
import {
  addCost,
  buildingsDone,
  capacity,
  capacityCost,
  cargoTotal,
  expandCost,
  findMergePair,
  isPlotComplete,
  isPlotReady,
  isPlotUnlocked,
  levelDef,
  mergeCost,
  plotsOf,
  speedCost,
} from '../game/economy';
import type { GameState, Runtime } from '../game/types';
import { coin, fmt, fmtTime } from './format';

export interface HudHandlers {
  add(): void;
  merge(): void;
  speed(): void;
  capacity(): void;
  expand(): void;
  overview(): void;
  toggleSound(): void;
  openSettings(): void;
  closeSettings(): void;
  setSound(on: boolean): void;
  reset(): void;
  next(): void;
}

export interface HudContext {
  muted: boolean;
  overview: boolean;
}

export type PulseTarget = 'add' | 'merge' | 'speed' | 'capacity' | 'expand' | null;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const RES_LABEL = { wood: 'kayu', stone: 'batu', gem: 'permata' } as const;

export class Hud {
  readonly root = $('hud');
  private readonly moneyEl = $('money');
  private readonly moneyVal = $('money-val');
  private readonly moneyGainEl = $('money-gain');
  private readonly pName = $('p-name');
  private readonly pCount = $('p-count');
  private readonly pFill = $('p-fill');
  private readonly pStage = $('p-stage');
  private readonly hintEl = $('hint');
  private readonly boostEl = $('boost');
  private readonly boostFill = $('boost-fill');
  private readonly cargoEl = $('cargo');
  private readonly cargoIcon = $('cargo-icon');
  private readonly cargoFill = $('cargo-fill');
  private readonly cargoText = $('cargo-text');
  private readonly stInfo = $('st-info');
  private readonly stExpand = $<HTMLButtonElement>('st-expand');
  private readonly stationBar = $('station-bar');
  private readonly btnAdd = $<HTMLButtonElement>('btn-add');
  private readonly btnMerge = $<HTMLButtonElement>('btn-merge');
  private readonly btnSpeed = $<HTMLButtonElement>('btn-speed');
  private readonly btnCapacity = $<HTMLButtonElement>('btn-capacity');
  private readonly addCostEl = $('add-cost');
  private readonly mergeSub = $('merge-sub');
  private readonly speedCostEl = $('speed-cost');
  private readonly capacityCostEl = $('capacity-cost');
  private readonly overviewBtn = $('btn-overview');
  private readonly tutorial = $('tutorial');
  private readonly tutorialText = $('tutorial-text');
  private readonly toastEl = $('toast');
  private readonly completeEl = $('complete');
  private readonly settingsEl = $('settings');
  private readonly soundBtn = $('btn-sound');
  private readonly soundSwitch = $('set-sound');
  private readonly resetConfirm = $('reset-confirm');
  private readonly fadeEl = $('fade');
  private readonly titleCard = $('title-card');
  private cache = new Map<string, string>();
  private gainAcc = 0;
  private gainTimer = 0;
  private toastTimer = 0;
  private pulseTarget: PulseTarget = null;
  private shownMoney = -1;

  constructor(h: HudHandlers) {
    const tap = (el: HTMLElement, fn: () => void) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    };
    tap(this.btnAdd, () => h.add());
    tap(this.btnMerge, () => h.merge());
    tap(this.btnSpeed, () => h.speed());
    tap(this.btnCapacity, () => h.capacity());
    tap(this.stExpand, () => h.expand());
    tap(this.overviewBtn, () => h.overview());
    tap(this.soundBtn, () => h.toggleSound());
    tap($('btn-settings'), () => h.openSettings());
    tap($('set-close'), () => h.closeSettings());
    tap(this.soundSwitch, () => h.setSound(this.soundSwitch.getAttribute('aria-checked') !== 'true'));
    tap($('set-reset'), () => (this.resetConfirm.hidden = false));
    tap($('reset-cancel'), () => (this.resetConfirm.hidden = true));
    tap($('reset-yes'), () => {
      this.resetConfirm.hidden = true;
      h.reset();
    });
    tap($('btn-next'), () => h.next());
    this.settingsEl.addEventListener('click', (e) => {
      if (e.target === this.settingsEl) h.closeSettings();
    });
    // Elemen HUD menelan pointerdown supaya tidak memicu boost/geser di kanvas.
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, .project, .station-bar, .money, .c-card, .m-card, .modal')) e.stopPropagation();
    });
  }

  private set(key: string, el: HTMLElement, html: string): void {
    if (this.cache.get(key) !== html) {
      el.innerHTML = html;
      this.cache.set(key, html);
    }
  }

  private cls(el: HTMLElement, name: string, on: boolean): void {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
  }

  /** Ukuran area yang tertutup HUD (px) untuk framing kamera. */
  measure(): { top: number; bottom: number; right: number } {
    const app = this.root.getBoundingClientRect();
    const top = $('top').getBoundingClientRect();
    const bottom = $('bottom').getBoundingClientRect();
    const side = bottom.width < app.width * 0.6 && bottom.left > app.left + app.width * 0.4;
    this.root.style.setProperty('--bottom-h', side ? '0px' : `${Math.max(0, app.bottom - bottom.top)}px`);
    this.root.style.setProperty('--top-h', `${Math.max(0, top.bottom - app.top)}px`);
    if (side) return { top: 10, bottom: 10, right: Math.max(0, app.right - Math.min(top.left, bottom.left)) };
    return { top: Math.max(0, top.bottom - app.top), bottom: Math.max(0, app.bottom - bottom.top), right: 0 };
  }

  private priceBtn(key: string, el: HTMLElement, btn: HTMLElement, cost: number | null, ok: boolean, locked: boolean, max = 'Maks'): void {
    this.set(key, el, cost === null ? max : coin(cost));
    this.cls(btn, 'locked', locked || !ok);
    this.afford(btn, cost === null ? 0 : ok ? 0 : this.shownMoney / cost, cost !== null && !ok);
  }

  update(state: GameState, rt: Runtime, ctx: HudContext, dt: number): void {
    const level = levelDef(state);
    const res = level.buildResource;
    const locked = state.completed;

    if (Math.floor(state.money) !== this.shownMoney) {
      this.shownMoney = Math.floor(state.money);
      this.moneyVal.textContent = fmt(state.money);
    }
    if (this.gainTimer > 0) {
      this.gainTimer -= dt;
      if (this.gainTimer <= 0 && this.gainAcc > 0) {
        this.moneyGainEl.textContent = `+${fmt(this.gainAcc)}`;
        this.moneyGainEl.classList.remove('show');
        void this.moneyGainEl.offsetWidth;
        this.moneyGainEl.classList.add('show');
        this.moneyEl.classList.remove('bump');
        void this.moneyEl.offsetWidth;
        this.moneyEl.classList.add('bump');
        this.gainAcc = 0;
      }
    }

    // Kartu level
    const b = buildingsDone(state);
    this.set('pname', this.pName, level.name);
    this.set('pcount', this.pCount, `<b>${b.done}</b>/${b.total} bangunan`);
    this.pFill.style.width = `${((b.done / Math.max(1, b.total)) * 100).toFixed(1)}%`;
    const plots = plotsOf(state.levelIndex);
    let stage: string;
    if (state.completed) stage = `<b>Selesai!</b> ${b.total} bangunan berdiri`;
    else {
      const active = level.streets.findIndex((_, si) => plots.some((p) => p.street === si && isPlotUnlocked(state, p.index) && !isPlotComplete(state, p.index)));
      if (active < 0) stage = '<b>Buka Rel Baru</b> ke hutan berikutnya';
      else {
        const sp = plots.filter((p) => p.street === active);
        const ready = sp.filter((p) => isPlotReady(state, p.index) && !isPlotComplete(state, p.index)).length;
        const done = sp.filter((p) => isPlotComplete(state, p.index)).length;
        stage = `<b>${level.streets[active].name}</b> · ${done}/${sp.length} jadi${ready ? ` · ${ready} sedang dibangun` : ' · tebang lahannya!'}`;
      }
    }
    this.set('pstage', this.pStage, stage);

    // Hint (teks kecil, tidak memblokir)
    let hint = '';
    if (!state.completed && rt.fullTime > 4) hint = 'Muatan penuh, gergaji berhenti — naikkan Kapasitas';
    this.set('hint', this.hintEl, hint);
    this.hintEl.hidden = hint === '';

    // Muatan (MASS)
    const total = cargoTotal(state.train.cargo);
    const cap = capacity(state);
    this.cargoFill.style.height = `${Math.min(100, (total / cap) * 100).toFixed(1)}%`;
    this.set('cargotext', this.cargoText, `${total}/${cap}`);
    this.cls(this.cargoEl, 'full', total >= cap);
    this.cls(this.cargoIcon, 'wood', res === 'wood');
    this.cls(this.cargoIcon, 'stone', res === 'stone');
    this.cargoEl.hidden = state.completed;

    // Boost
    const bs = rt.boost;
    this.cls(this.boostEl, 'show', !state.completed && (bs.energy < 0.995 || bs.holding));
    this.cls(this.boostEl, 'tired', bs.exhausted);
    this.boostFill.style.width = `${(bs.energy * 100).toFixed(1)}%`;

    // Tombol utama
    const full = state.train.wagons.length >= BALANCE.maxWagons;
    this.priceBtn('add', this.addCostEl, this.btnAdd, full ? null : addCost(state), canAddWagon(state).ok, locked, `${state.train.wagons.length}/${BALANCE.maxWagons}`);
    const pair = findMergePair(state);
    if (pair) {
      const lv = state.train.wagons[pair[0]];
      this.set('merge', this.mergeSub, `Lv${lv}→${lv + 1} ${coin(mergeCost(state))}`);
    } else this.set('merge', this.mergeSub, '2 setingkat');
    this.cls(this.btnMerge, 'locked', locked || !canMerge(state).ok);
    this.afford(this.btnMerge, pair ? this.shownMoney / mergeCost(state) : 0, !!pair && !canMerge(state).ok);
    this.priceBtn('speed', this.speedCostEl, this.btnSpeed, speedCost(state), canUpgradeSpeed(state).ok, locked);
    this.priceBtn('cap', this.capacityCostEl, this.btnCapacity, capacityCost(state), canUpgradeCapacity(state).ok, locked);

    // Panel rel baru
    const ec = expandCost(state);
    const next = level.streets.find((s) => s.unlockStage === state.expandStage + 1);
    if (ec === null || !next) {
      this.set('stinfo', this.stInfo, `<div class="st-name">Semua jalur terbuka</div><div class="st-meta">Selesaikan semua bangunan ${RES_LABEL[res]}</div>`);
      this.set('stx', this.stExpand, 'Rel Maks');
      this.cls(this.stExpand, 'max', true);
      this.cls(this.stExpand, 'locked', false);
    } else {
      this.set('stinfo', this.stInfo, `<div class="st-name">Rel Baru → ${next.name}</div><div class="st-meta">${next.plots.length} kavling baru di hutan</div>`);
      this.set('stx', this.stExpand, `Buka Rel<small>${coin(ec)}</small>`);
      this.cls(this.stExpand, 'max', false);
      this.cls(this.stExpand, 'locked', locked || !canExpand(state).ok);
    }

    for (const [k, el] of Object.entries(this.targets())) this.cls(el, 'pulse', this.pulseTarget === k);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    this.cls(this.soundBtn, 'muted', ctx.muted);
    this.cls(this.overviewBtn, 'active', ctx.overview);
    this.soundSwitch.setAttribute('aria-checked', String(!ctx.muted));
  }

  private targets(): Record<Exclude<PulseTarget, null>, HTMLElement> {
    return { add: this.btnAdd, merge: this.btnMerge, speed: this.btnSpeed, capacity: this.btnCapacity, expand: this.stExpand };
  }

  private afford(btn: HTMLElement, ratio: number, show: boolean): void {
    let bar = btn.querySelector<HTMLElement>('.afford');
    if (!bar) {
      bar = document.createElement('i');
      bar.className = 'afford';
      btn.appendChild(bar);
    }
    bar.style.width = show ? `${Math.min(100, ratio * 100).toFixed(0)}%` : '0';
  }

  setPulse(t: PulseTarget): void {
    this.pulseTarget = t;
  }

  showTutorial(text: string | null, x = 0, y = 0, arrow = true): void {
    if (!text) {
      this.tutorial.hidden = true;
      return;
    }
    this.tutorial.hidden = false;
    if (this.tutorialText.textContent !== text) this.tutorialText.textContent = text;
    const w = this.root.clientWidth;
    const half = Math.min(115, (this.tutorial.offsetWidth || 200) / 2);
    const cx = Math.max(half + 8, Math.min(w - half - 8, x));
    this.tutorial.style.left = `${cx}px`;
    this.tutorial.style.top = `${y}px`;
    this.tutorial.style.setProperty('--arrow-x', `${50 + ((x - cx) / (half * 2)) * 100}%`);
    this.cls(this.tutorial, 'no-arrow', !arrow);
  }

  anchorOf(t: Exclude<PulseTarget, null>): { x: number; y: number } {
    const el = this.targets()[t];
    const r = el.getBoundingClientRect();
    const app = this.root.getBoundingClientRect();
    const bar = this.stationBar.getBoundingClientRect();
    const side = bar.width < app.width * 0.9 && bar.left > app.left + app.width * 0.4;
    const top = side || t === 'expand' ? r.top : Math.min(r.top, bar.top);
    return { x: r.left - app.left + r.width / 2, y: top - app.top - 10 };
  }

  moneyGain(amount: number): void {
    if (amount <= 0) return;
    this.gainAcc += amount;
    if (this.gainTimer <= 0) this.gainTimer = 0.25;
  }

  toast(msg: string, seconds = 1.6): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  bought(which: Exclude<PulseTarget, null>): void {
    const el = this.targets()[which];
    el.classList.remove('bought');
    void el.offsetWidth;
    el.classList.add('bought');
  }

  showComplete(state: GameState): void {
    const level = levelDef(state);
    const b = buildingsDone(state);
    $('c-title').textContent = `${level.name} selesai!`;
    const items = [`${b.total} bangunan berdiri`, `${fmt(state.stats.totalCut)} blok ditebang`, `Waktu ${fmtTime(state.stats.levelTime)}`, `Bonus ${coin(state.stats.lastCompletionBonus)}`];
    $('c-stats').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
    const next = LEVELS[(state.levelIndex + 1) % LEVELS.length];
    $('btn-next').innerHTML = `Level Berikutnya<br><small style="font-size:12px;opacity:.9">${isLastLevel(state) ? 'Putaran baru · ' : ''}${next.name}</small>`;
    this.completeEl.hidden = false;
    $('bottom').style.visibility = 'hidden';
  }

  hideComplete(): void {
    this.completeEl.hidden = true;
    $('bottom').style.visibility = '';
  }

  get completeVisible(): boolean {
    return !this.completeEl.hidden;
  }

  showSettings(on: boolean): void {
    this.settingsEl.hidden = !on;
    this.resetConfirm.hidden = true;
  }

  get settingsOpen(): boolean {
    return !this.settingsEl.hidden;
  }

  fade(on: boolean): void {
    this.cls(this.fadeEl, 'on', on);
  }

  showTitle(area: string, name: string): void {
    $('tc-area').textContent = area;
    $('tc-name').textContent = name;
    this.titleCard.hidden = false;
    this.titleCard.style.animation = 'none';
    void this.titleCard.offsetWidth;
    this.titleCard.style.animation = '';
    window.setTimeout(() => (this.titleCard.hidden = true), 2700);
  }
}
