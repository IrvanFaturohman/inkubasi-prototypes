import { LEVELS } from '../config/levels';
import { canAddVehicle, canExpand, isLastLevel } from '../game/actions';
import { completedStageCount } from '../game/building';
import {
  addCost,
  buildCost,
  canUpgradeMore,
  expandCost,
  findMergePair,
  isSlotUnlocked,
  levelDef,
  maxVehicles,
  productionRate,
  projectOf,
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
  stationAction(slot: number): void;
  selectSlot(slot: number): void;
  toggleSound(): void;
  openSettings(): void;
  closeSettings(): void;
  setSound(on: boolean): void;
  reset(): void;
  next(): void;
}

export interface HudContext {
  selectedSlot: number;
  selectedVehicle: number | null;
  muted: boolean;
}

export type PulseTarget = 'add' | 'merge' | 'expand' | 'station' | null;

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
  private readonly stTabs = $('st-tabs');
  private readonly stInfo = $('st-info');
  private readonly stAction = $<HTMLButtonElement>('st-action');
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
  private tabsKey = '';
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
    tap(this.stAction, () => h.stationAction(Number(this.stAction.dataset.slot ?? 0)));
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
    this.stTabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.st-tab');
      if (t) {
        e.stopPropagation();
        h.selectSlot(Number(t.dataset.slot));
      }
    });
    // Semua elemen HUD menelan pointerdown supaya tidak memicu boost di kanvas.
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
    const level = levelDef(state);
    const project = projectOf(state);
    const look = MATERIAL_LOOK[level.material];

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

    // Proyek
    this.set('pname', this.pName, `${project.name}`);
    this.set('pcount', this.pCount, `<b>${fmtFull(state.delivered)}</b>/${fmtFull(project.target)} ${look.unit}`);
    this.pFill.style.width = `${Math.min(100, (state.delivered / project.target) * 100).toFixed(1)}%`;
    const ticksKey = project.id + project.target;
    if (ticksKey !== this.ticksKey) {
      this.ticksKey = ticksKey;
      this.pTicks.innerHTML = project.stageEnd
        .slice(0, -1)
        .map((e) => `<span style="left:${((e / project.target) * 100).toFixed(2)}%"></span>`)
        .join('');
    }
    const done = completedStageCount(project, state.delivered);
    const n = project.stageNames.length;
    this.set(
      'pstage',
      this.pStage,
      state.completed ? `<b>Selesai!</b> Semua ${n} tahap tuntas` : `Tahap ${done + 1}/${n} · <b>${project.stageNames[Math.min(done, n - 1)]}</b> · ${level.areaName}`,
    );

    // Hint bottleneck (tidak memblokir, hanya teks kecil)
    let hint = '';
    if (!state.completed && state.stats.levelTime > 20 && rt.freeze <= 0) {
      const avgLoad = rt.recentLoads.length >= 4 ? rt.recentLoads.reduce((a, b) => a + b, 0) / rt.recentLoads.length : 1;
      if (rt.storageFill > 0.8) hint = `${look.label} menumpuk — tambah atau gabung kendaraan`;
      else if (avgLoad < 0.5 && rt.storageFill < 0.2) hint = 'Kendaraan sering kosong — tingkatkan produksi / bangun mesin';
    }
    this.set('hint', this.hintEl, hint);
    this.hintEl.hidden = hint === '';

    // Boost
    const b = rt.boost;
    this.cls(this.boostEl, 'show', !state.completed && (b.energy < 0.995 || b.holding));
    this.cls(this.boostEl, 'tired', b.exhausted);
    this.boostFill.style.width = `${(b.energy * 100).toFixed(1)}%`;

    // Tombol utama
    const locked = state.completed;
    const ac = addCost(state);
    const canAdd = canAddVehicle(state);
    const full = state.vehicles.length >= maxVehicles(state);
    this.set('add', this.addCostEl, full ? 'Jalur penuh' : coin(ac));
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
    this.set('expand', this.expandCostEl, ec === null ? 'Maksimum' : coin(ec));
    const canEx = canExpand(state);
    this.cls(this.btnExpand, 'locked', locked || !canEx.ok);
    this.afford(this.btnExpand, ec === null ? 0 : state.money / ec, ec !== null && !canEx.ok);

    // Panel stasiun
    const tabsKey = state.stations.map((s, i) => `${s.built ? 1 : 0}${isSlotUnlocked(state, i) ? 1 : 0}${ctx.selectedSlot === i ? 1 : 0}`).join('|');
    if (tabsKey !== this.tabsKey) {
      this.tabsKey = tabsKey;
      this.stTabs.innerHTML = state.stations
        .map((s, i) => {
          const unlocked = isSlotUnlocked(state, i);
          const c = ['st-tab', ctx.selectedSlot === i ? 'active' : '', !unlocked ? 'locked' : '', unlocked && !s.built ? 'empty' : ''].join(' ');
          return `<button type="button" class="${c}" data-slot="${i}" aria-label="Mesin ${i + 1}">${!unlocked ? '🔒' : !s.built ? '+' : i + 1}</button>`;
        })
        .join('');
    }
    const slot = Math.min(ctx.selectedSlot, state.stations.length - 1);
    const st = state.stations[slot];
    const slotDef = level.slots[slot];
    const unlocked = isSlotUnlocked(state, slot);
    this.stAction.dataset.slot = String(slot);
    let info: string;
    let action: string;
    let actionState: 'ok' | 'locked' | 'max' = 'ok';
    if (!unlocked) {
      info = `<div class="st-name">Slot ${slot + 1} terkunci</div><div class="st-meta">Perluas jalur untuk membuka slot</div>`;
      action = ec === null ? 'Terkunci' : `Perluas Jalur<small>${coin(ec)}</small>`;
      actionState = canEx.ok ? 'ok' : 'locked';
    } else if (!st.built) {
      const bc = buildCost(state, slot);
      info = `<div class="st-name">Slot ${slot + 1} kosong</div><div class="st-meta">Mesin baru + conveyor + penyimpanan</div>`;
      action = `Bangun Mesin<small>${coin(bc)}</small>`;
      actionState = state.money >= bc && !locked ? 'ok' : 'locked';
    } else {
      const cap = storageCapacity(st);
      const isFull = st.storage + st.conveyor.length >= cap && st.storage >= cap;
      info = `<div class="st-name">${slotDef.name} · Lv${st.level}</div><div class="st-meta${isFull ? ' full' : ''}">${fmtRate(productionRate(state, st))}/dtk · Stok ${st.storage}/${cap}${isFull ? ' · Penuh!' : ''}</div>`;
      if (!canUpgradeMore(st)) {
        action = 'Produksi Maks';
        actionState = 'max';
      } else {
        const uc = upgradeCost(state, st);
        action = `Produksi Lv. ${st.level + 1}<small>${coin(uc)}</small>`;
        actionState = state.money >= uc && !locked ? 'ok' : 'locked';
      }
    }
    this.set('stinfo', this.stInfo, info);
    this.set('staction', this.stAction, action);
    this.cls(this.stAction, 'locked', actionState === 'locked');
    this.cls(this.stAction, 'max', actionState === 'max');

    // Pulse tutorial
    const targets: Record<Exclude<PulseTarget, null>, HTMLElement> = { add: this.btnAdd, merge: this.btnMerge, expand: this.btnExpand, station: this.stAction };
    for (const [k, el] of Object.entries(targets)) this.cls(el, 'pulse', this.pulseTarget === k);

    // Toast
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }

    this.cls(this.soundBtn, 'muted', ctx.muted);
    this.soundSwitch.setAttribute('aria-checked', String(!ctx.muted));
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

  /** Posisi atas-tengah sebuah tombol HUD (untuk menempatkan tutorial). */
  anchorOf(t: Exclude<PulseTarget, null>): { x: number; y: number } {
    const el = { add: this.btnAdd, merge: this.btnMerge, expand: this.btnExpand, station: this.stAction }[t];
    const r = el.getBoundingClientRect();
    const app = this.root.getBoundingClientRect();
    // Gelembung ditaruh di atas seluruh panel bawah supaya tidak menutupi info stasiun.
    const bar = this.stationBar.getBoundingClientRect();
    const top = bar.width < app.width * 0.9 && bar.left > app.left + app.width * 0.4 ? r.top : Math.min(r.top, bar.top);
    return { x: r.left - app.left + r.width / 2, y: top - app.top - 10 };
  }

  moneyGain(amount: number): void {
    if (amount <= 0) return;
    this.gainAcc += amount;
    if (this.gainTimer <= 0) this.gainTimer = 0.18;
  }

  toast(msg: string, seconds = 1.6): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  bought(which: 'add' | 'merge' | 'expand' | 'station'): void {
    const el = { add: this.btnAdd, merge: this.btnMerge, expand: this.btnExpand, station: this.stAction }[which];
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
    const project = projectOf(state);
    const look = MATERIAL_LOOK[project.material];
    $('c-title').textContent = `${project.name} selesai!`;
    const items = [
      `${fmtFull(project.target)} ${look.unit} terpasang`,
      `Waktu ${fmtTime(state.stats.levelTime)}`,
      `Bonus ${coin(state.stats.lastCompletionBonus)}`,
    ];
    if (state.stats.lastLeftoverMoney > 0) items.push(`Sisa material dijual ${coin(state.stats.lastLeftoverMoney)}`);
    $('c-stats').innerHTML = items.map((t) => `<li>${t}</li>`).join('');
    const nextIdx = (state.levelIndex + 1) % LEVELS.length;
    const nextLevel = LEVELS[nextIdx];
    $('btn-next').innerHTML = isLastLevel(state) ? `Proyek Berikutnya<br><small style="font-size:12px;opacity:.9">Putaran baru · ${nextLevel.areaName}</small>` : `Proyek Berikutnya<br><small style="font-size:12px;opacity:.9">${nextLevel.areaName}</small>`;
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
