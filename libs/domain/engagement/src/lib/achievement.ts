import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import {
  AchievementEmptyNameError,
  AchievementEmptyRewardsError,
} from './achievement.errors';
import { AchievementId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Reward } from './reward';

/** MVP scope, ports v2's `AchievementTrigger` — extend on demonstrated need. */
export type AchievementTrigger =
  'registration_complete' | 'appointment_completed' | 'referral_completed';

export type AchievementCriteria =
  | AchievementCriteriaAlwaysTrue
  | AchievementCriteriaAppointmentsCompletedAtLeast;

export interface AchievementCriteriaAlwaysTrue {
  readonly kind: 'always_true';
}
export interface AchievementCriteriaAppointmentsCompletedAtLeast {
  readonly kind: 'appointments_completed_at_least';
  readonly n: number;
}

export const AchievementCriteria = {
  alwaysTrue(): AchievementCriteriaAlwaysTrue {
    return { kind: 'always_true' };
  },
  appointmentsCompletedAtLeast(
    n: number,
  ): AchievementCriteriaAppointmentsCompletedAtLeast {
    return { kind: 'appointments_completed_at_least', n };
  },
  evaluate(
    criteria: AchievementCriteria,
    ctx: { appointmentsCompleted?: number },
  ): boolean {
    switch (criteria.kind) {
      case 'always_true':
        return true;
      case 'appointments_completed_at_least':
        return (ctx.appointmentsCompleted ?? 0) >= criteria.n;
    }
  },
} as const;

export type AchievementError =
  EmptyIdError | AchievementEmptyNameError | AchievementEmptyRewardsError;

export interface CreateAchievementProps {
  id: string;
  name: string;
  description?: string;
  trigger: AchievementTrigger;
  criteria: AchievementCriteria;
  rewards: Reward[];
  enabled: boolean;
}

/**
 * **Value object (immutable config).** Admin-defined achievement (ports
 * v2's `AchievementDefinition`) — not an aggregate root, no lifecycle;
 * unlocks are tracked separately (by whichever use-case observes a
 * trigger firing, Goal 03).
 */
export class Achievement {
  private constructor(
    readonly id: AchievementId,
    readonly name: string,
    readonly description: string | null,
    readonly trigger: AchievementTrigger,
    readonly criteria: AchievementCriteria,
    readonly rewards: readonly Reward[],
    readonly enabled: boolean,
  ) {}

  static create(
    props: CreateAchievementProps,
  ): Result<Achievement, AchievementError[]> {
    return Achievement.build(props);
  }

  static reconstitute(
    props: CreateAchievementProps,
  ): Result<Achievement, AchievementError[]> {
    return Achievement.build(props);
  }

  private static build(
    props: CreateAchievementProps,
  ): Result<Achievement, AchievementError[]> {
    const idResult = AchievementId.create(props.id);
    const nameResult = Achievement.validateName(props.name);
    const rewardsResult = Achievement.validateRewards(props.rewards);

    const combined = combineAll([idResult, nameResult, rewardsResult] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, name, rewards] = combined.value;

    return ok(
      new Achievement(
        id,
        name,
        props.description?.trim() || null,
        props.trigger,
        props.criteria,
        rewards,
        props.enabled,
      ),
    );
  }

  /** Whether this achievement unlocks RIGHT NOW for this trigger + context. */
  unlocks(
    trigger: AchievementTrigger,
    ctx: { appointmentsCompleted?: number },
  ): boolean {
    if (!this.enabled) return false;
    if (this.trigger !== trigger) return false;
    return AchievementCriteria.evaluate(this.criteria, ctx);
  }

  private static validateName(
    raw: string,
  ): Result<string, AchievementEmptyNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new AchievementEmptyNameError());
  }

  private static validateRewards(
    raw: Reward[],
  ): Result<readonly Reward[], AchievementEmptyRewardsError> {
    if (raw.length === 0) {
      return fail(new AchievementEmptyRewardsError());
    }
    return ok(raw);
  }
}
