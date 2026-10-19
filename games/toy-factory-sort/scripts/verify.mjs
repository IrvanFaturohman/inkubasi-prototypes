// Headless check: builds are served with `vite preview`, a real Chrome runs the
// game, and a simple bot drives it through window.__tfs (step/tap/state).
// Proves every level can be cleared, recirculated parts become 'riding' again
// (markLanded regression), intake only happens at belt height, and that
// overloading the belt fails the shift.
//
//   npm run build && npm run verify            (uses system Chrome)
//   CHROME_PATH=/path/to/chrome npm run verify
//   npm run verify -- --shots ./shots          (also saves screenshots)

import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsArg = process.argv.indexOf('--shots');
const shotsDir = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;

const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}
if (!existsSync(path.join(root, 'dist/index.html'))) {
  console.error('dist/ missing, run `npm run build` first.');
  process.exit(2);
}

// --- code that runs inside the page ------------------------------------------
const BOT = `
window.__bot = (() => {
  const T = window.__tfs;
  const onBelt = (p) => p.state === 'falling' || p.state === 'riding' || p.state === 'lift';

  function decide(s) {
    const want = new Array(8).fill(0);
    for (const m of s.machines) {
      if (m.state === 'open') want[m.color] += 3 - m.filled - m.incoming;
      else if (m.state === 'locked' && m.next >= 0) want[m.next] += 3;
      else if (m.state === 'switch' && m.color >= 0) want[m.color] += 3;
    }
    for (const p of s.parts) if (onBelt(p)) want[p.color]--;
    if (s.belt >= s.cap - 1) return -1; // a sensible player keeps one slot free
    let best = -1, bestScore = -1e9;
    s.trays.forEach((t, i) => {
      if (t.cooldown > 0 || !t.parts.length) return;
      const c = t.parts[0];
      if (want[c] <= 0) return;
      const open = s.machines.some((m) => m.state === 'open' && m.color === c);
      const score = want[c] + (open ? 10 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) return best;
    if (s.belt >= s.cap - 2) return -1; // keep a free slot before dumping
    let bi = -1, bd = 1e9;
    s.trays.forEach((t, i) => {
      if (t.cooldown > 0 || !t.parts.length) return;
      const d = t.parts.findIndex((c) => want[c] > 0);
      if (d > 0 && d < bd) { bd = d; bi = i; }
    });
    return bi;
  }

  function run(level, fresh = true) {
    if (fresh) T.level(level);
    T.step(1);
    let s = T.state();
    let taps = 0;
    const recirc = new Set();
    const t0 = s.ticks;
    while (s.status === 'playing' && s.ticks - t0 < 60 * 600) {
      const i = decide(s);
      let tapped = false;
      if (i >= 0) { tapped = T.tap(i); if (tapped) taps++; }
      T.step(tapped ? 2 : 5);
      s = T.state();
      for (const p of s.parts) if (p.laps > 0) recirc.add(p.id);
    }
    T.step(90); // let the last toy settle
    s = T.state();
    const bad = s.intakes.filter((k) => Math.abs(k.y - s.mainRide) > 0.5 || k.landings < 1);
    return {
      level: level + 1,
      status: s.status,
      reason: s.reason,
      seconds: +(s.time).toFixed(1),
      taps,
      shipped: s.shipped + '/' + s.total,
      peakBelt: s.peakBelt + '/' + s.cap,
      recirculated: recirc.size,
      recircTaken: s.intakes.filter((k) => k.laps > 0).length,
      intakes: s.intakes.length,
      badIntakes: bad.length,
      leftover: s.parts.length,
      toysInAir: s.toys.filter((t) => t.state !== 'shelf').length,
    };
  }

  // Drop a part that no machine downstream of its bin wants, so it must ride
  // the RETURN LINE and lift. It has to land, ride again, and get taken.
  function recirc(level) {
    T.level(level);
    T.step(1);
    let s = T.state();
    const ti = s.trays.findIndex((t) => t.parts.length &&
      !s.machines.some((m) => m.color === t.parts[0] && m.x >= t.x - 16));
    if (ti < 0) return { ok: false, why: 'no part that must recirculate' };
    T.tap(ti);
    T.step(1);
    s = T.state();
    const id = Math.max(...s.parts.map((p) => p.id));
    const states = new Set();
    let ridingAgain = false;
    let last = null;
    for (let k = 0; k < 60 * 30; k++) {
      T.step(1);
      s = T.state();
      const p = s.parts.find((q) => q.id === id);
      if (!p) break;
      last = p;
      states.add(p.state + '/' + p.seg);
      if (p.laps >= 1 && p.state === 'riding' && p.seg === 'main' && p.landings >= 3) ridingAgain = true;
    }
    const taken = s.intakes.find((k) => k.id === id);
    const finish = run(level, false);
    return {
      ok: ridingAgain && !!taken && taken.laps >= 1 && finish.status === 'won',
      bin: ti + 1,
      ridingAgainAfterLap: ridingAgain,
      landingsBeforeTaken: last ? last.landings : null,
      takenAfterLaps: taken ? taken.laps : null,
      states: [...states],
      levelResult: finish.status,
    };
  }

  // Spam taps with no regard for the belt: must fail by overflow or jam.
  function spam(level) {
    T.level(level);
    let s = T.state();
    for (let k = 0; k < 4000 && s.status === 'playing'; k++) {
      T.tap(k % 4);
      T.step(3);
      s = T.state();
    }
    return { status: s.status, reason: s.reason, belt: s.belt, cap: s.cap };
  }

  return { run, recirc, spam };
})();
`;

const server = await preview({ root, preview: { port: 4179, strictPort: false, open: false }, logLevel: 'error' });
const url = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=540,960'],
});
const errors = [];
let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 540, height: 960 });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__tfs, { timeout: 15000 });
  await page.addScriptTag({ content: BOT });

  console.log('Level clears (bot via __tfs.step/tap/state):');
  for (let i = 0; i < 5; i++) {
    const r = await page.evaluate((l) => window.__bot.run(l), i);
    const ok = r.status === 'won' && r.badIntakes === 0 && r.leftover === 0 && r.toysInAir === 0;
    if (!ok) failed = true;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}`, JSON.stringify(r));
    if (shotsDir) {
      mkdirSync(shotsDir, { recursive: true });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1300)));
      await page.screenshot({ path: path.join(shotsDir, `win-${i + 1}.png`) });
    }
  }

  console.log('Recirculation regression (markLanded must re-arm riding):');
  for (const l of [2, 4]) {
    const r = await page.evaluate((lv) => window.__bot.recirc(lv), l);
    if (!r.ok) failed = true;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} level ${l + 1}`, JSON.stringify(r));
  }

  console.log('Overflow fail state (spam taps):');
  for (const l of [0, 4]) {
    const r = await page.evaluate((lv) => window.__bot.spam(lv), l);
    const ok = r.status === 'failed';
    if (!ok) failed = true;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} level ${l + 1}`, JSON.stringify(r));
  }

  if (shotsDir) {
    await page.evaluate(() => {
      const T = window.__tfs;
      T.level(3);
      const seq = [1, 2, 0, 3, 1, 2];
      for (const i of seq) { T.tap(i); T.step(20); }
      T.step(40);
    });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    await page.screenshot({ path: path.join(shotsDir, 'mid-level.png') });
    await page.evaluate(() => window.__tfs.level(0));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1800)));
    await page.screenshot({ path: path.join(shotsDir, 'start.png') });
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (errors.length) {
  failed = true;
  console.log('Page errors:\n  ' + errors.join('\n  '));
}
console.log(failed ? '\nVERIFY FAILED' : '\nVERIFY OK');
process.exit(failed ? 1 : 0);
