import type { FinalProject, ProjectDefinition } from './types';

/**
 * Pemetaan progres material → modul bangunan.
 *
 * Setiap modul punya biaya integer (>= 1). Modul i dianggap SELESAI ketika
 * delivered >= thresholds[i] (jumlah kumulatif biaya modul 0..i). Karena urutan modul
 * sudah berurutan fondasi → dinding → bukaan → atap → detail, rumah tumbuh berurutan.
 * Biaya dihitung dari bobot modul lalu diskalakan agar totalnya TEPAT sama dengan target.
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

  const stageCount = def.stageNames.length;
  const stageEnd: number[] = new Array(stageCount).fill(0);
  const stageFirstModule: number[] = new Array(stageCount).fill(-1);
  modules.forEach((m, i) => {
    stageEnd[m.stage] = thresholds[i];
    if (stageFirstModule[m.stage] < 0) stageFirstModule[m.stage] = i;
  });
  // Tahap kosong (seharusnya tidak ada) mewarisi batas tahap sebelumnya.
  for (let s = 0; s < stageCount; s++) {
    if (stageFirstModule[s] < 0) {
      stageEnd[s] = s > 0 ? stageEnd[s - 1] : 0;
      stageFirstModule[s] = s > 0 ? stageFirstModule[s - 1] : 0;
    }
  }

  return { ...def, target, modules, costs, thresholds, stageEnd, stageFirstModule };
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

/** Jumlah tahap yang sudah tuntas. */
export function completedStageCount(p: FinalProject, delivered: number): number {
  let n = 0;
  for (const end of p.stageEnd) {
    if (delivered >= end) n++;
    else break;
  }
  return n;
}

/** Tahap yang sedang dikerjakan (indeks), atau jumlah tahap bila selesai. */
export function currentStage(p: FinalProject, delivered: number): number {
  return completedStageCount(p, delivered);
}

/** Progres 0..1 dari modul yang sedang dikerjakan (untuk sorotan ghost berikutnya). */
export function nextModuleProgress(p: FinalProject, delivered: number): { index: number; frac: number } {
  const idx = completedModuleCount(p, delivered);
  if (idx >= p.thresholds.length) return { index: -1, frac: 1 };
  const start = idx > 0 ? p.thresholds[idx - 1] : 0;
  return { index: idx, frac: (delivered - start) / p.costs[idx] };
}
