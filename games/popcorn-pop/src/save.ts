// ---------------------------------------------------------------------------
// localStorage persistence. Every access is guarded so the game keeps
// working when storage is blocked (private mode, disabled cookies, ...).
// ---------------------------------------------------------------------------
import { BALANCE, KIOSK_IDS, MAX_CUP_SLOTS, UPGRADE_KINDS, cupSlotsFor } from './config';
import { newCup, newGame, newKiosk, type GameState, type KioskState } from './economy';

const KEY = 'popcorn-pop:save:v1';

let storageOk = true;

export function storageAvailable(): boolean {
  return storageOk;
}

export function saveGame(g: GameState): void {
  if (!storageOk) return;
  try {
    g.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    storageOk = false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function loadGame(): GameState | null {
  let text: string | null = null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    storageOk = false;
    return null;
  }
  if (!text) return null;
  try {
    return sanitize(JSON.parse(text));
  } catch {
    return null;
  }
}

// --- validation --------------------------------------------------------------

function num(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function int(v: unknown, fallback: number, min = 0, max = 100000): number {
  return Math.floor(num(v, fallback, min, max));
}

type Loose = Record<string, unknown> | undefined;

function sanitizeKiosk(src: Loose, base: KioskState): KioskState {
  if (!src || typeof src !== 'object') return base;
  const k = base;
  k.unlocked = src.unlocked === true || base.unlocked;
  const lv = (src.levels ?? {}) as Record<string, unknown>;
  for (const kind of UPGRADE_KINDS) k.levels[kind] = int(lv[kind], 1, 1, 999);
  k.raw = int(src.raw, 0, 0, BALANCE.rawCap);
  k.popped = int(src.popped, 0, 0, BALANCE.poppedCap);
  k.feedT = num(src.feedT, 0, 0, 60);
  k.popT = num(src.popT, 0, 0, 60);
  k.shakeBoost = 0;
  k.shakeCd = 0;
  k.cupsSold = int(src.cupsSold, 0, 0, 1e12);
  k.earned = num(src.earned, 0);
  const cups = Array.isArray(src.cups) ? (src.cups as Loose[]) : [];
  const slots = cupSlotsFor(k.levels.pack);
  for (let i = 0; i < MAX_CUP_SLOTS; i++) {
    const c = cups[i];
    const cup = newCup();
    if (c && i < slots) {
      cup.fill = int(c.fill, 0, 0, BALANCE.cupSize);
      cup.selling = num(c.selling, -1, -1, BALANCE.saleDuration);
      cup.packT = num(c.packT, 0, 0, 60);
      if (cup.fill >= BALANCE.cupSize && cup.selling < 0) cup.selling = 0;
    }
    k.cups[i] = cup;
  }
  return k;
}

function sanitize(data: unknown): GameState | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1) return null;
  const g = newGame();
  g.money = num(d.money, g.money);
  g.lifetime = num(d.lifetime, 0);
  g.totalCups = int(d.totalCups, 0, 0, 1e12);
  g.muted = d.muted === true;
  g.savedAt = num(d.savedAt, Date.now());
  const kiosks = (d.kiosks ?? {}) as Record<string, Loose>;
  for (const id of KIOSK_IDS) g.kiosks[id] = sanitizeKiosk(kiosks[id], newKiosk(id, id === 'cinema'));
  g.kiosks.cinema.unlocked = true;
  g.active = d.active === 'fairground' && g.kiosks.fairground.unlocked ? 'fairground' : 'cinema';
  const m = (d.mission ?? {}) as Record<string, unknown>;
  g.mission.index = int(m.index, 0, 0, 1e6);
  g.mission.repeatBase = int(m.repeatBase, 0, 0, 1e12);
  g.mission.repeatReward = int(m.repeatReward, 0, 0, 1e15);
  return g;
}
