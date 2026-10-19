// Scripted check for the built game (run `npm run build` first).
// Serves dist/, opens it in headless Chrome over the DevTools protocol (no Playwright),
// and drives the game ONLY through window.__mf.step(n), so rAF throttling cannot matter.
//
//   node scripts/check.mjs [--shots <dir>] [--chrome <path>]
//
// Proves: (1) a bot that grabs + sorts can clear a round, (2) an idle player loses to
// belt overflow (not a timer), (3) balls actually move under manual stepping
// (the Phaser 3.90 matter.world.resume() trap), plus a per-round balance table.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const shots = argVal('--shots');
const chromePath = argVal('--chrome') || process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));

if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/ missing, run npm run build first'); process.exit(2); }
if (!chromePath) { console.error('Chrome not found, pass --chrome <path>'); process.exit(2); }

// ---------------------------------------------------------------- static server
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(dist, url === '/' ? 'index.html' : url);
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---------------------------------------------------------------- chrome + CDP
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=432,768', 'about:blank',
], { stdio: 'ignore' });

const cleanup = async () => {
  try { chrome.kill(); } catch {}
  server.close();
  await new Promise((r) => { if (chrome.exitCode !== null) r(); else { chrome.once('exit', r); setTimeout(r, 3000); } });
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let devPort;
for (let i = 0; i < 100 && !devPort; i++) {
  await sleep(100);
  const f = path.join(profile, 'DevToolsActivePort');
  if (fs.existsSync(f)) devPort = fs.readFileSync(f, 'utf8').split('\n')[0];
}
if (!devPort) { await cleanup(); console.error('Chrome did not start'); process.exit(2); }
const targets = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name, wait = 1200) => {
  if (!shots) return;
  await sleep(wait); // default: let real-time particles / popups from fast-forwarded steps die down
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(data, 'base64'));
};

const errors = [];
await send('Runtime.enable');
await send('Page.enable');
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || 'exception');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value).join(' '));
});
await send('Emulation.setDeviceMetricsOverride', { width: 432, height: 768, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
let booted = false;
for (let i = 0; i < 100 && !booted; i++) { await sleep(100); booted = await evaluate('!!window.__mf').catch(() => false); }
if (!booted) { await cleanup(); console.error('game did not boot', errors); process.exit(1); }

// ---------------------------------------------------------------- in-page bot
const BOT = String(function runBot(opts) {
  const mf = window.__mf;
  mf.manual(true);
  let s = mf.restart(opts.round);
  let mode = 'collect', lastCount = 0, sinceAttach = 0, steps = 0;
  // human-like handicap: decide every 0.4 s, finger drags at <= 1000 px/s, ~18 px aim error
  let fx = s.magnet.x, fy = s.magnet.y, gx = fx, gy = fy;
  const aim = (x, y) => {
    const e = opts.human ? 18 : 0;
    gx = x + (Math.random() * 2 - 1) * e; gy = y + (Math.random() * 2 - 1) * e;
  };
  let peakLoad = 0;
  const stats = { overdrives: 0, rejects: 0, maxCombo: 0, maxCluster: 0, mismatchVisits: 0 };
  let prevScore = s.score;
  const trace = [];
  let prevOver = s.machines.map(() => false);
  while (steps < opts.maxSteps) {
    if (s.phase === 'failed') break;
    if (s.phase === 'clear' || s.phase === 'won') break;
    const cl = s.cluster;
    stats.maxCluster = Math.max(stats.maxCluster, cl.count);
    if (cl.count > lastCount) sinceAttach = 0; else sinceAttach += 3 / 60;
    lastCount = cl.count;
    for (const m of s.machines) { stats.maxCombo = Math.max(stats.maxCombo, m.combo); }
    const counts = {};
    for (const c of cl.colours) counts[c] = (counts[c] || 0) + 1;
    const odd = cl.count - (counts[cl.keep] || 0);
    peakLoad = Math.max(peakLoad, s.belt.occupied / s.belt.slots + s.hopper.queue / 10);
    const think = !opts.human || steps % 24 === 0;
    if (opts.idle) {
      aim(60, 900);
    } else if (think) {
      if (mode === 'collect') {
        if (cl.count >= cl.cap) mode = 'deliver';
        else if (cl.count > 0 && sinceAttach > 2.5) mode = 'deliver';
        else if (odd >= (opts.human ? 4 : 3) && s.hopper.queue < s.hopper.cap - 1) mode = 'reject';
      }
      if (mode === 'reject' && odd === 0) mode = 'collect';
      if (mode === 'deliver' && cl.count === 0) mode = 'collect';
      if (mode === 'collect') {
        const seated = s.balls.filter((b) => b.mode === 'seated');
        let want = cl.count ? cl.keep : -1;
        if (want < 0) {
          const bc = {};
          for (const b of seated) bc[b.colour] = (bc[b.colour] || 0) + 1;
          want = +Object.keys(bc).sort((a, b) => bc[b] - bc[a])[0];
        }
        let cand = seated.filter((b) => b.colour === want);
        if (!cand.length) cand = seated;
        let best = null, bd = Infinity;
        for (const b of cand) {
          const d = Math.hypot(b.x - s.magnet.x, b.y - s.magnet.y);
          if (d < bd) { bd = d; best = b; }
        }
        if (best) aim(best.x, best.y);
      } else if (mode === 'deliver') {
        const c = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        const m = s.machines.find((mm) => mm.colour === c);
        aim(m.x, m.y + 15);
      } else {
        aim(s.reject.x, s.reject.y);
      }
    }
    if (opts.human) {
      const dx = gx - fx, dy = gy - fy, d = Math.hypot(dx, dy), max = 1000 * 3 / 60;
      if (d > max) { fx += dx / d * max; fy += dy / d * max; } else { fx = gx; fy = gy; }
    } else { fx = gx; fy = gy; }
    mf.setTarget(fx, fy);
    if (opts.trace && steps % 30 === 0) trace.push(`${s.roundTime.toFixed(1)} ${mode.padEnd(7)} cl=${cl.count}[${cl.colours.join('')}] mag=${Math.round(s.magnet.x)},${Math.round(s.magnet.y)} tgt=${Math.round(s.magnet.tx)},${Math.round(s.magnet.ty)} belt=${s.belt.occupied}/${s.belt.slots} hop=${s.hopper.queue} del=${s.delivered} free=${s.balls.filter(b=>b.mode==='free').length}`);
    s = mf.step(3);
    steps += 3;
    s.machines.forEach((m, i) => { if (m.overdrive && !prevOver[i]) stats.overdrives++; prevOver[i] = m.overdrive; });
    if (s.score < prevScore && s.phase === 'play') stats.rejects++;
    prevScore = s.score;
  }
  return {
    phase: s.phase, round: s.round, delivered: s.delivered, quota: s.quota, score: s.score,
    roundTime: s.roundTime, peakLoad: +peakLoad.toFixed(2), beltOccupied: s.belt.occupied, slots: s.belt.slots, hopper: s.hopper.queue,
    steps, stats, trace,
  };
});

const run = (opts) => evaluate(`(${BOT})(${JSON.stringify(opts)})`);
const results = {};
let ok = true;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) ok = false; };

try {
  if (args.includes('--eval')) {
    console.log(JSON.stringify(await evaluate(argVal('--eval'))));
    await cleanup();
    process.exit(0);
  }
  if (args.includes('--trace')) {
    const r = await run({ round: +(argVal('--trace') || 0), maxSteps: 60 * 120, trace: true, strategy: argVal('--strategy') });
    console.log(r.trace.join('\n'));
    console.log(JSON.stringify({ ...r, trace: undefined }));
    await cleanup();
    process.exit(0);
  }
  const balanceOnly = args.includes('--balance-only');
  const tries = +(argVal('--tries') || 2);
  if (!balanceOnly) {
  // 0. balls move under manual stepping (resume() trap)
  const moved = await evaluate(`(() => {
    const mf = window.__mf; mf.manual(true); mf.restart(0);
    const a = mf.state().balls.filter(b => b.mode === 'seated').map(b => [b.id, b.x, b.y]);
    mf.step(120);
    const after = new Map(mf.state().balls.map(b => [b.id, b]));
    let n = 0; for (const [id, x, y] of a) { const b = after.get(id); if (b && Math.hypot(b.x - x, b.y - y) > 20) n++; }
    return { seated: a.length, moved: n, phase: mf.state().phase };
  })()`);
  check('balls ride the belt under __mf.step()', moved.seated > 0 && moved.moved === moved.seated, JSON.stringify(moved));

  // 1. win round 1 with the bot (also counts hitstops and world pause/resume calls)
  const before = await evaluate('window.__mf.state()');
  results.win = await run({ round: 0, maxSteps: 60 * 240 });
  const after = await evaluate('window.__mf.state()');
  await shot('1-round1-end');
  check('bot clears round 1', results.win.phase === 'clear', JSON.stringify({ ...results.win, trace: undefined }));
  const p = after.pauses - before.pauses, rs = after.resumes - before.resumes;
  check('hitstop fires on delivery, pause/resume only at transitions', p >= results.win.delivered * 0.5 && Math.abs(p - rs) <= 1 && rs < results.win.steps / 4,
    `pauses ${p}, resumes ${rs}, over ${results.win.steps} steps, ${results.win.delivered} delivered`);

  // 2. idle player loses by overflow
  results.idle = await run({ round: 0, maxSteps: 60 * 240, idle: true });
  await shot('2-idle-overflow');
  check('idle player loses round 1 to belt overflow', results.idle.phase === 'failed' && results.idle.hopper > 4 && results.idle.beltOccupied >= results.idle.slots * 0.8,
    JSON.stringify({ ...results.idle, trace: undefined }));

  // 3. retry after fail returns to intro of the same round
  const retry = await evaluate(`(() => { const mf = window.__mf; mf.step(60); mf.tap(); const s = mf.step(1); return { phase: s.phase, round: s.round, delivered: s.delivered }; })()`);
  check('tap after fail restarts the same round', retry.phase === 'intro' && retry.round === 1 && retry.delivered === 0, JSON.stringify(retry));

  // 3b. clearing round 5 ends the game; tap restarts from round 1 (flow test: quota lowered temporarily)
  let won = null;
  const q5 = await evaluate('window.__mf.config.rounds[4].quota');
  await evaluate('window.__mf.config.rounds[4].quota = 6');
  const r5 = await run({ round: 4, maxSteps: 60 * 120, human: true });
  await evaluate(`window.__mf.config.rounds[4].quota = ${q5}`);
  if (r5.phase === 'clear') won = await evaluate(`(() => { const mf = window.__mf; const a = mf.step(60 * 4).phase; mf.tap(); const b = mf.step(1); return { after: a, tapped: b.phase, round: b.round, score: b.score }; })()`);
  check('round 5 clear leads to victory, tap restarts round 1', !!won && won.after === 'won' && won.tapped === 'intro' && won.round === 1 && won.score === 0, JSON.stringify(won));

  // 3c. tuning panel toggles with D
  const panel = await evaluate(`(() => { const el = document.getElementById('tuning'); const a = el.style.display;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); const b = el.style.display;
    const n = el.querySelectorAll('input[type=range]').length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D' })); return { a, b, c: el.style.display, sliders: n }; })()`);
  check('D toggles the tuning panel', panel.a === 'none' && panel.b === 'block' && panel.c === 'none' && panel.sliders > 50, JSON.stringify(panel));

  // 4. balance table: bot on each round
  }
  for (const human of balanceOnly ? [true] : [false, true]) {
    console.log(`\nbalance, ${human ? 'human-like bot (0.4 s decisions, 1000 px/s finger, 18 px aim error)' : 'perfect bot'}, ${tries} tries per round:`);
    for (let r = 0; r < 5; r++) {
      for (let k = 0; k < tries; k++) {
        const res = await run({ round: r, maxSteps: 60 * 300, human });
        console.log(`  round ${r + 1}: ${res.phase.padEnd(6)} ${String(res.delivered).padStart(2)}/${res.quota}  t=${res.roundTime.toFixed(1).padStart(5)}s  peakLoad ${res.peakLoad}  score ${String(res.score).padStart(4)}  maxCombo ${res.stats.maxCombo}  overdrives ${res.stats.overdrives}  rejects ${res.stats.rejects}`);
      }
      if (r === 2 && human) await shot('3-round3');
    }
  }
  // mid-play screenshots: loaded magnet, then feeding a machine (juice visible)
  if (shots) {
    await evaluate(`(() => { const mf = window.__mf; mf.restart(1); mf.step(200); mf.setTarget(${270 + 125}, 215); mf.step(90); mf.setTarget(270, 640); mf.step(25); })()`);
    await shot('4-carrying');
    await evaluate(`(() => { const mf = window.__mf; const s = mf.state(); const c = s.cluster.keep; const m = s.machines.find(x => x.colour === c) || s.machines[0]; mf.setTarget(m.x, m.y + 10); mf.step(40); })()`);
    await shot('5-feeding', 60);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await shot('6-desktop-frame', 600);
  }
} catch (e) {
  ok = false;
  console.error(e);
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await cleanup();
process.exit(ok ? 0 : 1);
