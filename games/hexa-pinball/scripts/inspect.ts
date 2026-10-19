// npm run inspect: ball traffic heat map on an intact table (targets never break).
// Fires 160 launches one at a time from the plunger and records where balls go.
import { Rng } from '../src/core/rng';
import { Table, TW, TH, LANE_X, LANE_TOP } from '../src/core/table';
import { LEVELS } from '../src/core/levels';

const LAUNCHES = 160;
const CELL = 22;
const GX = Math.ceil(TW / CELL);
const GY = Math.ceil(TH / CELL);

const level = LEVELS[0];
const table = new Table(level.bands, new Rng(level.seed ^ 0x51a7), {
  invulnerable: true,
  launchMin: process.env.LMIN ? Number(process.env.LMIN) : undefined,
  launchMax: process.env.LMAX ? Number(process.env.LMAX) : undefined,
});
const heat = new Float64Array(GX * GY);
let leftVisits = 0;
let totalTicks = 0;
let hitSum = 0;
let laneReentries = 0;

for (let n = 0; n < LAUNCHES; n++) {
  const ball = table.launch(0);
  let wentLeft = false;
  let reentered = false;
  while (table.balls.length) {
    table.step();
    totalTicks++;
    const b = table.balls[0];
    if (!b) break;
    const gx = Math.min(GX - 1, Math.max(0, Math.floor(b.x / CELL)));
    const gy = Math.min(GY - 1, Math.max(0, Math.floor(b.y / CELL)));
    heat[gy * GX + gx]++;
    if (b.x < LANE_X / 2 && b.y > 100) wentLeft = true;
    if (b.leftLane && b.x > LANE_X + 2 && b.y > LANE_TOP + 10) reentered = true;
  }
  hitSum += ball.hits;
  if (wentLeft) leftVisits++;
  if (reentered) laneReentries++;
  table.events.length = 0;
}

// ASCII heat map (log scale)
const ramp = ' .:-=+*#%@';
let max = 0;
for (const v of heat) max = Math.max(max, v);
const lines: string[] = [];
for (let y = 0; y < GY; y++) {
  let row = '';
  for (let x = 0; x < GX; x++) {
    const v = heat[y * GX + x];
    const k = v <= 0 ? 0 : Math.min(ramp.length - 1, 1 + Math.floor((Math.log(v) / Math.log(max)) * (ramp.length - 2)));
    row += ramp[k];
  }
  lines.push('|' + row + '|');
}
console.log(`\nBall traffic heat map, ${LAUNCHES} launches, intact table (log scale, lane on the right)\n`);
console.log(lines.join('\n'));

const pct = (a: number) => ((100 * a) / LAUNCHES).toFixed(0).padStart(3) + '%';
console.log('\nPer band, share of balls that touched each target:');
level.bands.forEach((_, bi) => {
  const ts = table.targets.filter((t) => t.band === bi);
  console.log(`  band ${bi + 1}: ` + ts.map((t) => pct(table.touch[t.id])).join(' '));
});
console.log('\nPer band, share of balls whose FIRST hit was each target:');
level.bands.forEach((_, bi) => {
  const ts = table.targets.filter((t) => t.band === bi);
  console.log(`  band ${bi + 1}: ` + ts.map((t) => pct(table.firstHit[t.id])).join(' '));
});

const maxFirst = Math.max(...table.firstHit) / LAUNCHES;
const minTouch = Math.min(...table.touch) / LAUNCHES;
const maxTouch = Math.max(...table.touch) / LAUNCHES;
const leftTargets = table.targets.filter((t) => t.x < LANE_X / 2);
const minLeft = Math.min(...leftTargets.map((t) => table.touch[t.id])) / LAUNCHES;

console.log(`\nAvg hits per ball: ${(hitSum / LAUNCHES).toFixed(1)}   avg ball life: ${(totalTicks / LAUNCHES / 60).toFixed(1)} s`);
console.log(`Balls reaching the left half: ${pct(leftVisits)}`);
console.log(`Lane re-entries / kickbacks: ${laneReentries} / ${table.kickbacks}`);

const checks: [string, boolean][] = [
  [`no target takes most first hits (max ${(maxFirst * 100).toFixed(0)}% <= 35%)`, maxFirst <= 0.35],
  [`no target swallows most balls (max touch ${(maxTouch * 100).toFixed(0)}% <= 60%)`, maxTouch <= 0.6],
  [`every target gets traffic (min touch ${(minTouch * 100).toFixed(0)}% >= 7%)`, minTouch >= 0.07],
  [`left half of the table is alive (min left target ${(minLeft * 100).toFixed(0)}% >= 7%)`, minLeft >= 0.07],
  [`balls reach the left half (${pct(leftVisits).trim()} >= 50%)`, leftVisits / LAUNCHES >= 0.5],
  [`nothing kicks balls back into the plunger lane (${laneReentries + table.kickbacks} <= 2)`, laneReentries + table.kickbacks <= 2],
];
let fail = 0;
console.log('');
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
