// npm run inspect: where do runs end, per 50 m chunk, per upgrade band.
// A chunk that swallows a big share of runs is a trap (the original found a barrel stack
// at the foot of a ramp eating almost half the runs this way).
import { initPhysics, Sim } from '../src/sim';
import { buildCourse } from '../src/course';
import { COURSE_SEED, Levels } from '../src/config';

const CHUNK = 50;
const BANDS: { name: string; lv: Levels }[] = [
  { name: 'Lv1', lv: { power: 1, bounce: 1, length: 1 } },
  { name: 'Lv3', lv: { power: 3, bounce: 3, length: 3 } },
  { name: 'Lv5', lv: { power: 5, bounce: 5, length: 5 } },
  { name: 'Lv8', lv: { power: 8, bounce: 8, length: 7 } },
  { name: 'Max', lv: { power: 10, bounce: 10, length: 8 } },
];
const METERS = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05);

async function main() {
  await initPhysics();
  const course = buildCourse(COURSE_SEED);
  const hist = new Map<number, number[]>();
  const t0 = performance.now();
  let maxStep = 0;
  for (let b = 0; b < BANDS.length; b++) {
    const ds: number[] = [];
    let secs = 0;
    const reasons: Record<string, number> = {};
    for (const m of METERS) {
      const sim = new Sim(course, BANDS[b].lv);
      sim.launch(m, m >= 0.93);
      const r = sim.runToEnd()!;
      maxStep = Math.max(maxStep, sim.maxStepMs);
      ds.push(r.distance);
      secs += r.steps / 60;
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      const c = Math.floor(r.distance / CHUNK) * CHUNK;
      if (!hist.has(c)) hist.set(c, BANDS.map(() => 0));
      hist.get(c)![b]++;
      sim.dispose();
    }
    const mean = ds.reduce((a, x) => a + x, 0) / ds.length;
    console.log(
      `${BANDS[b].name.padEnd(4)} [${ds.join(' ')}]\n     mean ${mean.toFixed(0).padStart(4)} m  min ${Math.min(...ds)}  max ${Math.max(...ds)}  flight ${(secs / ds.length).toFixed(1)} s  ends ${JSON.stringify(reasons)}`,
    );
  }
  console.log('\nchunk      ' + BANDS.map((b) => b.name.padStart(4)).join(' ') + '   features in chunk');
  for (const c of [...hist.keys()].sort((a, b) => a - b)) {
    const row = hist.get(c)!;
    const feats = course.features
      .filter((f) => f.x >= c && f.x < c + CHUNK)
      .map((f) => `${f.type[0]}${f.cells.length || ''}@${f.x.toFixed(0)}`)
      .join(' ');
    const trap = row.some((n) => n / METERS.length >= 0.4) ? '  <- trap?' : '';
    console.log(`${String(c).padStart(4)}-${String(c + CHUNK).padEnd(5)} ` + row.map((n) => String(n || '.').padStart(4)).join(' ') + `   ${feats}${trap}`);
  }
  console.log(`\n${BANDS.length * METERS.length} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s, worst single step ${maxStep.toFixed(2)} ms`);
}

main();
