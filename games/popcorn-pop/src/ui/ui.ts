// ---------------------------------------------------------------------------
// HTML/CSS overlay: HUD, upgrade buttons, SHAKE, floating numbers, tags and
// modals. Reads GameState, calls back into main via UIActions.
// ---------------------------------------------------------------------------
import { BALANCE, KIOSKS, KIOSK_IDS, UPGRADE_KINDS, cupSlotsFor, type KioskId, type UpgradeKind } from '../config';
import { costOf, fairgroundAvailable, kioskRates, totalIncome, type GameState } from '../economy';
import { currentMission, type MissionView } from '../missions';
import { sfx } from '../audio';
import { storageAvailable } from '../save';
import { fmt, fmtDuration, fmtRate } from './format';

export interface UIActions {
  upgrade(kind: UpgradeKind): void;
  shake(): void;
  switchKiosk(id: KioskId): void;
  openFairground(): void;
  toggleMute(): void;
  reset(): void;
  tapStage(clientX: number, clientY: number): void;
}

export type TagTone = 'warn' | 'info' | 'boost' | 'lock';

export interface TagSpec {
  id: string;
  text: string;
  sub?: string;
  tone: TagTone;
  x: number;
  y: number;
  visible: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

interface Card {
  el: HTMLButtonElement;
  lv: HTMLElement;
  stat: HTMLElement;
  sub: HTMLElement;
  cost: HTMLElement;
}

const LOCK_SVG = '<svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z"/></svg>';
const STORE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5 5.5 4h13l2 5.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>';

const KIOSK_COLORS: Record<KioskId, string> = { cinema: '#e25b45', fairground: '#2ec4b6' };

export class UI {
  private readonly moneyEl = $('#money');
  private readonly incomeEl = $('#income');
  private readonly locName = $('#loc-name');
  private readonly kioskBadge = $('#kiosk-badge');
  private readonly muteBtn = $('#btn-mute');
  private readonly missionEl = $('#mission');
  private readonly missionTitle = $('#mission-title');
  private readonly missionCount = $('#mission-count');
  private readonly missionBar = $('#mission-bar');
  private readonly missionReward = $('#mission-reward');
  private readonly shakeBtn = $<HTMLButtonElement>('#btn-shake');
  private readonly shakeLabel = $('#shake-label');
  private readonly labels = $('#labels');
  private readonly toastEl = $('#toast');
  private readonly fadeEl = $('#fade');
  private readonly overlay = $('#overlay');
  private readonly stageEl = $('#stage');
  private readonly cards = {} as Record<UpgradeKind, Card>;

  private shownMoney = -1;
  private readonly text = new WeakMap<HTMLElement, string>();
  private readonly tagEls = new Map<string, HTMLElement>();
  private readonly floatPool: HTMLElement[] = [];
  private readonly coinPool: HTMLElement[] = [];
  private coinBudget = 0;
  private missionHold = 0;
  private missionKey = '';
  private modal: HTMLElement | null = null;
  private modalKind: 'kiosks' | 'menu' | 'away' | null = null;
  private resetStep = 0;
  private modalRefresh = 0;
  private toastT = 0;

  constructor(
    private readonly actions: UIActions,
    private readonly state: () => GameState,
  ) {
    for (const kind of UPGRADE_KINDS) {
      const el = $<HTMLButtonElement>(`.upg[data-kind="${kind}"]`);
      this.cards[kind] = { el, lv: $('.lv', el), stat: $('.stat', el), sub: $('.sub', el), cost: $('.cost', el) };
      el.addEventListener('click', () => actions.upgrade(kind));
    }
    this.shakeBtn.addEventListener('click', () => actions.shake());
    $('#scene').addEventListener('pointerdown', (e) => actions.tapStage(e.clientX, e.clientY));
    $('#btn-kiosk').addEventListener('click', () => {
      sfx.click();
      this.openModal('kiosks');
    });
    $('#btn-menu').addEventListener('click', () => {
      sfx.click();
      this.openModal('menu');
    });
    this.muteBtn.addEventListener('click', () => actions.toggleMute());
    // block pinch/double-tap zoom gestures on iOS
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private setText(el: HTMLElement, v: string): void {
    if (this.text.get(el) !== v) {
      this.text.set(el, v);
      el.textContent = v;
    }
  }

  private setHTML(el: HTMLElement, v: string): void {
    if (this.text.get(el) !== v) {
      this.text.set(el, v);
      el.innerHTML = v;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  update(g: GameState, dt: number): void {
    // money counts up smoothly toward the true value
    if (this.shownMoney < 0) this.shownMoney = g.money;
    const diff = g.money - this.shownMoney;
    if (Math.abs(diff) < 1) this.shownMoney = g.money;
    else this.shownMoney += diff * Math.min(1, dt * 12);
    this.setText(this.moneyEl, fmt(this.shownMoney));
    this.setText(this.incomeEl, `+${fmtRate(totalIncome(g))}/s`);
    this.setText(this.locName, KIOSKS[g.active].name);
    this.kioskBadge.hidden = !(fairgroundAvailable(g) && g.money >= BALANCE.fairground.openPrice);
    this.muteBtn.classList.toggle('muted', g.muted);

    // mission
    if (this.missionHold > 0) {
      this.missionHold -= dt;
      if (this.missionHold <= 0) {
        this.missionEl.classList.remove('done');
        this.missionEl.classList.remove('enter');
        void this.missionEl.offsetWidth;
        this.missionEl.classList.add('enter');
      }
    } else this.renderMission(currentMission(g), g);

    // upgrade cards
    const k = g.kiosks[g.active];
    const rates = kioskRates(k);
    for (const kind of UPGRADE_KINDS) {
      const c = this.cards[kind];
      const lv = k.levels[kind];
      const cost = costOf(g, g.active, kind);
      this.setText(c.lv, `LV ${lv}`);
      this.setText(c.cost, fmt(cost));
      c.el.classList.toggle('poor', g.money < cost);
      c.el.classList.toggle('slowest', rates.bottleneck === kind);
      // current rate -> rate after buying, so every purchase shows its effect
      const after = kioskRates({ ...k, levels: { ...k.levels, [kind]: lv + 1 } });
      if (kind === 'feed') {
        this.setText(c.stat, `${fmtRate(rates.feed)} → ${fmtRate(after.feed)}/s`);
        this.setText(c.sub, 'kernels per sec');
      } else if (kind === 'heat') {
        this.setText(c.stat, `${fmtRate(rates.pop)} → ${fmtRate(after.pop)}/s`);
        this.setText(c.sub, 'pops per sec');
      } else {
        this.setText(c.stat, `${fmtRate(rates.pack)} → ${fmtRate(after.pack)}/s`);
        const next = BALANCE.cupSlotUnlockPackLevel.find((l) => l > lv);
        const lanes = rates.lanes;
        this.setText(c.sub, next ? (next === lv + 1 ? 'NEXT: +1 cup!' : `Lv${next}: +1 cup`) : `${lanes} cups packing`);
      }
    }

    // shake button
    const S = BALANCE.shake;
    const btn = this.shakeBtn;
    if (k.shakeBoost > 0) {
      btn.style.setProperty('--p', String(k.shakeBoost / S.duration));
      btn.className = 'boost';
      this.setText(this.shakeLabel, 'POP!');
    } else if (k.shakeCd > 0) {
      btn.style.setProperty('--p', String(1 - k.shakeCd / S.cooldown));
      btn.className = 'cool';
      this.setText(this.shakeLabel, `${Math.ceil(k.shakeCd)}s`);
    } else {
      btn.style.setProperty('--p', '1');
      btn.className = 'ready';
      this.setText(this.shakeLabel, 'SHAKE');
    }

    // modal live refresh
    if (this.modal && this.modalKind === 'kiosks') {
      this.modalRefresh -= dt;
      if (this.modalRefresh <= 0) {
        this.modalRefresh = 0.4;
        this.renderKioskModal();
      }
    }

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.hidden = true;
    }
    this.coinBudget = Math.min(8, this.coinBudget + dt * 6);
  }

  private renderMission(m: MissionView, g: GameState): void {
    let title = m.title;
    let count = `${fmt(m.current)}/${fmt(m.target)}`;
    if (m.hint === 'earn') {
      title = 'Open Fairground';
      count = `${fmt(m.current)}/${fmt(m.target)} earned`;
    } else if (m.hint === 'ready') {
      title = g.money >= BALANCE.fairground.openPrice ? 'Open Fairground — tap kiosk!' : `Open Fairground (${fmt(BALANCE.fairground.openPrice)})`;
      count = '';
    }
    const key = `${title}|${count}|${m.reward}`;
    if (key === this.missionKey) return;
    this.missionKey = key;
    this.setText(this.missionTitle, title);
    this.setText(this.missionCount, count);
    this.missionBar.style.width = `${Math.min(100, (m.current / m.target) * 100)}%`;
    this.setHTML(this.missionReward, `<span class="coin"></span>${fmt(m.reward)}`);
  }

  missionDone(m: MissionView): void {
    this.missionHold = 1.7;
    this.missionKey = '';
    this.missionEl.classList.remove('enter');
    this.missionEl.classList.remove('done');
    void this.missionEl.offsetWidth;
    this.missionEl.classList.add('done');
    this.setText(this.missionTitle, `✓ ${m.title}`);
    this.setText(this.missionCount, 'Complete!');
    this.setHTML(this.missionReward, `<span class="coin"></span>+${fmt(m.reward)}`);
    this.missionBar.style.width = '100%';
    const r = this.missionReward.getBoundingClientRect();
    this.coinFly(r.left + r.width / 2, r.top + r.height / 2, 6);
    const s = this.stageEl.getBoundingClientRect();
    this.floatText(r.left + r.width / 2 - s.left, r.bottom - s.top + 22, `+${fmt(m.reward)}`, 'bonus');
  }

  // ---------------------------------------------------------------------------
  // Tags & floating feedback
  // ---------------------------------------------------------------------------

  setTags(specs: TagSpec[]): void {
    for (const s of specs) {
      let el = this.tagEls.get(s.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `tag ${s.tone}`;
        this.labels.appendChild(el);
        this.tagEls.set(s.id, el);
      }
      if (!s.visible) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      if (el.style.display === 'none') el.style.display = '';
      const html = s.tone === 'lock' ? `${LOCK_SVG}${s.text}` : s.sub ? `${s.text}<small>${s.sub}</small>` : s.text;
      this.setHTML(el, html);
      const dy = s.tone === 'lock' ? -50 : -100;
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, ${dy}%)`;
    }
  }

  /** Floating text at stage-relative CSS px. */
  floatText(x: number, y: number, text: string, cls = ''): void {
    const el = this.floatPool.pop() ?? document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    this.labels.appendChild(el);
    const jx = (Math.random() - 0.5) * 16;
    const a = el.animate(
      [
        { transform: `translate(${x + jx}px, ${y}px) translate(-50%, -50%) scale(0.4)`, opacity: 0 },
        { transform: `translate(${x + jx}px, ${y - 18}px) translate(-50%, -50%) scale(1.2)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${x + jx}px, ${y - 52}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${x + jx}px, ${y - 70}px) translate(-50%, -50%) scale(0.9)`, opacity: 0 },
      ],
      { duration: 1050, easing: 'ease-out' },
    );
    a.onfinish = () => {
      el.remove();
      if (this.floatPool.length < 12) this.floatPool.push(el);
    };
  }

  /** Coins flying from a page position into the money counter. */
  coinFly(px: number, py: number, count: number): void {
    const target = this.moneyEl.getBoundingClientRect();
    const tx = target.left + 4;
    const ty = target.top + target.height / 2;
    let bumped = false;
    for (let i = 0; i < count; i++) {
      if (this.coinBudget < 1) break;
      this.coinBudget -= 1;
      const el = this.coinPool.pop() ?? document.createElement('span');
      el.className = 'coin coin-fly';
      this.overlay.appendChild(el);
      const sx = px + (Math.random() - 0.5) * 30;
      const sy = py + (Math.random() - 0.5) * 20;
      const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 60;
      const my = Math.min(sy, ty) - 40 - Math.random() * 40;
      const a = el.animate(
        [
          { transform: `translate(${sx}px, ${sy}px) scale(0.3)`, opacity: 0 },
          { transform: `translate(${sx}px, ${sy - 14}px) scale(1.2)`, opacity: 1, offset: 0.15 },
          { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${tx}px, ${ty}px) scale(0.7)`, opacity: 0.9 },
        ],
        { duration: 620 + i * 70, easing: 'ease-in', delay: i * 40 },
      );
      a.onfinish = () => {
        el.remove();
        if (this.coinPool.length < 16) this.coinPool.push(el);
        if (!bumped) {
          bumped = true;
          this.bumpMoney();
        }
      };
    }
    if (count === 0 || this.coinBudget < 1) this.bumpMoney();
  }

  private bumpMoney(): void {
    this.moneyEl.classList.remove('bump');
    void this.moneyEl.offsetWidth;
    this.moneyEl.classList.add('bump');
  }

  /** Sale feedback: "+30" above the cup and coins to the counter. */
  saleFx(stageX: number, stageY: number, price: number): void {
    this.floatText(stageX, stageY, `+${fmt(price)}`);
    const r = this.stageEl.getBoundingClientRect();
    this.coinFly(r.left + stageX, r.top + stageY, 3);
  }

  upgradeFx(kind: UpgradeKind): void {
    const el = this.cards[kind].el;
    el.classList.remove('punch', 'deny');
    void el.offsetWidth;
    el.classList.add('punch');
  }

  denyFx(kind: UpgradeKind | 'shake'): void {
    const el = kind === 'shake' ? this.shakeBtn : this.cards[kind].el;
    el.animate(
      [{ translate: '0 0' }, { translate: '-5px 0' }, { translate: '5px 0' }, { translate: '-3px 0' }, { translate: '0 0' }],
      { duration: 300, easing: 'ease-in-out' },
    );
  }

  toast(text: string, seconds = 2.4): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.style.animation = 'none';
    void this.toastEl.offsetWidth;
    this.toastEl.style.animation = '';
    this.toastT = seconds;
  }

  /** Quick fade of the stage while the scene swaps. */
  fade(swap: () => void): void {
    this.fadeEl.classList.add('on');
    setTimeout(() => {
      swap();
      setTimeout(() => this.fadeEl.classList.remove('on'), 30);
    }, 190);
  }

  setKiosk(id: KioskId, bg: number): void {
    document.body.dataset.kiosk = id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', `#${bg.toString(16).padStart(6, '0')}`);
    this.missionKey = '';
  }

  // ---------------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------------

  /** True while a mission-complete celebration is on screen. */
  get missionBusy(): boolean {
    return this.missionHold > 0;
  }

  get modalOpen(): boolean {
    return this.modal !== null;
  }

  closeModal(): void {
    this.modal?.remove();
    this.modal = null;
    this.modalKind = null;
    this.resetStep = 0;
  }

  private openModal(kind: 'kiosks' | 'menu' | 'away', html = ''): HTMLElement {
    this.closeModal();
    const back = document.createElement('div');
    back.className = 'backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) this.closeModal();
    });
    back.addEventListener('click', (e) => this.onModalClick(e));
    this.overlay.appendChild(back);
    this.modal = back;
    this.modalKind = kind;
    if (kind === 'kiosks') this.renderKioskModal();
    if (kind === 'menu') this.renderMenuModal();
    return back;
  }

  private onModalClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t || (t as HTMLButtonElement).disabled) return;
    const act = t.dataset.act;
    if (act !== 'reset-confirm') sfx.click();
    switch (act) {
      case 'close':
        this.closeModal();
        break;
      case 'go':
        this.closeModal();
        this.actions.switchKiosk(t.dataset.id as KioskId);
        break;
      case 'open-fair':
        this.closeModal();
        this.actions.openFairground();
        break;
      case 'mute':
        this.actions.toggleMute();
        this.renderMenuModal();
        break;
      case 'reset':
        this.resetStep = 1;
        this.renderMenuModal();
        break;
      case 'reset-cancel':
        this.resetStep = 0;
        this.renderMenuModal();
        break;
      case 'reset-confirm':
        this.actions.reset();
        break;
    }
  }

  private renderKioskModal(): void {
    if (!this.modal) return;
    const g = this.state();
    const F = BALANCE.fairground;
    const cards = KIOSK_IDS.map((id) => {
      const k = g.kiosks[id];
      const def = KIOSKS[id];
      const thumb = `<div class="thumb" style="background:${KIOSK_COLORS[id]}">${STORE_SVG}</div>`;
      if (k.unlocked) {
        const r = kioskRates(k);
        const here = g.active === id;
        const lanes = cupSlotsFor(k.levels.pack);
        return `<div class="kiosk-card">${thumb}<div class="info"><div class="name">${def.name}</div>
          <div class="meta"><b>+${fmtRate(r.income)}/s</b> · ${fmt(k.cupsSold)} sold · ${lanes} cup${lanes > 1 ? 's' : ''}</div></div>
          <button class="btn ${here ? 'secondary' : ''}" data-act="go" data-id="${id}" ${here ? 'disabled' : ''}>${here ? 'HERE' : 'GO'}</button></div>`;
      }
      if (g.lifetime < F.unlockLifetime) {
        const pct = Math.min(100, (g.lifetime / F.unlockLifetime) * 100);
        return `<div class="kiosk-card locked">${thumb}<div class="info"><div class="name">${def.name}</div>
          <div class="meta">Earn ${fmt(F.unlockLifetime)} total to unlock · ${fmt(g.lifetime)}/${fmt(F.unlockLifetime)}</div>
          <div class="bar"><i style="width:${pct}%"></i></div></div>
          <button class="btn" disabled>${LOCK_SVG.replace('<svg', '<svg width="18" height="18" fill="currentColor"')}</button></div>`;
      }
      const afford = g.money >= F.openPrice;
      return `<div class="kiosk-card">${thumb}<div class="info"><div class="name">${def.name}</div>
        <div class="meta">Ready to open! Better cups: <b>${KIOSKS.fairground.cupPrice}</b> each</div></div>
        <button class="btn" data-act="open-fair" ${afford ? '' : 'disabled'}><span class="coin"></span>${fmt(F.openPrice)}</button></div>`;
    }).join('');
    const html = `<h2>KIOSKS</h2>${cards}
      <div class="total-line">All kiosks: +${fmtRate(totalIncome(g))}/s · they keep popping in the background</div>
      <button class="btn secondary" data-act="close">CLOSE</button>`;
    const modal = $('.modal', this.modal);
    this.setHTML(modal, html);
  }

  private renderMenuModal(): void {
    if (!this.modal) return;
    const g = this.state();
    let html: string;
    if (this.resetStep === 0) {
      html = `<h2>MENU</h2>
        <div class="setting-row"><span>Sound</span><button class="btn ${g.muted ? 'secondary' : ''}" style="width:auto;min-width:96px" data-act="mute">${g.muted ? 'OFF' : 'ON'}</button></div>
        <div class="setting-row"><span>Cups sold</span><span>${fmt(g.totalCups)}</span></div>
        <div class="setting-row"><span>Lifetime earnings</span><span>${fmt(g.lifetime)}</span></div>
        <button class="btn danger" data-act="reset" style="margin-top:8px">RESET PROGRESS…</button>
        <button class="btn secondary" data-act="close">CLOSE</button>
        <div class="small-note">${storageAvailable() ? 'Progress saves automatically on this device.' : 'Saving is unavailable in this browser — progress lasts until you close the tab.'}<br/>Tip: tap the pot to shake it!</div>`;
    } else {
      html = `<h2>RESET EVERYTHING?</h2>
        <p>This deletes all money, upgrades, kiosks and missions. It cannot be undone.</p>
        <div class="row-btns"><button class="btn secondary" data-act="reset-cancel">CANCEL</button>
        <button class="btn danger" data-act="reset-confirm">YES, RESET</button></div>`;
    }
    this.setHTML($('.modal', this.modal), html);
  }

  showAway(amount: number, seconds: number): void {
    const capped = seconds > BALANCE.offlineCapSec;
    const html = `<h2>WELCOME BACK!</h2>
      <p>Your kiosks earned</p>
      <div class="big-num"><span class="coin big"></span>${fmt(amount)}</div>
      <p style="font-size:13px;color:var(--ink-soft)">while you were away for ${fmtDuration(seconds)}${capped ? ` (max ${fmtDuration(BALANCE.offlineCapSec)})` : ''}.</p>
      <button class="btn" data-act="close">COLLECT</button>`;
    const back = this.openModal('away', html);
    back.querySelector('[data-act="close"]')?.addEventListener('click', () => {
      this.coinBudget = 8;
      this.coinFly(window.innerWidth / 2, window.innerHeight / 2, 8);
      sfx.sale();
    });
  }
}
