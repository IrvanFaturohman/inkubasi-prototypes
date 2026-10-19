/**
 * HTML/CSS overlay UI: HUD, mission, bottleneck chip, upgrade buttons and sheets.
 * Reads game state every frame; text nodes are only touched when their string changes.
 */
import { FIELDS } from './config';
import type { Game } from './economy';
import type { Sfx } from './audio';
import { formatMoney } from './scene3d';
import { FIELD_IDS, type BottleneckKind, type FieldId, type OfflineFieldSummary, type UpgradeKind } from './types';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  add: svg('<rect x="3" y="9" width="12" height="7" rx="2"/><path d="M15 12h3l2 3v1h-5"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="18" r="1.6"/><path d="M8 3v4M6 5h4"/>'),
  merge: svg('<path d="M5 4v5a4 4 0 0 0 4 4h6"/><path d="M19 4v5a4 4 0 0 1-4 4"/><path d="M12 13v7"/><path d="M9 17l3 3 3-3"/>'),
  auto: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2"/><path d="M12 4v5.8M5.4 15.5l4.7-2.4M18.6 15.5l-4.7-2.4"/>'),
  water: svg('<path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>'),
  speed: svg('<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.4"/>'),
  storage: svg('<path d="M3.5 8.5L12 4l8.5 4.5v9L12 22l-8.5-4.5z"/><path d="M3.5 8.5L12 13l8.5-4.5M12 13v9"/>'),
  expand: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/>'),
  farms: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/><path d="M9 14l6 6M15 14l-6 6"/>'),
  help: svg('<path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.4-1.5 1.2-1.5 2.2v.6"/><circle cx="12" cy="18" r=".6" fill="currentColor"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f2c14e" stroke="#c98f35" stroke-width="2"/><path d="M12 6.5v11M14.8 8.6c-.5-.8-1.5-1.3-2.8-1.3-1.7 0-2.8.9-2.8 2.1 0 2.9 5.8 1.6 5.8 4.6 0 1.3-1.2 2.2-3 2.2-1.4 0-2.5-.6-3-1.5" stroke="#8a5a1c" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  wheat: svg('<path d="M12 21V9"/><path d="M12 9c-2-1-3-3-3-5 2 1 3 3 3 5zM12 9c2-1 3-3 3-5-2 1-3 3-3 5zM12 13c-2-1-3-3-3-5 2 1 3 3 3 5zM12 13c2-1 3-3 3-5-2 1-3 3-3 5zM12 17c-2-1-3-3-3-5 2 1 3 3 3 5zM12 17c2-1 3-3 3-5-2 1-3 3-3 5z"/>'),
  corn: svg('<path d="M12 3c2.5 2 3 6 3 9s-1 6-3 7c-2-1-3-4-3-7s.5-7 3-9z"/><path d="M9.5 9h5M9.2 12h5.6M9.6 15h4.8"/><path d="M9 19c-2-1-4-3-4.5-6M15 19c2-1 4-3 4.5-6"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  hand: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10V8.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4 15.5a1.5 1.5 0 0 1 2.4-1.8L9 16"/>'),
};

interface ButtonDef {
  kind: UpgradeKind | 'farms';
  label: string;
  color: string;
}

const BUTTONS: ButtonDef[] = [
  { kind: 'add', label: 'ADD', color: '#f08a3a' },
  { kind: 'merge', label: 'MERGE', color: '#e2553b' },
  { kind: 'auto', label: 'AUTO', color: '#2fa39a' },
  { kind: 'expand', label: 'EXPAND', color: '#b07a3c' },
  { kind: 'water', label: 'WATER', color: '#4a9bd6' },
  { kind: 'speed', label: 'SPEED', color: '#dd9f22' },
  { kind: 'storage', label: 'STORAGE', color: '#5f9f45' },
  { kind: 'farms', label: 'FARMS', color: '#8a6fc4' },
];

const BOTTLENECK_ICON: Record<BottleneckKind, string> = {
  idle: '#9c8a74',
  storage: '#e0902a',
  harvesters: '#e2553b',
  crops: '#4a9bd6',
  reach: '#b8364a',
  good: '#5f9f45',
};

export interface UIHooks {
  buy(kind: UpgradeKind): boolean;
  switchField(id: FieldId): void;
  unlockField(id: FieldId): boolean;
  setMuted(m: boolean): void;
  setVolume(v: number): void;
  reset(): void;
  storageOk: boolean;
}

type ButtonEls = { root: HTMLButtonElement; effect: HTMLElement; price: HTMLElement; key: string };

export class UI {
  readonly stage: HTMLElement;
  readonly overlayRoot: HTMLElement;
  private moneyEl: HTMLElement;
  private incomeEl: HTMLElement;
  private fieldChip: HTMLButtonElement;
  private missionEl: HTMLElement;
  private missionText: HTMLElement;
  private missionReward: HTMLElement;
  private bottleneckEl: HTMLElement;
  private bottleneckText: HTMLElement;
  private holdHint: HTMLElement;
  private toasts: HTMLElement;
  private fade: HTMLElement;
  private sheet: HTMLElement;
  private sheetBody: HTMLElement;
  private buttons = new Map<string, ButtonEls>();
  private shownMoney = 0;
  private cache = new Map<HTMLElement, string>();
  private sheetKind: 'farms' | 'help' | 'settings' | 'offline' | null = null;
  private sheetRefresh = 0;
  private resetArmed = false;
  private bottleneckHold = 0;
  private bottleneckShown: BottleneckKind | null = null;

  constructor(
    root: HTMLElement,
    private game: Game,
    private sfx: Sfx,
    private hooks: UIHooks,
  ) {
    root.innerHTML = `
      <header class="hud">
        <div class="hud-row">
          <div class="money-box" aria-live="polite">
            <span class="coin">${ICONS.coin}</span>
            <div class="money-col">
              <span class="money" id="money">$0</span>
              <span class="income" id="income">$0/min</span>
            </div>
          </div>
          <button class="field-chip" id="field-chip" aria-label="Open farms"></button>
          <button class="icon-btn" id="btn-help" aria-label="Help">${ICONS.help}</button>
          <button class="icon-btn" id="btn-settings" aria-label="Settings">${ICONS.gear}</button>
        </div>
        <div class="mission" id="mission">
          <span class="mission-tag">GOAL</span>
          <span class="mission-text" id="mission-text"></span>
          <span class="mission-reward" id="mission-reward"></span>
        </div>
      </header>
      <main class="stage" id="stage" aria-label="Field — hold to drive">
        <div class="overlay" id="overlay"></div>
        <div class="bottleneck" id="bottleneck"><span class="b-dot"></span><span class="b-text"></span></div>
        <div class="hold-hint" id="hold-hint"><span class="hand">${ICONS.hand}</span><span>Hold to harvest</span></div>
        <div class="toasts" id="toasts" aria-live="polite"></div>
        <div class="fade" id="fade"></div>
      </main>
      <nav class="panel" id="panel" aria-label="Upgrades"></nav>
      <div class="sheet-backdrop" id="sheet" role="dialog" aria-modal="true">
        <div class="sheet"><div class="sheet-body" id="sheet-body"></div></div>
      </div>`;
    const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    this.stage = $('stage');
    this.overlayRoot = $('overlay');
    this.moneyEl = $('money');
    this.incomeEl = $('income');
    this.fieldChip = $<HTMLButtonElement>('field-chip');
    this.missionEl = $('mission');
    this.missionText = $('mission-text');
    this.missionReward = $('mission-reward');
    this.bottleneckEl = $('bottleneck');
    this.bottleneckText = this.bottleneckEl.querySelector('.b-text')!;
    this.holdHint = $('hold-hint');
    this.toasts = $('toasts');
    this.fade = $('fade');
    this.sheet = $('sheet');
    this.sheetBody = $('sheet-body');

    const panel = $('panel');
    for (const def of BUTTONS) {
      const b = document.createElement('button');
      b.className = 'upg';
      b.dataset.kind = def.kind;
      b.style.setProperty('--c', def.color);
      b.innerHTML = `<span class="upg-top"><span class="upg-icon">${ICONS[def.kind]}</span><span class="upg-label">${def.label}</span></span>
        <span class="upg-effect"></span><span class="upg-price"></span>`;
      b.addEventListener('click', () => this.onButton(def.kind, b));
      panel.appendChild(b);
      this.buttons.set(def.kind, { root: b, effect: b.querySelector('.upg-effect')!, price: b.querySelector('.upg-price')!, key: '' });
    }
    this.fieldChip.addEventListener('click', () => this.openSheet('farms'));
    $('btn-help').addEventListener('click', () => this.openSheet('help'));
    $('btn-settings').addEventListener('click', () => this.openSheet('settings'));
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) this.closeSheet();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.sheetKind) this.closeSheet();
    });
    this.shownMoney = game.state.money;
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  private onButton(kind: UpgradeKind | 'farms', el: HTMLButtonElement): void {
    this.sfx.unlock();
    if (kind === 'farms') {
      this.sfx.ui();
      this.openSheet('farms');
      return;
    }
    if (this.hooks.buy(kind)) {
      el.classList.remove('punch');
      void el.offsetWidth;
      el.style.setProperty('--punch-dur', `${0.22 + Math.random() * 0.1}s`);
      el.classList.add('punch');
    } else {
      this.sfx.deny();
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      const o = this.game.offer(kind);
      if (o.state === 'locked' && o.reason) this.toast(o.reason, 'info');
    }
  }

  update(dt: number): void {
    const g = this.game;
    const st = g.state;
    const f = g.current;
    // money tween
    const diff = st.money - this.shownMoney;
    this.shownMoney = Math.abs(diff) < 0.5 ? st.money : this.shownMoney + diff * (1 - Math.exp(-dt * 12));
    this.set(this.moneyEl, `$${formatMoney(this.shownMoney)}`);
    this.set(this.incomeEl, `+$${formatMoney(g.totalIncomePerMin())}/min`);
    this.set(this.fieldChip, FIELDS[st.current].name);
    this.fieldChip.dataset.field = st.current;

    // mission
    const mis = g.mission();
    if (mis) {
      let text = mis.text;
      if (mis.kind === 'unlockCorn') {
        const info = g.unlockInfo('corn');
        text += info.needsAuto ? ' · needs Auto Drive' : info.lifetimeProgress < 1 ? ` · ${Math.floor(info.lifetimeProgress * 100)}%` : ' · ready in FARMS';
      }
      this.set(this.missionText, text);
      this.set(this.missionReward, `+$${formatMoney(mis.reward)}`);
      this.missionEl.classList.remove('done');
    } else {
      this.set(this.missionText, 'All goals done — keep the harvest rolling');
      this.set(this.missionReward, '');
      this.missionEl.classList.add('done');
    }

    // bottleneck (held a moment so it doesn't flicker)
    const b = g.bottleneck();
    this.bottleneckHold -= dt;
    if (b.kind !== this.bottleneckShown && (this.bottleneckHold <= 0 || b.kind === 'idle' || this.bottleneckShown === 'idle')) {
      this.bottleneckShown = b.kind;
      this.bottleneckHold = 2.5;
      this.set(this.bottleneckText, b.text);
      this.bottleneckEl.style.setProperty('--b', BOTTLENECK_ICON[b.kind]);
      this.bottleneckEl.dataset.kind = b.kind;
    }
    const hintKind = this.bottleneckShown === b.kind ? b.hint : null;

    // hold hint until the player has driven a bit (the chip would only repeat it)
    const hintOn = st.onboardMoved < 2.5 && !f.auto && !g.isPressing();
    this.holdHint.classList.toggle('show', hintOn);
    this.bottleneckEl.classList.toggle('hidden', hintOn || st.onboardMoved < 2.5);

    // buttons
    for (const [kind, els] of this.buttons) {
      if (kind === 'farms') {
        const info = g.unlockInfo('corn');
        let effect: string;
        let price: string;
        let cls = '';
        if (info.unlocked) {
          effect = `${FIELD_IDS.filter((id) => st.fields[id].unlocked).length} fields`;
          price = st.current === 'wheat' ? 'Corn ›' : 'Wheat ›';
        } else if (info.canBuy) {
          effect = 'Corn ready!';
          price = `$${formatMoney(info.cost)}`;
          cls = 'is-ready';
        } else {
          effect = info.needsAuto ? 'Corn: AUTO' : info.lifetimeProgress >= 1 ? 'Open Corn' : `Corn ${Math.floor(info.lifetimeProgress * 100)}%`;
          price = `$${formatMoney(info.cost)}`;
          cls = 'is-poor';
        }
        const key = effect + price + cls;
        if (key !== els.key) {
          els.key = key;
          els.effect.textContent = effect;
          els.price.textContent = price;
          els.root.className = `upg ${cls}`;
          els.root.setAttribute('aria-label', `Farms: ${effect}`);
        }
        continue;
      }
      const o = g.offer(kind as UpgradeKind);
      let price: string;
      let effect = o.effect;
      if (o.state === 'max') price = 'MAX';
      else if (o.state === 'owned') price = 'ON';
      else if (o.state === 'locked') {
        effect = o.reason ?? effect;
        price = o.cost > 0 && kind !== 'merge' && kind !== 'add' ? `$${formatMoney(o.cost)}` : '—';
      } else price = `$${formatMoney(o.cost)}`;
      const hinted = hintKind === kind && (o.state === 'ok' || o.state === 'poor');
      const key = `${o.state}|${effect}|${price}|${hinted}`;
      if (key !== els.key) {
        els.key = key;
        els.effect.textContent = effect;
        els.price.textContent = price;
        els.root.className = `upg is-${o.state}${hinted ? ' is-hint' : ''}`;
        els.root.setAttribute('aria-label', `${kind}: ${effect}, ${price}`);
        els.root.setAttribute('aria-disabled', o.state === 'ok' ? 'false' : 'true');
      }
    }

    if (this.sheetKind === 'farms' || this.sheetKind === 'settings') {
      this.sheetRefresh -= dt;
      if (this.sheetRefresh <= 0) {
        this.sheetRefresh = 0.5;
        if (this.sheetKind === 'farms') this.renderFarms();
      }
    }
  }

  toast(text: string, kind: 'good' | 'info' = 'good'): void {
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  fadeSwap(swap: () => void): void {
    this.fade.classList.add('on');
    window.setTimeout(() => {
      swap();
      this.fade.classList.remove('on');
    }, 180);
  }

  // ─── Sheets ───────────────────────────────────────────────────────────────

  openSheet(kind: 'farms' | 'help' | 'settings' | 'offline'): void {
    this.sheetKind = kind;
    this.resetArmed = false;
    this.sheet.classList.add('open');
    this.sheetRefresh = 0.5;
    if (kind === 'farms') this.renderFarms();
    else if (kind === 'help') this.renderHelp();
    else if (kind === 'settings') this.renderSettings();
  }

  closeSheet(): void {
    this.sheetKind = null;
    this.sheet.classList.remove('open');
  }

  get sheetOpen(): boolean {
    return this.sheetKind !== null;
  }

  private renderFarms(): void {
    const g = this.game;
    const st = g.state;
    const card = (id: FieldId) => {
      const f = st.fields[id];
      const cfg = FIELDS[id];
      const icon = ICONS[cfg.crop];
      if (f.unlocked) {
        const tiers = [1, 2, 3]
          .map((t) => [t, f.harvesters.filter((h) => h.tier === t).length] as const)
          .filter(([, n]) => n > 0)
          .map(([t, n]) => `T${t}×${n}`)
          .join(' ');
        const viewing = st.current === id;
        return `<div class="farm-card ${viewing ? 'viewing' : ''}" data-field="${id}">
          <div class="farm-head"><span class="farm-icon">${icon}</span><b>${cfg.name}</b>${viewing ? '<span class="badge">ON SCREEN</span>' : ''}</div>
          <div class="farm-stats">
            <span><b>$${formatMoney(g.incomePerMin(id))}</b>/min</span>
            <span>${tiers || 'no harvesters'}</span>
            <span>Auto <b>${f.auto ? 'ON' : 'OFF'}</b></span>
            <span>${formatMoney(f.unitsSold)} ${cfg.cropName} sold</span>
          </div>
          ${!f.auto && !viewing ? '<div class="farm-note">Without AUTO this field waits while you are away.</div>' : ''}
          ${viewing ? '' : `<button class="sheet-btn" data-go="${id}">View ${cfg.name}</button>`}
        </div>`;
      }
      const info = g.unlockInfo(id);
      const u = cfg.unlock!;
      return `<div class="farm-card locked" data-field="${id}">
        <div class="farm-head"><span class="farm-icon">${icon}</span><b>${cfg.name}</b><span class="badge dim">LOCKED</span></div>
        <div class="farm-desc">$${cfg.unitValue} per ${cfg.cropName} (wheat $${FIELDS.wheat.unitValue}) · regrows in ${cfg.growTime}s · own harvesters &amp; upgrades</div>
        <div class="req ${info.needsAuto ? '' : 'ok'}">${info.needsAuto ? '○' : '✓'} ${FIELDS[u.needsAutoOn].name} Auto Drive</div>
        <div class="req ${info.lifetimeProgress >= 1 ? 'ok' : ''}">${info.lifetimeProgress >= 1 ? '✓' : '○'} Lifetime earnings $${formatMoney(Math.min(st.lifetime, u.lifetime))} / $${formatMoney(u.lifetime)}</div>
        <div class="bar"><span style="width:${Math.floor(info.lifetimeProgress * 100)}%"></span></div>
        <button class="sheet-btn primary" data-unlock="${id}" ${info.canBuy ? '' : 'disabled'}>Open for $${formatMoney(info.cost)}</button>
      </div>`;
    };
    this.sheetBody.innerHTML = `
      <h2>Farms</h2>
      ${FIELD_IDS.map(card).join('')}
      <p class="sheet-foot">Income is measured from real silo sales over the last 60 s. Fields with AUTO keep harvesting while another field is on screen.</p>
      <button class="sheet-btn" data-close>Close</button>`;
    this.bindSheet();
  }

  private renderHelp(): void {
    const muted = this.game.state.muted;
    this.sheetBody.innerHTML = `
      <h2>Harvest Circuit</h2>
      <ul class="help">
        <li><b>Hold</b> the field (or Space) to drive every harvester along the loop. A tap gives a short push.</li>
        <li>Machines cut <b>ripe</b> crops their header reaches. Cut patches regrow on their own timer.</li>
        <li>Crops go into the <b>crate</b>. A full crate skips crops — sell by passing the <b>silo</b>.</li>
        <li><b>ADD</b> a harvester. <b>MERGE</b> two of the same tier: bigger crate and a wider header that reaches the next row (row flags show the tier).</li>
        <li><b>WATER</b> regrows faster · <b>SPEED</b> drives faster · <b>STORAGE</b> bigger crates.</li>
        <li><b>AUTO</b> drives on its own — also while you look at another field or are away (up to 2 h).</li>
        <li><b>EXPAND</b> adds corridors, then deep rows for Tier 3. <b>FARMS</b> opens the Corn Field.</li>
      </ul>
      <div class="sheet-row">
        <button class="sheet-btn" data-mute>${muted ? ICONS.mute + ' Sound off' : ICONS.sound + ' Sound on'}</button>
        <button class="sheet-btn primary" data-close>Play</button>
      </div>`;
    this.bindSheet();
  }

  private renderSettings(): void {
    const st = this.game.state;
    this.sheetBody.innerHTML = `
      <h2>Settings</h2>
      <div class="setting">
        <span>Sound</span>
        <button class="sheet-btn small" data-mute>${st.muted ? 'Off' : 'On'}</button>
      </div>
      <label class="setting">
        <span>Volume</span>
        <input type="range" min="0" max="100" value="${Math.round(st.volume * 100)}" data-volume aria-label="Volume" />
      </label>
      <div class="setting">
        <span>Progress</span>
        <span class="muted">${this.hooks.storageOk ? 'Saved on this device' : 'Storage unavailable — progress won’t be kept'}</span>
      </div>
      <button class="sheet-btn danger" data-reset>${this.resetArmed ? 'Tap again to erase everything' : 'Reset progress'}</button>
      <button class="sheet-btn" data-close>Close</button>`;
    this.bindSheet();
  }

  showOffline(res: OfflineFieldSummary[]): void {
    const secs = res[0]?.seconds ?? 0;
    const total = res.reduce((a, r) => a + r.earned, 0);
    const dur = secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m` : secs >= 60 ? `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s` : `${Math.floor(secs)}s`;
    const rows = res
      .map((r) => {
        const cfg = FIELDS[r.field];
        const body = r.auto
          ? `<b>+$${formatMoney(r.earned)}</b><span>${formatMoney(r.units)} ${cfg.cropName} · ${r.loads} loads</span>`
          : `<b>—</b><span>No Auto Drive: nothing harvested</span>`;
        return `<div class="off-row"><span class="farm-icon">${ICONS[cfg.crop]}</span><span class="off-name">${cfg.name}</span><span class="off-val">${body}</span></div>`;
      })
      .join('');
    this.sheetKind = 'offline';
    this.sheet.classList.add('open');
    this.sheetBody.innerHTML = `
      <h2>Welcome back!</h2>
      <p class="sheet-sub">Away ${dur}${secs >= 7200 ? ' (2 h max)' : ''}. Your harvesters kept to the loop:</p>
      ${rows}
      <div class="off-total">Total <b>+$${formatMoney(total)}</b></div>
      <button class="sheet-btn primary" data-close>Collect</button>`;
    this.bindSheet();
  }

  private bindSheet(): void {
    const body = this.sheetBody;
    body.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sfx.ui();
        this.closeSheet();
      }),
    );
    body.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        this.hooks.switchField(b.dataset.go as FieldId);
        this.closeSheet();
      }),
    );
    body.querySelectorAll<HTMLButtonElement>('[data-unlock]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.hooks.unlockField(b.dataset.unlock as FieldId)) this.closeSheet();
        else this.sfx.deny();
      }),
    );
    body.querySelectorAll<HTMLButtonElement>('[data-mute]').forEach((b) =>
      b.addEventListener('click', () => {
        this.hooks.setMuted(!this.game.state.muted);
        this.sfx.unlock();
        this.sfx.ui();
        if (this.sheetKind === 'help') this.renderHelp();
        else this.renderSettings();
      }),
    );
    body.querySelectorAll<HTMLInputElement>('[data-volume]').forEach((i) =>
      i.addEventListener('input', () => this.hooks.setVolume(Number(i.value) / 100)),
    );
    body.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.resetArmed) {
          this.resetArmed = true;
          b.textContent = 'Tap again to erase everything';
          b.classList.add('armed');
          return;
        }
        this.hooks.reset();
      }),
    );
  }
}
