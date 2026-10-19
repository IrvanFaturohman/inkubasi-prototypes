import type { FinalProject, ProjectDefinition } from './types';

/**
 * Pemetaan progres material → modul bangunan.
 *
 * Setiap modul punya biaya integer (>= 1). Modul i dianggap SELESAI ketika
 * delivered >= thresholds[i] (jumlah kumulatif biaya modul 0..i). Karena modul sudah
 * berurutan fondasi → dinding → bukaan → atap → detail, bangunan tumbuh berurutan.
 * Biaya dihitung dari bobot modul lalu diskalakan agar totalnya TEPAT sama dengan target
 * (target minimum = jumlah modul, supaya tiap modul butuh setidaknya satu material).
 */
export function finalizeProject(def: ProjectDefinition, targetScale = 1): FinalProject {
  const modules = [...def.modules].sort((a, b) => a.stage - b.stage); // stabil: urutan dalam tahap dipertahankan
  const target = Math.max(modules.length, Math.round(def.target * targetScale));
  const totalWeight = modules.reduce((s, m) => s + m.weight, 0);

  // Distribusi largest-remainder dengan minimum 1 per modul.
  const spare = target - modules.length;
  const raw = modules.map((m) => (m.weight / totalWeight) * spare);
  const costs = raw.map((r) => 1 + Math.floor(r));
  let remaining = target - costs.reduce((s, c) => s + c, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remaining > 0; k = (k + 1) % order.length) {
    costs[order[k].i]++;
    remaining--;
  }

  const thresholds: number[] = [];
  let acc = 0;
  for (const c of costs) {
    acc += c;
    thresholds.push(acc);
  }
  return { ...def, target, modules, costs, thresholds };
}

/** Jumlah modul yang sudah selesai untuk sejumlah material terpasang. */
export function completedModuleCount(p: FinalProject, delivered: number): number {
  const t = p.thresholds;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= delivered) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
