import * as THREE from 'three';

/**
 * Label DOM yang menempel ke posisi dunia 3D (teks tajam, mudah di-style, tombol bisa diklik).
 * Posisi ditulis lewat transform (tanpa reflow). Isi teks hanya diperbarui bila berubah.
 */
export interface WorldLabel {
  el: HTMLElement;
  pos: THREE.Vector3;
  visible: boolean;
  /** Offset piksel vertikal (negatif = ke atas). */
  dy: number;
  /**
   * Bila diisi: label dipusatkan di `pos` lalu digeser `awayPx` piksel menjauhi titik ini
   * (di layar). Dipakai label muatan agar selalu di depan lokomotif, tidak menimpa gerbong.
   */
  away: THREE.Vector3 | null;
  awayPx: number;
  set(html: string): void;
  setClass(cls: string, on: boolean): void;
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();

export class LabelLayer {
  private readonly labels = new Set<WorldLabel>();

  constructor(readonly root: HTMLElement) {}

  create(className: string, html = '', interactive = false): WorldLabel {
    const el = document.createElement(interactive ? 'button' : 'div');
    el.className = `wlabel ${className}`;
    if (interactive) (el as HTMLButtonElement).type = 'button';
    el.innerHTML = html;
    this.root.appendChild(el);
    let last = html;
    const classes = new Map<string, boolean>();
    const label: WorldLabel = {
      el,
      pos: new THREE.Vector3(),
      visible: true,
      dy: 0,
      away: null,
      awayPx: 0,
      set(h: string) {
        if (h !== last) {
          el.innerHTML = h;
          last = h;
        }
      },
      setClass(cls: string, on: boolean) {
        if (classes.get(cls) !== on) {
          el.classList.toggle(cls, on);
          classes.set(cls, on);
        }
      },
    };
    this.labels.add(label);
    return label;
  }

  remove(label: WorldLabel): void {
    label.el.remove();
    this.labels.delete(label);
  }

  clear(): void {
    for (const l of this.labels) l.el.remove();
    this.labels.clear();
  }

  update(camera: THREE.Camera, width: number, height: number): void {
    for (const l of this.labels) {
      if (!l.visible) {
        if (l.el.style.display !== 'none') l.el.style.display = 'none';
        continue;
      }
      _v.copy(l.pos).project(camera);
      if (_v.z > 1 || _v.z < -1) {
        l.el.style.display = 'none';
        continue;
      }
      if (l.el.style.display === 'none') l.el.style.display = '';
      let x = (_v.x * 0.5 + 0.5) * width;
      let y = (-_v.y * 0.5 + 0.5) * height + l.dy;
      if (l.away) {
        _a.copy(l.away).project(camera);
        const dx = (_v.x - _a.x) * width;
        const dy = (_a.y - _v.y) * height;
        const len = Math.hypot(dx, dy) || 1;
        x += (dx / len) * l.awayPx;
        y += (dy / len) * l.awayPx;
        l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        continue;
      }
      l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
