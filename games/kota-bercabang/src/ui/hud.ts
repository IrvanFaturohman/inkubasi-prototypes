import { CITIES } from '../config/cities';
import { canAddVehicle, canExpand, isLastLevel } from '../game/actions';
import {
  addCost,
  buildingsDone,
  canUpgradeMore,
  cityDef,
  expandCost,
  findMergePair,
  isPlotComplete,
  isPlotUnlocked,
  machineCost,
  materialProgress,
  maxVehicles,
  plotsOf,
  productionRate,
  storageCapacity,
  upgradeCost,
} from '../game/economy';
import type { GameState, Runtime } from '../game/types';
import { MATERIAL_LOOK } from '../render/palette';
import { coin, fmt, fmtFull, fmtRate, fmtTime } from './format';

export interface HudHandlers {
  add(): void;
  merge(): void;
  expand(): void;
  upgrade(): void;
  machine(): void;
  overview(): void;
  toggleSound(): void;
  openSettings(): void;
  closeSettings(): void;
  setSound(on: boolean): void;
  reset(): void;
  next(): void;
}

export interface HudContext {
  selectedVehicle: number | null;
  muted: boolean;
}

export type PulseTarget = 'add' | 'merge' | 'expand' | 'upgrade' | 'machine' | null;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  readonly root = $('hud');
  private readonly moneyEl = $('money');
  private readonly moneyVal = $('money-val');
  private readonly moneyGainEl = $('money-gain');
  private readonly pName = $('p-name');
  private readonly pCount = $('p-count');
  private readonly pFill = $('p-fill');
  private readonly pTicks = $('p-ticks');
  private readonly pStage = $('p-stage');
  private readonly hintEl = $('hint');
  private readonly boostEl = $('boost');
  private readonly boostFill = $('boost-fill');
  private readonly stInfo = $('st-info');
  private readonly stUpgrade = $<HTMLButtonElement>('st-upgrade');
  private readonly stMachine = $<HTMLButtonElement>('st-machine');
  private readonly stationBar = $('station-bar');
  private readonly btnAdd = $<HTMLButtonElement>('btn-add');
  private readonly btnMerge = $<HTMLButtonElement>('btn-merge');
  private readonly btnExpand = $<HTMLButtonElement>('btn-expand');
  private readonly addCostEl = $('add-cost');
  private readonly mergeSub = $('merge-sub');
  private readonly expandCostEl = $('expand-cost');
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
  private ticksKey = '';
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
    tap(this.btnExpand, () => h.expand());
    tap(this.stUpgrade, () => h.upgrade());
    tap(this.stMachine, () => h.machine());
    tap($('btn-overview'), () => h.overview());
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
    // Semua elemen HUD menelan pointerdown supaya tidak memicu boost/geser di kanvas.
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
    // Layout samping (ponsel landscape): semua panel di kolom kanan, dunia di kiri.
    const side = bottom.width < app.width * 0.6 && bottom.left > app.left + app.width * 0.4;
    this.root.style.setProperty('--bottom-h', side ? '0px' : `${Math.max(0, app.bottom - bottom.top)}px`);
    this.root.style.setProperty('--top-h', `${Math.max(0, top.bottom - app.top)}px`);
    if (side) return { top: 10, bottom: 10, right: Math.max(0, app.right - Math.min(top.left, bottom.left)) };
    return { top: Math.max(0, top.bottom - app.top), bottom: Math.max(0, app.bottom - bottom.top), right: 0 };
  }

  update(state: GameState, rt: Runtime, ctx: HudContext, dt: number): void {
    const city = cityDef(state);
    const look = MATERIAL_LOOK[city.material];
    const locked = state.completed;

    // Uang
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

    // Kartu kota
    const b = buildingsDone(state);
    const mat = materialProgress(state);
    const plots = plotsOf(state.levelIndex);
    this.set('pname', this.pName, city.name);
    this.set('pcount', this.pCount, `<b>${b.done}</b>/${b.total} bangunan`);
    this.pFill.style.width = `${Math.min(100, (mat.delivered / Math.max(1, mat.target)) * 100).toFixed(1)}%`;
    const ticksKey = `${city.id}${state.cycle}`;
    if (ticksKey !== this.ticksKey) {
      // Garis batas tiap jalan pada bar progres material.
      this.ticksKey = ticksKey;
      const total = plots.reduce((s, p) => s + p.def.target, 0) || 1;
      let sum = 0;
      const marks = city.streets.map((_, si) => {
        for (const p of plots) if (p.street === si) sum += p.def.target;
        return sum;
      });
      this.pTicks.innerHTML = marks
        .slice(0, -1)
        .map((m) => `<span style="left:${((m / total) * 100).toFixed(2)}%"></span>`)
        .join('');
    }
    let stageText: string;
    if (state.completed) stageText = `<b>Kota selesai!</b> ${b.total} bangunan berdiri`;
    else {
      const active = city.streets.findIndex((_, si) => plots.some((p) => p.street === si && isPlotUnlocked(state, p.index) && !isPlotComplete(state, p.index)));
      if (active >= 0) {
        const sp = plots.filter((p) => p.street === active);
        const done = sp.filter((p) => isPlotComplete(state, p.index)).length;
        stageText = `<b>${city.streets[active].name}</b> · ${done}/${sp.length} jadi · ${fmtFull(mat.delivered)}/${fmtFull(mat.target)} ${look.unit}`;
      } else stageText = '<b>Buka Jalan Baru</b> untuk kavling berikutnya';
    }
    this.set('pstage', this.pStage, stageText);

    // Hint bottleneck (teks kecil, tidak memblokir)
    let hint = '';
    if (!state.completed && state.stats.levelTime > 20 && rt.freeze <= 0) {
      const avgLoad = rt.recentLoads.length >= 6 ? rt.recentLoads.reduce((a, c) => a + c, 0) / rt.recentLoads.length : 1;
      if (rt.storageFill > 0.8) hint = `${look.label} menumpuk di pabrik — tambah/gabung kendaraan`;
      else if (avgLoad < 0.5 && rt.storageFill < 0.2) hint = 'Truk berangkat setengah kosong — upgrade pabrik / tambah mesin';
    }
    this.set('hint', this.hintEl, hint);
    this.hintEl.hidden = hint === '';

    // Boost
    const bs = rt.boost;
    this.cls(this.boostEl, 'show', !state.completed && (bs.energy < 0.995 || bs.holding));
    this.cls(this.boostEl, 'tired', bs.exhausted);
    this.boostFill.style.width = `${(bs.energy * 100).toFixed(1)}%`;

    // Tombol utama
    const ac = addCost(state);
    const canAdd = canAddVehicle(state);
    const full = state.vehicles.length >= maxVehicles(state);
    this.set('add', this.addCostEl, full ? 'Jalan penuh' : coin(ac));
    this.cls(this.btnAdd, 'locked', locked || !canAdd.ok);
    this.afford(this.btnAdd, full ? 0 : state.money / ac, !canAdd.ok && !full);

    const selected = ctx.selectedVehicle !== null ? state.vehicles.find((v) => v.id === ctx.selectedVehicle) : undefined;
    const pair = findMergePair(state);
    let mergeText: string;
    let mergeOk: boolean;
    if (selected) {
      const partners = state.vehicles.filter((v) => v.id !== selected.id && v.level === selected.level).length;
      mergeOk = partners > 0 && selected.level < 6;
      mergeText = mergeOk ? `Lv${selected.level} terpilih` : `Belum ada Lv${selected.level} lain`;
    } else if (pair) {
      const lv = state.vehicles.find((v) => v.id === pair[0])!.level;
      mergeOk = true;
      mergeText = `Lv${lv}×2 → Lv${lv + 1}`;
    } else {
      mergeOk = false;
      mergeText = 'Perlu 2 Lv sama';
    }
    this.set('merge', this.mergeSub, mergeText);
    this.cls(this.btnMerge, 'locked', locked || !mergeOk);

    const ec = expandCost(state);
    this.set('expand', this.expandCostEl, ec === null ? 'Semua terbuka' : coin(ec));
    const canEx = canExpand(state);
    this.cls(this.btnExpand, 'locked', locked || !canEx.ok);
    this.afford(this.btnExpand, ec === null ? 0 : state.money / ec, ec !== null && !canEx.ok);

    // Panel pabrik
    const cap = storageCapacity(state);
    const isFull = state.depot.storage >= cap;
    this.set(
      'stinfo',
      this.stInfo,
      `<div class="st-name">Pabrik ${look.label}</div><div class="st-meta${isFull ? ' full' : ''}">Lv${state.depot.level} · ${state.depot.machines} mesin · ${fmtRate(productionRate(state))}/dtk</div>`,
    );
    if (!canUpgradeMore(state)) {
      this.set('stup', this.stUpgrade, 'Produksi Maks');
      this.cls(this.stUpgrade, 'max', true);
      this.cls(this.stUpgrade, 'locked', false);
    } else {
      const uc = upgradeCost(state);
      this.set('stup', this.stUpgrade, `Produksi Lv.${state.depot.level + 1}<small>${coin(uc)}</small>`);
      this.cls(this.stUpgrade, 'max', false);
      this.cls(this.stUpgrade, 'locked', locked || state.money < uc);
    }
    const mc = machineCost(state);
    if (mc === null) {
      this.set('stmc', this.stMachine, 'Mesin Maks');
      this.cls(this.stMachine, 'max', true);
      this.cls(this.stMachine, 'locked', false);
    } else {
      this.set('stmc', this.stMachine, `+ Mesin<small>${coin(mc)}</small>`);
      this.cls(this.stMachine, 'max', false);
      this.cls(this.stMachine, 'locked', locked || state.money < mc);
    }

    // Pulse tutorial
    for (const [k, el] of Object.entries(this.targets())) this.cls(el, 'pulse', this.pulseTarget === k);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    this.cls(this.soundBtn, 'muted', ctx.muted);
    this.soundSwitch.setAttribute('aria-checked', String(!ctx.muted));
  }

  private targets(): Record<Exclude<PulseTarget, null>, HTMLElement> {
    return { add: this.btnAdd, merge: this.btnMerge, expand: this.btnExpand, upgrade: this.stUpgrade, machine: this.stMachine };
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

  /** Gelembung tutorial kecil di posisi layar (px relatif #app). */
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

  /** Posisi atas-tengah tombol HUD (tutorial ditaruh di atas panel bawah). */
  anchorOf(t: Exclude<PulseTarget, null>): { x: number; y: number } {
    const el = this.targets()[t];
    const r = el.getBoundingClientRect();
    const app = this.root.getBoundingClientRect();
    const bar = this.stationBar.getBoundingClientRect();
    const side = bar.width < app.width * 0.9 && bar.left > app.left + app.width * 0.4;
    const top = side || t === 'upgrade' || t === 'machine' ? r.top : Math.min(r.top, bar.top);
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

  flashStationBar(): void {
    this.stationBar.classList.remove('flash');
    void this.stationBar.offsetWidth;
    this.stationBar.classList.add('flash');
  }

  showComplete(state: GameState): void {
    const city = cityDef(state);
    const b = buildingsDone(state);
    $('c-title').textContent = `${city.name} selesai!`;
    const items = [`${b.total} bangunan berdiri`, `Waktu ${fmtTime(state.stats.levelTime)}`, `Bonus ${coin(state.stats.lastCompletionBonus)}`];
    if (state.stats.lastLeftoverMoney > 0) items.push(`Sisa material dijual ${coin(state.stats.lastLeftoverMoney)}`);
    $('c-stats').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
    const next = CITIES[(state.levelIndex + 1) % CITIES.length];
    $('btn-next').innerHTML = `Kota Berikutnya<br><small style="font-size:12px;opacity:.9">${isLastLevel(state) ? 'Putaran baru · ' : ''}${next.name}</small>`;
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
