import { initPhysics } from './sim';
import { Game, GameEvent, WINDUP_STEPS } from './game';
import { Renderer, ViewState } from './render';
import { Sfx, buzz } from './audio';
import { browserStorage } from './save';
import { DT, UPGRADES, UPGRADE_IDS, UpgradeId, upgradeCost, METER_GOOD } from './config';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function boot() {
  await initPhysics();
  const game = new Game(browserStorage());
  const frame = $('frame');
  const r = new Renderer($<HTMLCanvasElement>('view'), game.course);
  const sfx = new Sfx();
  r.attach(game.sim);
  r.setBest(game.save.best);

  // ---------- HUD ----------
  const ui = {
    coins: $('coins'), best: $('best'), card: $('card'), tape: $('tape'), tapeStrip: $('tapeStrip'), dist: $('dist'),
    tally: $('tally'), marks: $('tallyMarks'), ring: $('comboRing'), gauge: $('gauge'), gaugeLabel: $('gaugeLabel'),
    point: $('point'), clicker: $('clicker'), shop: $('shop'), result: $('result'),
    resEnd: $('resEnd'), resDist: $('resDist'), resDistC: $('resDistC'), resSmash: $('resSmash'), resSmashC: $('resSmashC'),
    resTotal: $('resTotal'), stamp: $('stamp'),
  };
  const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
  let shownCoins = game.save.coins;
  const setCoins = (n: number, pop = true) => {
    shownCoins = n;
    ui.coins.textContent = fmt(n);
    if (pop) {
      ui.card.classList.remove('pop');
      void ui.card.offsetWidth;
      ui.card.classList.add('pop');
    }
  };
  setCoins(game.save.coins, false);
  ui.best.textContent = `${fmt(game.save.best)} m`;

  const tags = new Map<UpgradeId, HTMLElement>();
  for (const id of UPGRADE_IDS) {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<div class="tag-name">${UPGRADES[id].name}</div><div class="tag-lv"></div><div class="tag-stat"></div><div class="tag-cost"></div>`;
    el.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      sfx.unlock();
      game.buy(id);
      flush();
    });
    ui.shop.appendChild(el);
    tags.set(id, el);
  }
  const refreshShop = () => {
    for (const id of UPGRADE_IDS) {
      const el = tags.get(id)!;
      const lvl = game.save.levels[id];
      const max = lvl >= UPGRADES[id].max;
      el.querySelector('.tag-lv')!.textContent = `Lv ${lvl}${max ? '' : ` / ${UPGRADES[id].max}`}`;
      el.querySelector('.tag-stat')!.textContent = UPGRADES[id].stat(lvl);
      el.querySelector('.tag-cost')!.innerHTML = max ? 'MAX' : `<i class="coin"></i>${fmt(upgradeCost(id, lvl))}`;
      el.classList.toggle('max', max);
      el.classList.toggle('poor', !max && !game.canBuy(id));
    }
  };
  refreshShop();

  const tallySvg = (n: number) =>
    `<svg viewBox="0 0 26 20">${Array.from({ length: Math.min(n, 4) }, (_, i) => `<line x1="${3 + i * 6}" y1="2" x2="${2 + i * 6}" y2="18" stroke="#23242c" stroke-width="2.2" stroke-linecap="round"/>`).join('')}${n >= 5 ? '<line x1="0" y1="15" x2="24" y2="4" stroke="#c8432b" stroke-width="2.4" stroke-linecap="round"/>' : ''}</svg>`;
  const drawTally = (n: number) => {
    const groups = Math.floor(n / 5);
    let html = '';
    for (let g = 0; g < Math.min(groups, 7); g++) html += tallySvg(5);
    if (groups > 7) html += `<span class="more">+${n - 35}</span>`;
    else if (n % 5) html += tallySvg(n % 5);
    ui.marks.innerHTML = html;
  };

  // ---------- juice state ----------
  let hitstop = 0; // seconds of frozen sim, wins over slow-mo
  let slowT = 0;
  let slowScale = 1;
  let releaseT = 0;
  let lastHitstopAt = -1;
  let clock = 0;
  const freeze = (ms: number) => {
    const s = Math.min(0.1, Math.max(0.018, ms / 1000));
    if (clock - lastHitstopAt < 0.15 && s <= hitstop) return;
    hitstop = Math.max(hitstop, s);
    lastHitstopAt = clock;
  };
  const slow = (scale: number, secs: number) => {
    slowScale = Math.min(slowT > 0 ? slowScale : 1, scale);
    slowT = Math.max(slowT, secs);
  };

  // result count-up
  let countUp: { t: number; from: number; to: number; ticks: number } | null = null;

  const setPhaseUI = () => {
    const p = game.phase;
    ui.gauge.classList.toggle('off', p === 'flight' || p === 'result');
    ui.shop.classList.toggle('off', p !== 'aim');
    ui.tape.classList.toggle('hidden', p !== 'flight' && p !== 'result');
    ui.tally.classList.toggle('hidden', p !== 'flight' && p !== 'result');
    ui.result.classList.toggle('hidden', p !== 'result');
  };
  setPhaseUI();

  const onEvent = (e: GameEvent) => {
    switch (e.t) {
      case 'tap': {
        ui.point.style.left = `${e.meter * 100}%`;
        ui.gaugeLabel.classList.toggle('perfect', e.perfect);
        ui.gaugeLabel.textContent = e.perfect ? 'CLICK! CLEAN RELEASE' : e.good ? 'GOOD DRAW' : 'UNDER-DRAWN';
        if (e.perfect) {
          ui.clicker.classList.add('snap');
          sfx.clickerTick();
        } else sfx.tick(2);
        buzz(e.perfect ? [8, 20, 8] : 10);
        break;
      }
      case 'launch':
        releaseT = 0;
        sfx.twang(Math.min(1, e.speed / 110));
        r.shake(0.12);
        buzz(18);
        drawTally(0);
        ui.ring.classList.add('hidden');
        break;
      case 'impact': {
        const k = Math.min(1, e.s / 30);
        sfx.thump(k);
        r.squashHead();
        if (e.y - game.course.groundY(e.x) < 1.5) r.turf(e.x, game.course.groundY(e.x), 0.5 + k);
        r.shake(0.06 + k * 0.4);
        if (e.s > 8) freeze(18 + (e.s - 8) * 3.5);
        buzz(Math.round(8 + 30 * k));
        break;
      }
      case 'smash': {
        sfx.smash(e.combo, e.kind === 'barrel');
        r.splinters(e.x, e.y, e.color, e.kind === 'barrel' ? 5 : 7, 1 + Math.min(e.combo, 8) * 0.08);
        r.shake(0.035 + Math.min(e.combo, 10) * 0.006);
        if (e.combo === 1 || e.combo % 4 === 0) freeze(18 + Math.min(e.combo, 20) * 3);
        drawTally(game.sim.smashed);
        if (e.combo >= 2) {
          ui.ring.textContent = `x${e.combo}`;
          ui.ring.classList.remove('hidden', 'bump');
          void ui.ring.offsetWidth;
          ui.ring.classList.add('bump');
        }
        buzz(6);
        break;
      }
      case 'pad':
        sfx.boing();
        r.padHit(e.id);
        r.shake(0.3);
        freeze(70);
        slow(0.4, 0.35);
        buzz([15, 25, 15]);
        break;
      case 'nearmiss':
        sfx.whoosh();
        slow(0.3, 0.3);
        buzz(8);
        break;
      case 'stop':
        if (e.reason !== 'timeout' && e.reason !== 'oob') {
          sfx.thunk();
          r.shake(0.18);
          r.turf(game.sim.headX, game.course.groundY(game.sim.headX), 0.6);
          buzz(25);
        }
        break;
      case 'result': {
        const res = e.result;
        ui.resEnd.textContent = `END ${game.save.runs}`;
        ui.resDist.textContent = `${fmt(res.distance)} m`;
        ui.resDistC.textContent = `+${fmt(res.coinsDistance)}`;
        ui.resSmash.textContent = `${res.smashed}`;
        ui.resSmashC.textContent = `+${fmt(res.coinsDestruction)}`;
        ui.resTotal.textContent = '+0';
        ui.stamp.classList.add('hidden');
        ui.stamp.classList.remove('slam');
        countUp = { t: 0, from: shownCoins, to: game.save.coins, ticks: 0 };
        ui.best.textContent = `${fmt(game.save.best)} m`;
        if (e.newBest) r.setBest(game.save.best);
        refreshShop();
        break;
      }
      case 'collect':
        r.attach(game.sim);
        ui.clicker.classList.remove('snap');
        ui.gaugeLabel.classList.remove('perfect');
        ui.gaugeLabel.textContent = 'TAP TO RELEASE';
        if (countUp) {
          setCoins(game.save.coins);
          countUp = null;
        }
        refreshShop();
        break;
      case 'buy': {
        sfx.coin();
        buzz(12);
        r.attach(game.sim);
        setCoins(game.save.coins);
        refreshShop();
        const el = tags.get(e.id)!;
        el.classList.remove('bought');
        void el.offsetWidth;
        el.classList.add('bought');
        break;
      }
      case 'deny': {
        sfx.deny();
        const el = tags.get(e.id)!;
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        break;
      }
    }
  };

  let phaseSeen = game.phase;
  const flush = (): boolean => {
    let froze = false;
    for (const e of game.drainEvents()) {
      const before = hitstop;
      onEvent(e);
      if (hitstop > before) froze = true;
    }
    if (game.phase !== phaseSeen) {
      phaseSeen = game.phase;
      setPhaseUI();
    }
    return froze;
  };

  // ---------- input ----------
  const press = () => {
    sfx.unlock();
    if (game.tap()) flush();
  };
  frame.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    press();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space' || ev.code === 'Enter') {
      ev.preventDefault();
      press();
    }
  });

  // ---------- loop ----------
  let auto = true;
  let acc = 0;
  let last = performance.now();
  const view: ViewState = { phase: 'aim', pull: 0, release: 0 };
  const resize = () => r.resize(frame.clientWidth, frame.clientHeight);
  new ResizeObserver(resize).observe(frame);
  resize();

  const frameFn = (now: number) => {
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += realDt;
    let simDt = 0;
    if (auto) {
      if (hitstop > 0) {
        hitstop -= realDt; // frozen: slow-mo timer does not run either
      } else {
        let scale = 1;
        if (slowT > 0) {
          slowT -= realDt;
          scale = slowScale;
        }
        simDt = realDt * scale;
        acc += simDt;
        let n = 0;
        while (acc >= DT && n < 5) {
          game.tick();
          acc -= DT;
          n++;
          if (flush()) {
            acc = 0;
            break;
          }
        }
        if (n >= 5) acc = 0;
      }
    }
    releaseT += simDt;

    // view state
    view.phase = game.phase;
    view.release = releaseT;
    if (game.phase === 'aim') view.pull = 0.2 + game.meter * 0.9;
    else if (game.phase === 'windup') {
      const k = 1 - game.windupLeft / WINDUP_STEPS;
      view.pull = 0.2 + game.tapMeter * 0.9 + 0.3 * Math.sin(k * Math.PI * 0.5); // anticipation squash
    }
    if (game.phase === 'aim') {
      ui.point.style.left = `${game.meter * 100}%`;
      ui.gaugeLabel.classList.toggle('perfect', false);
    }
    const flying = game.phase === 'flight';
    if (flying || game.phase === 'result') {
      const d = Math.floor(game.sim.maxX);
      ui.dist.textContent = fmt(d);
      ui.tapeStrip.style.backgroundPosition = `${-game.sim.maxX * 10}px 0, ${-game.sim.maxX * 10}px 0`;
    }
    const v = game.sim.arrowAlive ? game.sim.arrow[0].linvel() : { x: 0, y: 0 };
    sfx.setWind(flying ? Math.hypot(v.x, v.y) : 0);

    if (countUp) {
      countUp.t += realDt;
      const k = Math.min(1, Math.max(0, (countUp.t - 0.35) / 0.8));
      const val = Math.round(countUp.from + (countUp.to - countUp.from) * k);
      ui.resTotal.textContent = `+${fmt(val - countUp.from)}`;
      ui.coins.textContent = fmt(val);
      const tick = Math.floor(k * 14);
      if (tick > countUp.ticks && k < 1) {
        countUp.ticks = tick;
        sfx.tick(tick);
      }
      if (k >= 1) {
        setCoins(countUp.to);
        sfx.coin();
        if (game.newBest) {
          ui.stamp.classList.remove('hidden');
          ui.stamp.classList.add('slam');
          sfx.record();
          r.shake(0.15);
          buzz([20, 40, 20]);
        }
        countUp = null;
        refreshShop();
      }
    }
    r.update(realDt, hitstop > 0 ? 0 : simDt, view);
    requestAnimationFrame(frameFn);
  };
  requestAnimationFrame(frameFn);

  // ---------- test harness ----------
  (window as unknown as { __ao: unknown }).__ao = {
    /** advance n fixed steps (1/60 s each), ignoring hitstop/slow-mo */
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        game.tick();
        flush();
      }
      return game.state();
    },
    /** launch at an exact gauge value and run the flight to the end */
    play(meter = 0.95, maxSteps = 2000) {
      game.launchNow(meter);
      flush();
      for (let i = 0; i < maxSteps && game.phase === 'flight'; i++) {
        game.tick();
        flush();
      }
      return game.state();
    },
    tap() {
      press();
      return game.state();
    },
    state: () => game.state(),
    grant(n: number) {
      const c = game.grant(n);
      setCoins(c);
      refreshShop();
      return c;
    },
    buy(id: UpgradeId) {
      const ok = game.buy(id);
      flush();
      return ok;
    },
    /** stop/start real-time stepping so only step() advances the sim */
    auto(on: boolean) {
      auto = on;
      return auto;
    },
    meterGood: METER_GOOD,
  };
}

boot();
