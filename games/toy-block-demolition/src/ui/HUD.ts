import { formatInt } from '../game/util';
import { ICONS } from './icons';

export type HintKind = 'none' | 'drive' | 'cargo' | 'full' | 'sell' | 'gate' | 'lastBlocks';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/**
 * Always-on HTML HUD over the canvas. Text is only touched when values change;
 * the coin counter tweens toward the authoritative balance.
 */
export class HUD {
  readonly root: HTMLElement;
  private areaName: HTMLElement;
  private areaBar: HTMLElement;
  private areaPct: HTMLElement;
  private coinText: HTMLElement;
  readonly coinPill: HTMLElement;
  readonly settingsBtn: HTMLButtonElement;
  readonly upgradeBtn: HTMLButtonElement;
  private upgradeBadge: HTMLElement;
  private cargo: HTMLElement;
  private cargoBar: HTMLElement;
  private cargoCount: HTMLElement;
  private cargoLabel: HTMLElement;
  private toastEl: HTMLElement;
  private bannerEl: HTMLElement;
  private hintEl: HTMLElement;
  private coinLayer: HTMLElement;
  private coinPool: HTMLElement[] = [];

  private displayCoins = 0;
  private targetCoins = 0;
  private shownCoinText = '';
  private lastCargo = '';
  private lastPct = -1;
  private cargoState = '';
  private toastTimer = 0;
  private bannerTimer = 0;
  private hintKind: HintKind = 'none';
  private upgradeVisible = false;
  private upgradeCount = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('hud');

    const top = el('div', 'hud-top');
    const area = el('div', 'area-chip');
    this.areaName = el('div', 'area-name', 'AREA 1');
    const prog = el('div', 'area-progress');
    const bar = el('div', 'bar');
    this.areaBar = el('i');
    bar.appendChild(this.areaBar);
    this.areaPct = el('span', 'pct', '0%');
    prog.append(bar, this.areaPct);
    area.append(this.areaName, prog);

    const right = el('div', 'top-right');
    this.coinPill = el('div', 'coin-pill');
    this.coinPill.innerHTML = ICONS.coin;
    this.coinText = el('span', 'coin-text', '0');
    this.coinPill.appendChild(this.coinText);
    this.coinPill.setAttribute('aria-live', 'polite');
    this.coinPill.setAttribute('aria-label', 'Coins');
    this.settingsBtn = el('button', 'icon-btn settings-btn', ICONS.gear);
    this.settingsBtn.type = 'button';
    this.settingsBtn.setAttribute('aria-label', 'Settings');
    right.append(this.coinPill, this.settingsBtn);
    top.append(area, right);

    this.toastEl = el('div', 'toast');
    this.toastEl.setAttribute('role', 'status');
    this.bannerEl = el('div', 'banner');
    this.hintEl = el('div', 'hint');

    const bottom = el('div', 'hud-bottom');
    this.upgradeBtn = el('button', 'upgrade-btn');
    this.upgradeBtn.type = 'button';
    this.upgradeBtn.innerHTML = `${ICONS.wrench}<span>UPGRADE</span>`;
    this.upgradeBadge = el('b', 'badge');
    this.upgradeBtn.appendChild(this.upgradeBadge);
    this.upgradeBtn.setAttribute('aria-label', 'Open upgrades');

    this.cargo = el('div', 'cargo');
    this.cargo.innerHTML = ICONS.bin;
    const cbar = el('div', 'cargo-bar');
    this.cargoBar = el('i');
    cbar.appendChild(this.cargoBar);
    const ctext = el('div', 'cargo-text');
    this.cargoCount = el('span', 'cargo-count', '0 / 96');
    this.cargoLabel = el('span', 'cargo-label', 'CARGO');
    ctext.append(this.cargoLabel, this.cargoCount);
    this.cargo.append(ctext, cbar);
    bottom.append(this.cargo, this.upgradeBtn);

    this.coinLayer = el('div', 'coin-layer');
    for (let i = 0; i < 12; i++) {
      const c = el('div', 'fly-coin', ICONS.coin);
      this.coinLayer.appendChild(c);
      this.coinPool.push(c);
    }

    root.append(top, this.bannerEl, this.toastEl, this.hintEl, bottom, this.coinLayer);
  }

  setArea(label: string): void {
    this.areaName.textContent = label;
  }

  setProgress(ratio: number): void {
    const pct = Math.floor(ratio * 100);
    if (pct === this.lastPct) return;
    this.lastPct = pct;
    this.areaBar.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
    this.areaPct.textContent = `${pct}%`;
  }

  setCoins(value: number, instant = false): void {
    this.targetCoins = value;
    if (instant) this.displayCoins = value;
  }

  bumpCoins(): void {
    this.coinPill.classList.remove('bump');
    void this.coinPill.offsetWidth;
    this.coinPill.classList.add('bump');
  }

  setCargo(cur: number, cap: number, full: boolean, near: boolean): void {
    const text = `${cur} / ${cap}`;
    if (text !== this.lastCargo) {
      this.lastCargo = text;
      this.cargoCount.textContent = text;
      this.cargoBar.style.transform = `scaleX(${cap > 0 ? Math.min(1, cur / cap) : 0})`;
    }
    const state = full ? 'full' : near ? 'near' : '';
    if (state !== this.cargoState) {
      this.cargoState = state;
      this.cargo.classList.toggle('full', full);
      this.cargo.classList.toggle('near', near && !full);
      this.cargoLabel.textContent = full ? 'FULL' : 'CARGO';
    }
  }

  pulseCargo(): void {
    this.cargo.classList.remove('pulse');
    void this.cargo.offsetWidth;
    this.cargo.classList.add('pulse');
  }

  highlightCargo(on: boolean): void {
    this.cargo.classList.toggle('spot', on);
  }

  setUpgradeButton(visible: boolean, affordable: number): void {
    if (visible !== this.upgradeVisible) {
      this.upgradeVisible = visible;
      this.upgradeBtn.classList.toggle('show', visible);
      this.upgradeBtn.tabIndex = visible ? 0 : -1;
      this.upgradeBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    if (affordable !== this.upgradeCount) {
      this.upgradeCount = affordable;
      this.upgradeBadge.textContent = affordable > 0 ? String(affordable) : '';
      this.upgradeBadge.classList.toggle('on', affordable > 0);
    }
  }

  toast(text: string, ms = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    this.toastTimer = ms / 1000;
  }

  banner(title: string, sub: string, ms = 2200, kind = ''): void {
    this.bannerEl.innerHTML = '';
    this.bannerEl.className = `banner ${kind}`;
    const t = el('div', 'banner-title');
    t.textContent = title;
    const s = el('div', 'banner-sub');
    s.textContent = sub;
    this.bannerEl.append(t, s);
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerTimer = ms / 1000;
  }

  hint(kind: HintKind, text = ''): void {
    if (kind === this.hintKind && (kind === 'none' || this.hintEl.dataset.text === text)) return;
    this.hintKind = kind;
    this.hintEl.dataset.text = text;
    this.hintEl.className = `hint hint-${kind}`;
    if (kind === 'none') return;
    const icon = kind === 'drive' ? ICONS.hand : kind === 'full' || kind === 'sell' ? ICONS.arrowDown : '';
    this.hintEl.innerHTML = `${icon ? `<span class="hint-icon">${icon}</span>` : ''}<span class="hint-text"></span>`;
    (this.hintEl.querySelector('.hint-text') as HTMLElement).textContent = text;
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('show');
  }

  get currentHint(): HintKind {
    return this.hintKind;
  }

  /** Bounded flying coins from a screen point to the coin counter. */
  coinBurst(fromX: number, fromY: number, count: number): void {
    const target = this.coinPill.getBoundingClientRect();
    const rootR = this.root.getBoundingClientRect();
    const tx = target.left - rootR.left + 18;
    const ty = target.top - rootR.top + target.height / 2;
    let used = 0;
    for (const c of this.coinPool) {
      if (used >= count) break;
      if (c.classList.contains('go')) continue;
      used++;
      const delay = used * 70;
      const jx = (Math.random() - 0.5) * 40;
      const jy = (Math.random() - 0.5) * 24;
      c.style.setProperty('--fx', `${fromX + jx}px`);
      c.style.setProperty('--fy', `${fromY + jy}px`);
      c.style.setProperty('--tx', `${tx}px`);
      c.style.setProperty('--ty', `${ty}px`);
      c.style.animationDelay = `${delay}ms`;
      c.classList.add('go');
      window.setTimeout(() => c.classList.remove('go'), 760 + delay);
    }
  }

  update(dt: number): void {
    if (this.displayCoins !== this.targetCoins) {
      const diff = this.targetCoins - this.displayCoins;
      const step = Math.max(1, Math.abs(diff) * Math.min(1, dt * 7));
      this.displayCoins = Math.abs(diff) <= step ? this.targetCoins : this.displayCoins + Math.sign(diff) * step;
    }
    const txt = formatInt(this.displayCoins);
    if (txt !== this.shownCoinText) {
      this.shownCoinText = txt;
      this.coinText.textContent = txt;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
  }
}
