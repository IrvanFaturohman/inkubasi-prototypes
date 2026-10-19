import { GameConfig as C } from '../config/GameConfig';

// Live tuning panel, toggled with D. Edits GameConfig in place.

interface PanelApi {
  restart(round: number): void;
  round(): number;
  stats(): string;
}

const GROUPS = ['magnet', 'cluster', 'belt', 'ball', 'hopper', 'machine', 'reject', 'overdrive', 'score', 'phases', 'juice'] as const;

export class TuningPanel {
  private el: HTMLDivElement;
  private stats: HTMLDivElement;
  private roundBox: HTMLDivElement;
  private timer = 0;

  constructor(private api: PanelApi) {
    this.el = document.createElement('div');
    this.el.id = 'tuning';
    this.el.style.display = 'none';
    const head = document.createElement('div');
    head.className = 'tp-head';
    head.innerHTML = '<b>TUNING</b> <span>press D to close</span>';
    this.el.appendChild(head);
    this.stats = document.createElement('div');
    this.stats.className = 'tp-stats';
    this.el.appendChild(this.stats);

    const btns = document.createElement('div');
    btns.className = 'tp-btns';
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = fn;
      btns.appendChild(b);
    };
    mk('Restart round', () => this.api.restart(this.api.round()));
    mk('< Round', () => this.api.restart(Math.max(0, this.api.round() - 1)));
    mk('Round >', () => this.api.restart(Math.min(C.rounds.length - 1, this.api.round() + 1)));
    mk('Copy JSON', () => { void navigator.clipboard?.writeText(JSON.stringify(C, null, 2)); });
    this.el.appendChild(btns);

    this.roundBox = document.createElement('div');
    this.el.appendChild(this.roundBox);

    const cfg = C as unknown as Record<string, Record<string, unknown>>;
    for (const g of GROUPS) this.el.appendChild(this.section(g, cfg[g]));
    document.body.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'd' || e.key === 'D') this.toggle();
    });
  }

  private toggle() {
    const show = this.el.style.display === 'none';
    this.el.style.display = show ? 'block' : 'none';
    window.clearInterval(this.timer);
    if (show) {
      this.buildRound();
      this.timer = window.setInterval(() => { this.stats.textContent = this.api.stats(); }, 250);
    }
  }

  private buildRound() {
    const i = this.api.round();
    this.roundBox.innerHTML = '';
    this.roundBox.appendChild(this.section(`rounds[${i}]`, C.rounds[i] as unknown as Record<string, unknown>));
  }

  private section(name: string, obj: Record<string, unknown>) {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = name;
    fs.appendChild(lg);
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const row = document.createElement('label');
      row.className = 'tp-row';
      const nm = document.createElement('span');
      nm.textContent = key;
      row.appendChild(nm);
      if (typeof val === 'number') {
        const a = Math.abs(val);
        const span = Math.max(a * 3, 1);
        const step = a >= 50 ? 1 : a >= 5 ? 0.1 : a >= 0.5 ? 0.01 : 0.0005;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = String(val < 0 ? -span : 0);
        range.max = String(span);
        range.step = String(step);
        range.value = String(val);
        const num = document.createElement('input');
        num.type = 'number';
        num.step = String(step);
        num.value = String(val);
        const set = (v: number) => { if (!Number.isNaN(v)) obj[key] = v; };
        range.oninput = () => { num.value = range.value; set(parseFloat(range.value)); };
        num.onchange = () => { range.value = num.value; set(parseFloat(num.value)); };
        row.appendChild(range);
        row.appendChild(num);
      } else if (typeof val === 'boolean') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = val;
        cb.onchange = () => { obj[key] = cb.checked; };
        row.appendChild(cb);
      } else if (typeof val === 'string') {
        const v = document.createElement('em');
        v.textContent = val;
        row.appendChild(v);
      } else continue;
      fs.appendChild(row);
    }
    return fs;
  }
}
