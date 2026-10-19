// ---------------------------------------------------------------------------
// Three story missions, then an endless "sell N cups" objective.
// Missions never block play; they only give direction and a bonus.
// ---------------------------------------------------------------------------
import { BALANCE, niceNumber } from './config';
import { earn, totalIncome, type GameState } from './economy';

export interface MissionView {
  title: string;
  current: number;
  target: number;
  reward: number;
  /** Optional short sub-line, e.g. what is still missing. */
  hint?: string;
}

const STORY_COUNT = 3;

function repeatParams(g: GameState) {
  const R = BALANCE.repeatMission;
  const n = g.mission.index - STORY_COUNT;
  return {
    cups: Math.min(R.maxCups, R.baseCups + R.cupsStep * n),
    reward: g.mission.repeatReward || R.minReward,
  };
}

function repeatReward(g: GameState): number {
  const R = BALANCE.repeatMission;
  return niceNumber(Math.max(R.minReward, totalIncome(g) * R.rewardIncomeSec));
}

export function currentMission(g: GameState): MissionView {
  const R = BALANCE.missionRewards;
  switch (g.mission.index) {
    case 0:
      return { title: 'Sell 5 cups', current: Math.min(g.totalCups, 5), target: 5, reward: R.sellCups };
    case 1: {
      const best = Math.max(g.kiosks.cinema.levels.heat, g.kiosks.fairground.levels.heat);
      return { title: 'Reach HEAT level 3', current: Math.min(best, 3), target: 3, reward: R.heat3 };
    }
    case 2: {
      const F = BALANCE.fairground;
      if (g.kiosks.fairground.unlocked) return { title: 'Open Fairground', current: 1, target: 1, reward: R.openFair };
      if (g.lifetime < F.unlockLifetime)
        return {
          title: 'Open Fairground',
          current: Math.floor(g.lifetime),
          target: F.unlockLifetime,
          reward: R.openFair,
          hint: 'earn',
        };
      return { title: 'Open Fairground', current: 1, target: 1, reward: R.openFair, hint: 'ready' };
    }
    default: {
      const p = repeatParams(g);
      const sold = g.totalCups - g.mission.repeatBase;
      return { title: `Sell ${p.cups} cups`, current: Math.min(sold, p.cups), target: p.cups, reward: p.reward };
    }
  }
}

function isComplete(g: GameState): boolean {
  switch (g.mission.index) {
    case 0:
      return g.totalCups >= 5;
    case 1:
      return Math.max(g.kiosks.cinema.levels.heat, g.kiosks.fairground.levels.heat) >= 3;
    case 2:
      return g.kiosks.fairground.unlocked;
    default: {
      const p = repeatParams(g);
      return g.totalCups - g.mission.repeatBase >= p.cups;
    }
  }
}

/** Completes the active mission if possible. Returns the finished mission + reward. */
export function checkMission(g: GameState): MissionView | null {
  if (!isComplete(g)) return null;
  const done = currentMission(g);
  earn(g, done.reward);
  g.mission.index++;
  if (g.mission.index >= STORY_COUNT) {
    g.mission.repeatBase = g.totalCups;
    g.mission.repeatReward = repeatReward(g);
  }
  return done;
}
