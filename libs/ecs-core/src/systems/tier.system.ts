import {
  type LocalizedText,
  TierPlateState,
  type TierState,
} from '@core/components';
import type { TierDefinition } from '@core/entities';
import type { TierId } from '@core/primitives';

/*
 * THE TIER TRACK (client-card-redesign §4.2, `standing.ts:405-426`
 * `tierSteps`; the wallet's status ring, `wallet.presenter.ts:834`
 * `tierOf`). Every tier is a step, by rank; the current step honours an
 * override; the figures are the account's own (qualifying visits, and what
 * the next tier still asks). The ring holds what remains, from the tier the
 * account stands on to the next — never running backwards under an
 * override that stands above the visits. Numbers and ids only.
 */

/** What the track reads of a tier. */
export type TierStepRef = Pick<
  TierDefinition,
  'id' | 'rank' | 'name' | 'qualifyAtLeast'
>;

/** One step of the track. */
export type TierStep = {
  readonly tierId: TierId;
  readonly atLeast: number;
  readonly name: LocalizedText;
};

/** The track as drawn: every tier by rank, and where the account stands on it. */
export type TierTrack = {
  readonly steps: readonly TierStep[];
  /** Qualifying visits, the account's own. */
  readonly value: number;
  /** The override's tier while one stands, else the computed one. */
  readonly currentTierId: TierId;
  readonly nextTierId: TierId | null;
  /** What the next tier still asks, as the account holds it; `null` at the top. */
  readonly remaining: number | null;
};

/** The status ring and the steps' gauge, as numbers. */
export type TierProgress = {
  readonly currentTierId: TierId;
  readonly nextTierId: TierId | null;
  /** Qualifying visits, the account's own. */
  readonly value: number;
  /** The steps' gauge: the visits held to `0 … top`, `top` the highest tier's threshold (1 with none). */
  readonly gaugeValue: number;
  readonly top: number;
  /** What the next tier still asks; `null` at the top (or when the next tier is not in the track). */
  readonly remaining: number | null;
  /** The ring: `ringValue` of `ringMax` — 1 of 1 at the top. */
  readonly ringValue: number;
  readonly ringMax: number;
  /** No tier above: the ring is full. */
  readonly atTop: boolean;
  /** The threshold of the tier the account stands on; `null` when it is not in the track. */
  readonly currentAtLeast: number | null;
  /** The next tier's threshold; `null` at the top. */
  readonly nextAtLeast: number | null;
};

/**
 * The hero's plate (`glance.presenter.ts` `heroTier`): the tier the account
 * stands on, and the ring round the face where one is under way. `null`
 * when the track does not hold the tier.
 */
export type TierPlate = {
  readonly tierPlateState: TierPlateState;
  /** The tier the plate names: the override's while one stands, else the computed one. */
  readonly currentTierId: TierId;
  /** The tier the ring climbs to; `null` unless CLIMBING. */
  readonly nextTierId: TierId | null;
  /** The ring, `0 … 1`: 1 at the TOP, `null` HELD_ABOVE (no ring), the share of the way from this tier's threshold to the next CLIMBING. */
  readonly progress: number | null;
  /** The visits the next tier still asks, never below 0; `null` unless CLIMBING. */
  readonly remaining: number | null;
};

function indexOf(steps: readonly TierStep[], tierId: TierId | null): number {
  for (let i = 0; i < steps.length; i++) {
    if ((steps[i] as TierStep).tierId === tierId) return i;
  }
  return -1;
}

function stepOf(
  steps: readonly TierStep[],
  tierId: TierId | null,
): TierStep | null {
  const at = indexOf(steps, tierId);
  return at < 0 ? null : (steps[at] as TierStep);
}

/** The tier the account stands on: an override's while one stands, else the computed one. */
function currentTierOf(state: TierState): TierId {
  return state.tierOverrideSource === null
    ? state.tierId
    : state.tierOverrideTierId;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const TierSystem = {
  /** Every tier a step, by rank; the current step honours an override (`standing.ts` `tierSteps`). */
  steps(state: TierState, tiers: readonly TierStepRef[]): TierTrack {
    const sorted = [...tiers].sort((a, b) => a.rank - b.rank);
    const steps: TierStep[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const tier = sorted[i] as TierStepRef;
      steps.push({
        tierId: tier.id,
        atLeast: tier.qualifyAtLeast,
        name: tier.name,
      });
    }
    return {
      steps,
      value: state.tierQualifying,
      currentTierId: currentTierOf(state),
      nextTierId: state.nextTierId,
      remaining: state.tierRemaining,
    };
  },

  /**
   * The tier a plate or a ring stands on (`wallet.presenter.ts` `tierPlateOf`
   * / `tierOf`): none while the catalogue holds no tiers; else the one the
   * account stands on, an override honoured (as {@link TierSystem.steps}).
   */
  standingTier(state: TierState, tiers: readonly TierStepRef[]): TierId | null {
    return tiers.length === 0 ? null : currentTierOf(state);
  },

  /**
   * The visits a status at the top is kept with (the wallet's «запазва се с
   * N посещения»): the threshold of the tier the account stands on, or —
   * when the track does not hold it — the visits themselves.
   */
  keptAt(progress: Pick<TierProgress, 'currentAtLeast' | 'value'>): number {
    return progress.currentAtLeast ?? progress.value;
  },

  /**
   * The hero's plate and ring (`glance.presenter.ts:226-247` `heroTier`) —
   * its own rule, NOT {@link TierSystem.progress}: the TOP is the account
   * standing on the LAST step of the track (an override that grants it
   * included), not a next tier that is missing; a tier no next step climbs
   * ABOVE (the next one missing from the track, or not above this one —
   * an override held above what the visits reached) is HELD_ABOVE, the
   * plate alone with no ring; otherwise CLIMBING, the ring the share of
   * the way from this tier's own threshold to the next one's, clamped to
   * `0 … 1`, and what remains the account's own figure (else the next
   * threshold less the visits), never below 0. `null` when the track does
   * not hold the tier the account stands on.
   */
  plate(state: TierState, tiers: readonly TierStepRef[]): TierPlate | null {
    const track = TierSystem.steps(state, tiers);
    const at = indexOf(track.steps, track.currentTierId);
    if (at < 0) return null;
    const current = track.steps[at] as TierStep;
    if (at === track.steps.length - 1) {
      return {
        tierPlateState: TierPlateState.Top,
        currentTierId: current.tierId,
        nextTierId: null,
        progress: 1,
        remaining: null,
      };
    }
    const next = stepOf(track.steps, track.nextTierId);
    if (next === null || next.atLeast <= current.atLeast) {
      return {
        tierPlateState: TierPlateState.HeldAbove,
        currentTierId: current.tierId,
        nextTierId: null,
        progress: null,
        remaining: null,
      };
    }
    const span = next.atLeast - current.atLeast;
    return {
      tierPlateState: TierPlateState.Climbing,
      currentTierId: current.tierId,
      nextTierId: next.tierId,
      progress: clamp((track.value - current.atLeast) / span, 0, 1),
      remaining: Math.max(0, track.remaining ?? next.atLeast - track.value),
    };
  },

  /**
   * The ring and the gauge (`wallet.presenter.ts` `tierOf`): what remains
   * is the account's own figure, else the next tier's threshold less the
   * visits, never below 0; the ring spans from the tier the account stands
   * on to the next (an override may stand above what the visits reached,
   * and the arc never runs backwards); at the top the ring is full.
   */
  progress(state: TierState, tiers: readonly TierStepRef[]): TierProgress {
    const track = TierSystem.steps(state, tiers);
    const current = stepOf(track.steps, track.currentTierId);
    const next = stepOf(track.steps, track.nextTierId);
    const last = track.steps[track.steps.length - 1];
    const top = last === undefined ? 1 : last.atLeast;
    const remaining =
      next === null
        ? null
        : Math.max(0, track.remaining ?? next.atLeast - track.value);
    const base = {
      currentTierId: track.currentTierId,
      nextTierId: track.nextTierId,
      value: track.value,
      gaugeValue: clamp(track.value, 0, top),
      top,
      currentAtLeast: current === null ? null : current.atLeast,
    };
    if (next === null || remaining === null) {
      return {
        ...base,
        remaining: null,
        ringValue: 1,
        ringMax: 1,
        atTop: true,
        nextAtLeast: null,
      };
    }
    const floor = Math.min(current?.atLeast ?? 0, next.atLeast);
    const span = Math.max(1, next.atLeast - floor);
    return {
      ...base,
      remaining,
      ringValue: clamp(span - remaining, 0, span),
      ringMax: span,
      atTop: false,
      nextAtLeast: next.atLeast,
    };
  },
} as const;
