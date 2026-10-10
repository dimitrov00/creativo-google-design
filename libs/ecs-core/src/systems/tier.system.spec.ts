import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import type { TierState } from '../components/tier-state.data';
import {
  TierId,
  type TierDefinitionEntity,
} from '../entities/tier-definition.entity';
import { deepFreeze } from '../testing';
import { TierSystem } from './tier.system';

/*
 * COPIED, never moved:
 * - the `tierSteps` cases of libs/domain/engagement/src/lib/loyalty/standing.spec.ts
 *   (→ `TierSystem.steps`);
 * - the ring and gauge math of the `walletTierVm` cases of
 *   libs/features/staff/client-card/src/lib/wallet.presenter.spec.ts
 *   (→ `TierSystem.progress`): the numbers each case asserts, the words
 *   staying with the presenter's spec. The flag/catalogue absence case is
 *   the presenter's own (no math) and stays there.
 */

const text = (bg: string) => ({ bg, en: bg });

const tier = (
  id: string,
  rank: number,
  atLeast: number,
): TierDefinitionEntity => ({
  id: TierId.of(id),
  name: text(id),
  rank,
  benefits: [],
  version: 1,
  effectiveFromDayKey: DayKey.of('2025-03-01'),
  qualify: {
    metric: 'client.visits.completed',
    atLeast,
    window: { lastDays: 365 },
  },
});

/** By rank: bronze 0, silver 6, gold 12, platinum 20 — the seed's tiers. */
const TIERS = [
  tier('bronze', 0, 0),
  tier('silver', 1, 6),
  tier('gold', 2, 12),
  tier('platinum', 3, 20),
];

/** Георги: gold on 14 visits, six to platinum. */
const state: TierState = {
  current: TierId.of('gold'),
  definitionVersion: 1,
  sinceMs: Date.parse('2026-05-10T07:00:00.000Z'),
  qualifying: 14,
  next: TierId.of('platinum'),
  remaining: 6,
  override: null,
};

describe('TierSystem.steps (standing.spec.ts `tierSteps`)', () => {
  it('draws every tier by rank, with the account’s own figures', () => {
    const track = TierSystem.steps(state, TIERS);
    expect(track.steps.map((s) => `${s.tierId}@${s.atLeast}`)).toEqual([
      'bronze@0',
      'silver@6',
      'gold@12',
      'platinum@20',
    ]);
    expect(track.steps[2]?.name.bg).toBe('gold');
    expect(track).toMatchObject({
      value: 14,
      currentTierId: 'gold',
      nextTierId: 'platinum',
      remaining: 6,
    });
  });

  it('sorts tiers handed over in any order', () => {
    const shuffled = [...TIERS].reverse();
    expect(TierSystem.steps(state, shuffled).steps[0]?.tierId).toBe('bronze');
  });

  it('honours an override for the current step', () => {
    const granted = TierSystem.steps(
      {
        ...state,
        override: {
          tierId: TierId.of('platinum'),
          until: DayKey.of('2026-12-31'),
          source: { kind: 'adjustment', adjustmentId: 'adj-1' },
        },
      },
      TIERS,
    );
    expect(granted.currentTierId).toBe('platinum');
  });
});

describe('TierSystem.progress (wallet.presenter.spec.ts `walletTierVm`)', () => {
  it('holds what remains in the ring, from the tier the account stands on to the next', () => {
    expect(TierSystem.progress(state, TIERS)).toEqual({
      currentTierId: 'gold',
      nextTierId: 'platinum',
      value: 14,
      // The steps' gauge: 14 of 20.
      gaugeValue: 14,
      top: 20,
      remaining: 6,
      // Gold (12) to platinum (20): 2 of 8.
      ringValue: 2,
      ringMax: 8,
      atTop: false,
      currentAtLeast: 12,
      nextAtLeast: 20,
    });
  });

  it('fills the ring at the top', () => {
    const top = TierSystem.progress(
      {
        ...state,
        current: TierId.of('platinum'),
        qualifying: 24,
        next: null,
        remaining: null,
      },
      TIERS,
    );
    expect(top).toMatchObject({
      ringValue: 1,
      ringMax: 1,
      remaining: null,
      atTop: true,
      // The gauge holds at its top, 20 of 20.
      gaugeValue: 20,
      top: 20,
      currentAtLeast: 20,
      nextAtLeast: null,
    });
  });

  it('starts the ring empty on the first tier, and agrees a count of one', () => {
    expect(
      TierSystem.progress(
        {
          ...state,
          current: TierId.of('bronze'),
          qualifying: 1,
          next: TierId.of('silver'),
          remaining: 5,
        },
        TIERS,
      ),
    ).toMatchObject({ ringValue: 1, ringMax: 6, remaining: 5, value: 1 });
  });

  it('never runs the arc backwards under an override that stands above the visits', () => {
    const progress = TierSystem.progress(
      {
        ...state,
        current: TierId.of('silver'),
        qualifying: 7,
        next: TierId.of('platinum'),
        remaining: 13,
        override: {
          tierId: TierId.of('gold'),
          until: null,
          source: { kind: 'adjustment', adjustmentId: 'adj-1' },
        },
      },
      TIERS,
    );
    expect(progress).toMatchObject({
      ringValue: 0,
      ringMax: 8,
      remaining: 13,
      gaugeValue: 7,
    });
  });

  it('works out what remains where the account does not say, never below nothing', () => {
    expect(
      TierSystem.progress({ ...state, remaining: null }, TIERS),
    ).toMatchObject({ remaining: 6, ringValue: 2 });
    expect(
      TierSystem.progress({ ...state, qualifying: 25, remaining: null }, TIERS),
    ).toMatchObject({ remaining: 0, ringValue: 8, gaugeValue: 20 });
  });

  it('holds a track with no tiers to a gauge of one', () => {
    expect(TierSystem.progress(state, [])).toMatchObject({
      top: 1,
      gaugeValue: 1,
      atTop: true,
      currentAtLeast: null,
    });
  });
});

describe('TierSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const tiers = deepFreeze([...TIERS].reverse());
    const held = deepFreeze(state);
    expect(TierSystem.progress(held, tiers)).toEqual(
      TierSystem.progress(held, tiers),
    );
    expect(TierSystem.steps(held, tiers)).toEqual(
      TierSystem.steps(held, tiers),
    );
  });
});
