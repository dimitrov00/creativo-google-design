import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { MilestoneId } from './ids';
import { EmptyIdError } from './ids.errors';
import {
  MilestoneEmptyRewardsError,
  MilestoneInvalidCriteriaThresholdError,
  MilestoneInvalidOrderError,
} from './milestone.errors';
import { Reward } from './reward';

/**
 * Eligibility criteria evaluated when a milestone becomes reachable.
 * Deviation from v2: the full criteria grammar (account-age gates,
 * completion-rate anti-fraud checks, referral windows) is deferred —
 * this pass models the two simplest cases; richer criteria land when a
 * concrete anti-fraud use-case in Goal 03 needs them.
 */
export type MilestoneCriteria =
  MilestoneCriteriaAlwaysTrue | MilestoneCriteriaAppointmentsCompletedAtLeast;

export interface MilestoneCriteriaAlwaysTrue {
  readonly kind: 'always_true';
}
export interface MilestoneCriteriaAppointmentsCompletedAtLeast {
  readonly kind: 'appointments_completed_at_least';
  readonly atLeast: number;
}

export const MilestoneCriteria = {
  alwaysTrue(): MilestoneCriteriaAlwaysTrue {
    return { kind: 'always_true' };
  },
  appointmentsCompletedAtLeast(
    atLeast: number,
  ): Result<
    MilestoneCriteriaAppointmentsCompletedAtLeast,
    MilestoneInvalidCriteriaThresholdError
  > {
    if (!Number.isInteger(atLeast) || atLeast <= 0) {
      return fail(new MilestoneInvalidCriteriaThresholdError(atLeast));
    }
    return ok({ kind: 'appointments_completed_at_least', atLeast });
  },

  /** Pure evaluation against a runtime context — exhaustive switch. */
  evaluate(
    criteria: MilestoneCriteria,
    ctx: { appointmentsCompleted?: number },
  ): boolean {
    switch (criteria.kind) {
      case 'always_true':
        return true;
      case 'appointments_completed_at_least':
        return (ctx.appointmentsCompleted ?? 0) >= criteria.atLeast;
    }
  },
} as const;

export type MilestoneError =
  EmptyIdError | MilestoneInvalidOrderError | MilestoneEmptyRewardsError;

export interface CreateMilestoneProps {
  id: string;
  order: number;
  criteria: MilestoneCriteria;
  rewards: Reward[];
  enabled: boolean;
}

/**
 * Single step within a `RewardProgram` (ports v2's
 * `RewardProgram.Milestone`, flattened out of the parent namespace into
 * its own VO for this pass).
 */
export class Milestone {
  private constructor(
    readonly id: MilestoneId,
    readonly order: number,
    readonly criteria: MilestoneCriteria,
    readonly rewards: readonly Reward[],
    readonly enabled: boolean,
  ) {}

  static create(
    props: CreateMilestoneProps,
  ): Result<Milestone, MilestoneError[]> {
    return Milestone.build(props);
  }

  static reconstitute(
    props: CreateMilestoneProps,
  ): Result<Milestone, MilestoneError[]> {
    return Milestone.build(props);
  }

  private static build(
    props: CreateMilestoneProps,
  ): Result<Milestone, MilestoneError[]> {
    const idResult = MilestoneId.create(props.id);
    const orderResult = Milestone.validateOrder(props.order);
    const rewardsResult = Milestone.validateRewards(props.rewards);

    const combined = combineAll([
      idResult,
      orderResult,
      rewardsResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, order, rewards] = combined.value;

    return ok(new Milestone(id, order, props.criteria, rewards, props.enabled));
  }

  private static validateOrder(
    raw: number,
  ): Result<number, MilestoneInvalidOrderError> {
    if (!Number.isInteger(raw) || raw < 0) {
      return fail(new MilestoneInvalidOrderError(raw));
    }
    return ok(raw);
  }

  private static validateRewards(
    raw: Reward[],
  ): Result<readonly Reward[], MilestoneEmptyRewardsError> {
    if (raw.length === 0) {
      return fail(new MilestoneEmptyRewardsError());
    }
    return ok(raw);
  }
}
