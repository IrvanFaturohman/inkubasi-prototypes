import { MAX_UPGRADE_LEVEL, UPGRADES, UPGRADE_KEYS, type QualityLevel, type UpgradeKey } from '../game/config';
import { upgradePrice, type Progress, type Settings } from '../game/state';
import { formatInt } from '../game/util';
import { ICONS } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export interface PanelHandlers {
  onBuy: (key: UpgradeKey) => void;
  onCloseUpgrade: () => void;
  onSettingsChange: (s: Settings) => void;
  onCloseSettings: () => void;
  onResetProgress: () => void;
  onFreePlay: () => void;
  onNewRun: () => void;
  onUiTap: () => void;
}

function fmtValue(key: UpgradeKey, v: number): string {
  switch (key) {
    case 'roller':
      return `${v.toFixed(2)} m`;
    case 'cargo':
      return `${v}`;
    case 'power':
      return `×${v.toFixed(1)}`;
    case 'speed':
      return `${v.toFixed(2)} m/s`;
  }
}

/**
 * Modal panels: upgrades (bottom sheet), settings, final completion,
 * confirmation and notices. Backdrops swallow input so nothing reaches gameplay.
 */
export class Panels {
  private h: PanelHandlers;
  private upgrade: HTMLElement;
  private cards = new Map<UpgradeKey, { card: HTMLElement; level: HTMLElement; effect: HTMLElement; values: HTMLElement; btn: HTMLButtonElement; price: HTMLElement; tag: HTMLElement }>();
  private upgradeCoins: HTMLElement;
  private upgradeTip: HTMLElement;
  private settings: HTMLElement;
  private settingsState: Settings | null = null;
  private completion: HTMLElement;
  private confirmEl: HTMLElement;
  private noticeEl: HTMLElement;
  private lastFocus: HTMLElement | null = null;
  private highlight: UpgradeKey | null = null;
  hapticsSupported = false;

  constructor(root: HTMLElement, handlers: PanelHandlers) {
    this.h = handlers;
    this.upgrade = this.buildUpgrade();
    this.upgradeCoins = this.upgrade.querySelector('.sheet-coins span')!;
    this.upgradeTip = this.upgrade.querySelector('.sheet-tip')!;
    this.settings = this.buildSettings();
    this.completion = el('div', 'overlay completion');
    this.confirmEl = el('div', 'overlay confirm');
    this.noticeEl = el('div', 'overlay notice');
    root.append(this.upgrade, this.settings, this.completion, this.confirmEl, this.noticeEl);
    for (const o of [this.upgrade, this.settings, this.completion, this.confirmEl, this.noticeEl]) {
      o.addEventListener('pointerdown', (e) => e.stopPropagation());
      o.setAttribute('aria-hidden', 'true');
    }
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.isOpen(this.confirmEl)) this.close(this.confirmEl);
      else if (this.isOpen(this.upgrade)) this.h.onCloseUpgrade();
      else if (this.isOpen(this.settings)) this.h.onCloseSettings();
    });
  }

  private isOpen(o: HTMLElement): boolean {
    return o.classList.contains('open');
  }

  private open(o: HTMLElement, focusSel?: string): void {
    this.lastFocus = document.activeElement as HTMLElement | null;
    o.classList.add('open');
    o.setAttribute('aria-hidden', 'false');
    const f = (focusSel ? o.querySelector(focusSel) : o.querySelector('button')) as HTMLElement | null;
    window.setTimeout(() => f?.focus({ preventScroll: true }), 30);
  }

  private close(o: HTMLElement): void {
    o.classList.remove('open');
    o.setAttribute('aria-hidden', 'true');
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.blur();
  }

  get anyOpen(): boolean {
    return [this.upgrade, this.settings, this.completion, this.confirmEl, this.noticeEl].some((o) => this.isOpen(o));
  }

  // ------------------------------------------------------------- upgrades
  private buildUpgrade(): HTMLElement {
    const o = el('div', 'overlay upgrade');
    const sheet = el('div', 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Upgrades');
    const head = el('div', 'sheet-head');
    const title = el('div', 'sheet-title', 'UPGRADES');
    const coins = el('div', 'sheet-coins', `${ICONS.coin}<span>0</span>`);
    const close = el('button', 'icon-btn close-btn', ICONS.close);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close upgrades');
    close.addEventListener('click', () => {
      this.h.onUiTap();
      this.h.onCloseUpgrade();
    });
    head.append(title, coins, close);
    const tip = el('div', 'sheet-tip');
    const grid = el('div', 'card-grid');
    for (const key of UPGRADE_KEYS) {
      const def = UPGRADES[key];
      const card = el('div', `card card-${key}`);
      const icon = el('div', 'card-icon', ICONS[key]);
      const info = el('div', 'card-info');
      const name = el('div', 'card-name', def.label);
      const level = el('div', 'card-level');
      const effect = el('div', 'card-effect', def.effect);
      const values = el('div', 'card-values');
      info.append(name, level, effect, values);
      const btn = el('button', 'buy-btn');
      btn.type = 'button';
      const price = el('span', 'price');
      const tag = el('span', 'buy-tag');
      btn.append(tag, price);
      btn.addEventListener('click', () => this.h.onBuy(key));
      card.append(icon, info, btn);
      grid.appendChild(card);
      this.cards.set(key, { card, level, effect, values, btn, price, tag });
    }
    const done = el('button', 'wide-btn done-btn', 'BACK TO WORK');
    done.type = 'button';
    done.addEventListener('click', () => {
      this.h.onUiTap();
      this.h.onCloseUpgrade();
    });
    sheet.append(head, tip, grid, done);
    o.appendChild(sheet);
    o.addEventListener('click', (e) => {
      if (e.target === o) this.h.onCloseUpgrade();
    });
    return o;
  }

  openUpgrade(p: Progress, highlight: UpgradeKey | null, tip: string): void {
    this.highlight = highlight;
    this.upgradeTip.textContent = tip;
    this.upgradeTip.classList.toggle('on', !!tip);
    this.refreshUpgrade(p);
    this.open(this.upgrade, highlight ? `.card-${highlight} .buy-btn` : '.buy-btn');
  }

  closeUpgrade(): void {
    this.close(this.upgrade);
    this.highlight = null;
  }

  get upgradeOpen(): boolean {
    return this.isOpen(this.upgrade);
  }

  /** Re-render every card from state (never from stale UI). */
  refreshUpgrade(p: Progress): void {
    this.upgradeCoins.textContent = formatInt(p.coins);
    for (const key of UPGRADE_KEYS) {
      const c = this.cards.get(key)!;
      const def = UPGRADES[key];
      const lvl = p.upgrades[key];
      const price = upgradePrice(p, key);
      c.level.textContent = `Lv ${lvl + 1} / ${MAX_UPGRADE_LEVEL + 1}`;
      const cur = def.values[lvl];
      if (price === null) {
        c.values.textContent = `${fmtValue(key, cur)} · maxed`;
        c.btn.disabled = true;
        c.btn.className = 'buy-btn max';
        c.tag.textContent = 'MAX';
        c.price.innerHTML = '';
        c.btn.setAttribute('aria-label', `${def.label} is at max level`);
      } else {
        const next = def.values[lvl + 1];
        c.values.textContent = `${fmtValue(key, cur)} → ${fmtValue(key, next)}`;
        const afford = p.coins >= price;
        c.btn.disabled = false;
        c.btn.className = `buy-btn ${afford ? 'afford' : 'poor'}`;
        c.tag.textContent = afford ? 'BUY' : `NEED ${formatInt(price - p.coins)}`;
        c.price.innerHTML = `${ICONS.coin}<b>${formatInt(price)}</b>`;
        c.btn.setAttribute('aria-label', `Buy ${def.label} level ${lvl + 2} for ${price} coins${afford ? '' : ' (not enough coins)'}`);
      }
      c.card.classList.toggle('highlight', this.highlight === key && price !== null);
    }
  }

  /** Drop the onboarding tip/highlight (e.g. after the first purchase). */
  clearGuidance(p: Progress): void {
    this.highlight = null;
    this.upgradeTip.classList.remove('on');
    this.refreshUpgrade(p);
  }

  flashCard(key: UpgradeKey, kind: 'ok' | 'deny'): void {
    const c = this.cards.get(key);
    if (!c) return;
    const cls = kind === 'ok' ? 'bought' : 'denied';
    c.card.classList.remove(cls);
    void c.card.offsetWidth;
    c.card.classList.add(cls);
  }

  // ------------------------------------------------------------- settings
  private buildSettings(): HTMLElement {
    const o = el('div', 'overlay settings');
    const box = el('div', 'dialog settings-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Settings');
    o.appendChild(box);
    o.addEventListener('click', (e) => {
      if (e.target === o) this.h.onCloseSettings();
    });
    return o;
  }

  openSettings(s: Settings): void {
    this.settingsState = { ...s };
    this.renderSettings();
    this.open(this.settings, '.resume-btn');
  }

  closeSettings(): void {
    this.close(this.settings);
  }

  get settingsOpen(): boolean {
    return this.isOpen(this.settings);
  }

  private renderSettings(): void {
    const s = this.settingsState!;
    const box = this.settings.querySelector('.settings-box') as HTMLElement;
    box.innerHTML = '';
    const head = el('div', 'dialog-head');
    const title = el('div', 'dialog-title', 'SETTINGS');
    const close = el('button', 'icon-btn close-btn', ICONS.close);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close settings');
    close.addEventListener('click', () => this.h.onCloseSettings());
    head.append(title, close);
    const body = el('div', 'settings-body');

    const emit = () => this.h.onSettingsChange({ ...s });
    const toggle = (label: string, value: boolean, set: (v: boolean) => void) => {
      const row = el('div', 'set-row');
      const l = el('span', 'set-label', label);
      const b = el('button', `toggle ${value ? 'on' : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(value));
      b.setAttribute('aria-label', label);
      b.innerHTML = `<i></i><span>${value ? 'ON' : 'OFF'}</span>`;
      b.addEventListener('click', () => {
        set(!value);
        this.h.onUiTap();
        emit();
        this.renderSettings();
        (this.settings.querySelector(`[aria-label="${label}"]`) as HTMLElement | null)?.focus();
      });
      row.append(l, b);
      return row;
    };
    const slider = (label: string, value: number, set: (v: number) => void, disabled: boolean) => {
      const row = el('div', 'set-row');
      const l = el('span', 'set-label', label);
      const input = el('input', 'slider');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '5';
      input.value = String(Math.round(value * 100));
      input.disabled = disabled;
      input.setAttribute('aria-label', label);
      input.addEventListener('input', () => {
        set(Number(input.value) / 100);
        emit();
      });
      input.addEventListener('change', () => this.h.onUiTap());
      row.append(l, input);
      return row;
    };
    body.append(
      toggle('Sound', !s.muted, (v) => (s.muted = !v)),
      slider('Effects volume', s.sfxVolume, (v) => (s.sfxVolume = v), s.muted),
      slider('Music volume', s.musicVolume, (v) => (s.musicVolume = v), s.muted),
      toggle('Reduced motion', s.reducedMotion, (v) => (s.reducedMotion = v)),
    );
    if (this.hapticsSupported) body.append(toggle('Vibration', s.haptics, (v) => (s.haptics = v)));

    const qrow = el('div', 'set-row');
    qrow.append(el('span', 'set-label', 'Graphics'));
    const seg = el('div', 'segmented');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Graphics quality');
    for (const q of ['auto', 'low', 'high'] as QualityLevel[]) {
      const b = el('button', q === s.quality ? 'on' : '', q.toUpperCase());
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(q === s.quality));
      b.addEventListener('click', () => {
        s.quality = q;
        this.h.onUiTap();
        emit();
        this.renderSettings();
      });
      seg.appendChild(b);
    }
    qrow.appendChild(seg);
    body.appendChild(qrow);

    const reset = el('button', 'danger-btn', 'Reset progress…');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.h.onUiTap();
      this.confirm('Reset all progress?', 'Coins, upgrades and cleared areas will be erased. Settings are kept.', 'RESET', () => this.h.onResetProgress());
    });
    const resume = el('button', 'wide-btn resume-btn', 'RESUME');
    resume.type = 'button';
    resume.addEventListener('click', () => {
      this.h.onUiTap();
      this.h.onCloseSettings();
    });
    const foot = el('div', 'settings-foot', '');
    foot.append(reset);
    box.append(head, body, foot, resume);
  }

  // ------------------------------------------------------------- completion
  openCompletion(stats: { layers: number; earned: number; upgrades: number; maxUpgrades: number; areas: number }): void {
    const o = this.completion;
    o.innerHTML = '';
    const box = el('div', 'dialog completion-box');
    box.setAttribute('role', 'dialog');
    const star = el('div', 'big-star', ICONS.star);
    const title = el('div', 'dialog-title', 'ALL AREAS CLEARED!');
    const sub = el('div', 'dialog-sub', 'The yards are spotless. Nice driving.');
    const grid = el('div', 'stat-grid');
    const stat = (label: string, value: string) => {
      const s = el('div', 'stat');
      s.append(el('b', '', value), el('span', '', label));
      return s;
    };
    grid.append(
      stat('Blocks cleared', formatInt(stats.layers)),
      stat('Coins earned', formatInt(stats.earned)),
      stat('Upgrades', `${stats.upgrades} / ${stats.maxUpgrades}`),
      stat('Areas', String(stats.areas)),
    );
    const free = el('button', 'wide-btn', 'CONTINUE FREE PLAY');
    free.type = 'button';
    free.addEventListener('click', () => {
      this.h.onUiTap();
      this.close(o);
      this.h.onFreePlay();
    });
    const again = el('button', 'ghost-btn', 'New Run');
    again.type = 'button';
    again.addEventListener('click', () => {
      this.h.onUiTap();
      this.confirm('Start a new run?', 'Coins and upgrades reset to the beginning.', 'NEW RUN', () => {
        this.close(o);
        this.h.onNewRun();
      });
    });
    box.append(star, title, sub, grid, free, again);
    o.appendChild(box);
    this.open(o, '.wide-btn');
  }

  get completionOpen(): boolean {
    return this.isOpen(this.completion);
  }

  // ------------------------------------------------------------- confirm / notice
  confirm(title: string, body: string, okLabel: string, onOk: () => void): void {
    const o = this.confirmEl;
    o.innerHTML = '';
    const box = el('div', 'dialog confirm-box');
    box.setAttribute('role', 'alertdialog');
    const t = el('div', 'dialog-title');
    t.textContent = title;
    const b = el('div', 'dialog-sub');
    b.textContent = body;
    const row = el('div', 'btn-row');
    const cancel = el('button', 'ghost-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.h.onUiTap();
      this.close(o);
    });
    const ok = el('button', 'danger-btn solid');
    ok.type = 'button';
    ok.textContent = okLabel;
    ok.addEventListener('click', () => {
      this.h.onUiTap();
      this.close(o);
      onOk();
    });
    row.append(cancel, ok);
    box.append(t, b, row);
    o.appendChild(box);
    this.open(o, '.ghost-btn');
  }

  notice(title: string, body: string, button: string, onClick: () => void): void {
    const o = this.noticeEl;
    o.innerHTML = '';
    const box = el('div', 'dialog');
    box.setAttribute('role', 'alertdialog');
    const t = el('div', 'dialog-title');
    t.textContent = title;
    const b = el('div', 'dialog-sub');
    b.textContent = body;
    const btn = el('button', 'wide-btn');
    btn.type = 'button';
    btn.textContent = button;
    btn.addEventListener('click', () => {
      this.close(o);
      onClick();
    });
    box.append(t, b, btn);
    o.appendChild(box);
    this.open(o);
  }

  closeAll(): void {
    for (const o of [this.upgrade, this.settings, this.completion, this.confirmEl, this.noticeEl]) this.close(o);
  }
}

export function showFatal(root: HTMLElement, title: string, body: string): void {
  const o = el('div', 'overlay notice open fatal');
  const box = el('div', 'dialog');
  const t = el('div', 'dialog-title');
  t.textContent = title;
  const b = el('div', 'dialog-sub');
  b.textContent = body;
  box.append(t, b);
  o.appendChild(box);
  root.appendChild(o);
}
