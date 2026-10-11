import type { LocalizedText, TierState } from '@core/components';
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

function stepOf(
  steps: readonly TierStep[],
  tierId: TierId | null,
): TierStep | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as TierStep;
    if (step.tierId === tierId) return step;
  }
  return null;
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
      currentTierId:
        state.tierOverrideSource === null
          ? state.tierId
          : state.tierOverrideTierId,
      nextTierId: state.nextTierId,
      remaining: state.tierRemaining,
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
